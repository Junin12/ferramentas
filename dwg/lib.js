// Leitura de DXF/DWG e preparo do desenho para a tela (lógica pura, roda no worker e na página).
// Modelo comum aos dois formatos: { camadas: {nome: {cor, ligada}}, blocos: {nome: {x, y, ents}}, ents, unidades }
// Entidades (ângulos em radianos, k = tipo):
//   p polilinha {pts:[x,y,…], b:[bulge…]|null, f:fechada}   c círculo {x,y,r}   a arco {x,y,r,a1,a2}
//   e elipse {x,y,mx,my,razao,a1,a2}   s spline {pts}   t texto {x,y,h,rot,t,ah,av,w}
//   i bloco inserido {bloco,x,y,sx,sy,rot,nc,nr,dc,dr,at:[textos]}   h hachura {lacos:[[x,y,…]],solida}   f sólido {pts}
// Todas têm c (camada) e cor (índice ACI: 0 = do bloco, 256 = da camada; ou rgb 0xRRGGBB em `rgb`).
'use strict';

const Cad = (() => {
  const PI2 = Math.PI * 2;

  // ---------- cores ACI (paleta padrão do AutoCAD) ----------
  const ACI = (() => {
    const t = new Uint32Array(256);
    const base = [0, 0xFF0000, 0xFFFF00, 0x00FF00, 0x00FFFF, 0x0000FF, 0xFF00FF, 0xFFFFFF, 0x808080, 0xC0C0C0];
    base.forEach((c, i) => (t[i] = c));
    const V = [255, 165, 127, 76, 38];
    for (let i = 10; i < 250; i++) {
      const hue = Math.floor((i - 10) / 10) * 15, sub = i % 10, v = V[sub >> 1], s = sub & 1 ? 0.5 : 1;
      const f = (n) => { const k = (n + hue / 60) % 6; return Math.round(v - v * s * Math.max(0, Math.min(k, 4 - k, 1))); };
      t[i] = (f(5) << 16) | (f(3) << 8) | f(1);
    }
    [0x333333, 0x505050, 0x696969, 0x828282, 0xBEBEBE, 0xFFFFFF].forEach((c, i) => (t[250 + i] = c));
    return t;
  })();

  // ---------- textos ----------
  const especiais = (s) => s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%')
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  // tira os códigos de formatação do MTEXT ({\fArial|b1;…}, \P = nova linha, \S1^2; = fração)
  function limparMtext(s) {
    return especiais(String(s || ''))
      .replace(/\\P/g, '\n').replace(/\\~/g, ' ')
      .replace(/\\S([^;]*);/g, (m, a) => a.replace(/[\^#]/, '/'))
      .replace(/\\[ACFHQTWfhqtwacp][^;\\{}]*;/g, '')
      .replace(/\\[LlOoKkNX]/g, '')
      .replace(/\\\\/g, '\\').replace(/\\([{}])/g, '$1').replace(/(^|[^\\])[{}]/g, '$1').replace(/[{}]/g, '');
  }

  // ---------- leitor de DXF ----------
  // percorre o arquivo em pares (código, valor) sem quebrar tudo em linhas de uma vez (DXF de 100+ MB)
  function lerDxf(txt) {
    let pos = 0;
    const N = txt.length;
    function linha() {
      let e = txt.indexOf('\n', pos);
      if (e < 0) e = N;
      let s = txt.slice(pos, e);
      pos = e + 1;
      if (s.endsWith('\r')) s = s.slice(0, -1);
      return s;
    }
    // lê uma entidade inteira: tipo + lista de pares até o próximo código 0
    let tipoAtual = null;
    function proxPar() {
      if (pos >= N) return null;
      const c = parseInt(linha(), 10);
      const v = linha();
      return [c, v];
    }
    let pendente = null;
    function par() { if (pendente) { const p = pendente; pendente = null; return p; } return proxPar(); }
    function entidade() {
      // supõe que o último par lido foi (0, tipo)
      const pares = [];
      for (;;) {
        const p = par();
        if (!p) break;
        if (p[0] === 0) { pendente = p; break; }
        pares.push(p);
      }
      return pares;
    }

    const m = { camadas: {}, blocos: {}, ents: [], papel: [], unidades: 0, layouts: [] };
    const registros = {}; // handle do BLOCK_RECORD → nome do bloco (para ligar folha → bloco)
    let secao = null, bloco = null, ultimo = null, poli = null;
    for (;;) {
      const p = par();
      if (!p) break;
      const [c, v0] = p;
      if (c !== 0) {
        // fora de entidade: só interessa o cabeçalho e o nome da seção
        if (c === 2 && secao === '?') secao = v0.trim();
        else if (secao === 'HEADER' && c === 9) {
          const nome = v0.trim();
          if (nome === '$INSUNITS') { const q = par(); if (q) m.unidades = parseInt(q[1], 10) || 0; }
        }
        continue;
      }
      const v = v0.trim();
      if (v === 'SECTION') { secao = '?'; continue; }
      if (v === 'ENDSEC') { secao = null; continue; }
      if (v === 'EOF') break;
      const pr = entidade();
      if (secao === 'OBJECTS') {
        if (v === 'LAYOUT') {
          // o último 330 aponta para o BLOCK_RECORD do espaço do papel da folha
          let nome = '', ordem = 0, reg = '';
          for (const [c, x] of pr) { if (c === 1) nome = x.trim(); else if (c === 71) ordem = +x; else if (c === 330) reg = x.trim(); }
          if (nome && !/^model$/i.test(nome)) m.layouts.push({ nome, ordem, reg });
        }
        continue;
      }
      if (secao === 'TABLES') {
        if (v === 'BLOCK_RECORD') {
          const g = grupos(pr);
          if (g[5] && g[2]) registros[g[5]] = g[2];
          continue;
        }
        if (v === 'LAYER') {
          const g = grupos(pr);
          const nome = g[2];
          if (nome === undefined) continue;
          const ci = parseInt(g[62] || '7', 10), fl = parseInt(g[70] || '0', 10);
          m.camadas[nome] = { cor: g[420] !== undefined ? +g[420] & 0xFFFFFF : ACI[Math.abs(ci) % 256] || 0xFFFFFF, ligada: ci >= 0 && !(fl & 1) };
        }
        continue;
      }
      if (secao === 'BLOCKS') {
        if (v === 'BLOCK') {
          const g = grupos(pr);
          bloco = { x: +g[10] || 0, y: +g[20] || 0, ents: [] };
          m.blocos[g[2]] = bloco;
          continue;
        }
        if (v === 'ENDBLK') { bloco = null; continue; }
      }
      if (secao !== 'BLOCKS' && secao !== 'ENTITIES') continue;
      // no ENTITIES, o código 67 = 1 marca o espaço do papel da folha ativa
      let lista = secao === 'BLOCKS' ? (bloco ? bloco.ents : null) : m.ents;
      if (secao === 'ENTITIES' && v !== 'VERTEX' && v !== 'ATTRIB' && v !== 'SEQEND') m._papel = pr.some((p) => p[0] === 67 && p[1].trim() === '1');
      if (secao === 'ENTITIES' && m._papel) lista = m.papel;
      if (!lista) continue;
      // continuação de POLYLINE / INSERT com atributos
      if (v === 'VERTEX') {
        if (poli) {
          const g = grupos(pr), fl = parseInt(g[70] || '0', 10);
          if (!(fl & 16) && !(fl & 128 && !(fl & 64))) { poli.pts.push(+g[10] || 0, +g[20] || 0); poli.b.push(+g[42] || 0); }
        }
        continue;
      }
      if (v === 'ATTRIB') {
        if (ultimo && ultimo.k === 'i') { const t = textoDxf(pr, true); if (t) ultimo.at.push(t); }
        continue;
      }
      if (v === 'SEQEND') { poli = null; continue; }
      poli = null;
      const g = grupos(pr);
      if (g[60] === '1') continue; // invisível
      const e = entidadeDxf(v, pr, g);
      if (!e) { ultimo = null; continue; }
      e.c = g[8] !== undefined ? g[8] : '0';
      e.cor = g[62] !== undefined ? parseInt(g[62], 10) : 256;
      if (g[420] !== undefined) e.rgb = +g[420] & 0xFFFFFF;
      if (+g[230] < 0) espelhar(e);
      if (e.k === 'p' && v === 'POLYLINE') {
        const fl = parseInt(g[70] || '0', 10);
        if (fl & 64 || fl & 16) { ultimo = null; continue; } // malhas 3D: fora
        e.f = !!(fl & 1);
        poli = e;
      }
      lista.push(e);
      ultimo = e;
    }
    delete m._papel;
    // folha → bloco do espaço do papel; a folha ativa (*Paper_Space) tem as entidades no ENTITIES
    m.layouts = m.layouts.map((l) => ({ nome: l.nome, ordem: l.ordem, bloco: registros[l.reg] || '' })).filter((l) => l.bloco);
    return m;

    // pares → objeto com o primeiro valor de cada código
    function grupos(pr) {
      const g = {};
      for (const [c, v] of pr) if (g[c] === undefined) g[c] = v.trim ? (c === 1 || c === 3 ? v : v.trim()) : v;
      return g;
    }
  }

  function textoDxf(pr, attrib) {
    const g = {};
    for (const [c, v] of pr) if (g[c] === undefined) g[c] = c === 1 ? v : v.trim();
    if (attrib && parseInt(g[70] || '0', 10) & 1) return null;
    const t = especiais(g[1] || '');
    if (!t.trim()) return null;
    const ah = parseInt(g[72] || '0', 10), av = parseInt(g[attrib ? 74 : 73] || '0', 10);
    const usaAl = (ah || av) && ah !== 3 && ah !== 5 && g[11] !== undefined;
    return {
      k: 't', x: +(usaAl ? g[11] : g[10]) || 0, y: +(usaAl ? g[21] : g[20]) || 0, h: +g[40] || 1, rot: (+g[50] || 0) * Math.PI / 180, t,
      ah: ah === 4 ? 1 : ah === 3 || ah === 5 ? 0 : ah, av: ah === 4 ? 2 : av, w: 0,
      c: g[8] !== undefined ? g[8] : '0', cor: g[62] !== undefined ? parseInt(g[62], 10) : 256, rgb: g[420] !== undefined ? +g[420] & 0xFFFFFF : undefined,
      tag: attrib ? (g[2] || '').trim() : undefined,
    };
  }

  function entidadeDxf(tipo, pr, g) {
    const n = (c, d = 0) => (g[c] !== undefined ? +g[c] : d);
    const rad = (c) => n(c) * Math.PI / 180;
    switch (tipo) {
      case 'LINE': return { k: 'p', pts: [n(10), n(20), n(11), n(21)], b: null, f: false };
      case 'LWPOLYLINE': {
        const pts = [], b = [];
        for (const [c, v] of pr) {
          if (c === 10) { pts.push(+v); b.push(0); } else if (c === 20) pts.push(+v); else if (c === 42 && b.length) b[b.length - 1] = +v;
        }
        return { k: 'p', pts, b, f: !!(n(70) & 1) };
      }
      case 'POLYLINE': return { k: 'p', pts: [], b: [], f: false };
      case 'CIRCLE': return { k: 'c', x: n(10), y: n(20), r: n(40) };
      case 'ARC': return { k: 'a', x: n(10), y: n(20), r: n(40), a1: rad(50), a2: rad(51) };
      case 'ELLIPSE': return { k: 'e', x: n(10), y: n(20), mx: n(11), my: n(21), razao: n(40, 1), a1: n(41), a2: n(42, PI2) };
      case 'SPLINE': {
        const ctrl = [], fit = [], nos = [];
        for (const [c, v] of pr) {
          if (c === 10) ctrl.push(+v); else if (c === 20) ctrl.push(+v);
          else if (c === 11) fit.push(+v); else if (c === 21) fit.push(+v);
          else if (c === 40) nos.push(+v);
        }
        return { k: 's', pts: fit.length >= 4 ? fit : splinePts(ctrl, nos, n(71, 3)) };
      }
      case 'TEXT': return textoDxf(pr, false);
      case 'MTEXT': {
        let t = '';
        for (const [c, v] of pr) if (c === 3) t += v;
        t += g[1] || '';
        t = limparMtext(t);
        if (!t.trim()) return null;
        const ap = n(71, 1);
        let rot = rad(50);
        if (g[11] !== undefined && g[50] === undefined) rot = Math.atan2(n(21), n(11));
        return { k: 't', x: n(10), y: n(20), h: n(40, 1), rot, t, ah: (ap - 1) % 3, av: [3, 2, 1][Math.floor((ap - 1) / 3)], w: n(41) };
      }
      case 'INSERT': return {
        k: 'i', bloco: g[2], x: n(10), y: n(20), sx: n(41, 1), sy: n(42, 1), rot: rad(50),
        nc: Math.max(1, n(70, 1)), nr: Math.max(1, n(71, 1)), dc: n(44), dr: n(45), at: [],
      };
      case 'DIMENSION': return g[2] ? { k: 'i', bloco: g[2], x: 0, y: 0, sx: 1, sy: 1, rot: 0, nc: 1, nr: 1, dc: 0, dr: 0, at: [] } : null;
      case 'SOLID': case 'TRACE':
        return { k: 'f', pts: [n(10), n(20), n(11), n(21), n(13, n(12)), n(23, n(22)), n(12), n(22)] };
      case '3DFACE': return { k: 'p', pts: [n(10), n(20), n(11), n(21), n(12), n(22), n(13), n(23)], b: null, f: true };
      case 'LEADER': {
        const pts = [];
        for (const [c, v] of pr) if (c === 10 || c === 20) pts.push(+v);
        return { k: 'p', pts, b: null, f: false };
      }
      case 'HATCH': return hachuraDxf(pr, g);
      // janela da folha: retângulo no papel (10/20, 40×41) que mostra o modelo em volta de 12/22 (+ alvo 17/27) com altura 45
      // (a de número 1 é a própria folha)
      case 'VIEWPORT': return n(69) === 1 ? null : { k: 'v', cx: n(10), cy: n(20), w: n(40), h: n(41), vcx: n(12) + n(17), vcy: n(22) + n(27), vh: n(45, 1), id: n(69), ligada: n(68, 1) > 0 };
      default: return null;
    }
  }

  // contornos da hachura: sequência 91 (nº de laços) → 92 (tipo) → arestas ou polilinha
  function hachuraDxf(pr, g) {
    let i = pr.findIndex((p) => p[0] === 91);
    if (i < 0) return null;
    const lacos = [];
    const nl = +pr[i][1];
    i++;
    const ler = (c) => { while (i < pr.length && pr[i][0] !== c) i++; return i < pr.length ? +pr[i++][1] : 0; };
    for (let l = 0; l < nl && i < pr.length; l++) {
      const tipo = ler(92);
      const pts = [];
      if (tipo & 2) {
        const temB = ler(72); ler(73);
        const nv = ler(93);
        const b = [];
        for (let v = 0; v < nv; v++) {
          pts.push(ler(10), ler(20));
          b.push(temB && pr[i] && pr[i][0] === 42 ? +pr[i++][1] : 0);
        }
        lacos.push(comBulges(pts, b, true));
      } else {
        const na = ler(93);
        for (let a = 0; a < na; a++) {
          const t = ler(72);
          if (t === 1) { const x1 = ler(10), y1 = ler(20), x2 = ler(11), y2 = ler(21); if (!pts.length) pts.push(x1, y1); pts.push(x2, y2); }
          else if (t === 2) {
            const x = ler(10), y = ler(20), r = ler(40); let a1 = ler(50) * Math.PI / 180, a2 = ler(51) * Math.PI / 180; const ccw = ler(73);
            if (!ccw) { a1 = -a1; a2 = -a2; }
            pts.push(...arcoPts(x, y, r, a1, a2, !ccw));
          } else if (t === 3) {
            const x = ler(10), y = ler(20), mx = ler(11), my = ler(21), razao = ler(40); let a1 = ler(50) * Math.PI / 180, a2 = ler(51) * Math.PI / 180; const ccw = ler(73);
            if (!ccw) { a1 = -a1; a2 = -a2; }
            pts.push(...elipsePts(x, y, mx, my, razao, a1, a2, !ccw));
          } else if (t === 4) {
            const grau = ler(94); ler(73); ler(74); const nk = ler(95), nc = ler(96);
            const nos = [], ctrl = [];
            for (let k = 0; k < nk; k++) nos.push(ler(40));
            for (let k = 0; k < nc; k++) { ctrl.push(ler(10), ler(20)); if (pr[i] && pr[i][0] === 42) i++; }
            pts.push(...splinePts(ctrl, nos, grau));
          }
        }
        lacos.push(pts);
      }
      // objetos de origem do contorno (97 + 330…)
      const ns = pr[i] && pr[i][0] === 97 ? +pr[i++][1] : 0;
      for (let s = 0; s < ns && pr[i] && pr[i][0] === 330; s++) i++;
    }
    return { k: 'h', lacos: lacos.filter((l) => l.length >= 6), solida: g[70] === '1' };
  }

  // ---------- leitor do DWG (dados vindos do LibreDWG) ----------
  function deLibre(db) {
    const m = { camadas: {}, blocos: {}, ents: [], unidades: db.header?.INSUNITS || 0 };
    for (const l of db.tables?.LAYER?.entries || []) {
      const ci = l.colorIndex ?? 7;
      m.camadas[l.name] = { cor: l.color != null && l.color >= 0 ? l.color & 0xFFFFFF : ACI[Math.abs(ci) % 256], ligada: !l.off && !l.frozen && ci >= 0 };
    }
    // atributos ficam soltos na lista geral, ligados ao bloco inserido pelo dono
    const atributos = {};
    for (const e of db.entities || []) if (e.type === 'ATTRIB') (atributos[e.ownerBlockRecordSoftId] ||= []).push(e);
    const conv = (lista) => {
      const out = [];
      for (const e of lista || []) {
        if (e.isVisible === false || e.type === 'ATTRIB') continue;
        let r;
        try { r = entidadeLibre(e, atributos); } catch (err) { r = null; }
        if (!r) continue;
        out.push(r);
      }
      return out;
    };
    // janela "geral" de cada folha (a própria folha) não mostra o modelo
    const janelaDaFolha = new Set((db.objects?.LAYOUT || []).map((l) => l.viewportId).filter(Boolean));
    const nomePorHandle = {};
    for (const b of db.tables?.BLOCK_RECORD?.entries || []) {
      const nome = String(b.name || '');
      nomePorHandle[b.handle] = nome;
      if (/^\*model_space$/i.test(nome)) { m.ents = conv(b.entities); continue; }
      const ents = conv(b.entities);
      for (const e of b.entities || []) {
        if (e.type !== 'VIEWPORT' || janelaDaFolha.has(e.handle)) continue;
        const c = e.viewportCenter || {}, dc = e.displayCenter || {}, t = e.targetPoint || {};
        ents.push({ k: 'v', cx: c.x || 0, cy: c.y || 0, w: e.width || 0, h: e.height || 0, vcx: (dc.x || 0) + (t.x || 0), vcy: (dc.y || 0) + (t.y || 0),
          vh: e.viewHeight || 1, id: e.viewportId, ligada: !((e.statusBitFlags || 0) & 131072) });
      }
      m.blocos[nome] = { x: b.basePoint?.x || 0, y: b.basePoint?.y || 0, ents };
    }
    if (!m.ents.length) m.ents = conv((db.entities || []).filter((e) => !e.isInPaperSpace));
    m.layouts = (db.objects?.LAYOUT || []).filter((l) => !/^model$/i.test(l.layoutName || ''))
      .map((l) => ({ nome: l.layoutName, ordem: l.tabOrder || 0, bloco: nomePorHandle[l.paperSpaceTableId] || '' })).filter((l) => l.bloco);
    m.papel = [];
    return m;
  }

  function corLibre(e, r) {
    r.c = e.layer ?? '0';
    const ci = e.colorIndex;
    if (e.color != null) { r.cor = 7; r.rgb = e.color & 0xFFFFFF; } // cor verdadeira (RGB)
    else if (ci >= 0 && ci <= 255) r.cor = ci;
    else r.cor = 256;
    if (e.extrusionDirection && e.extrusionDirection.z < 0) espelhar(r);
    return r;
  }

  function textoLibre(tb, e) {
    const t = especiais(tb.text || '');
    if (!t.trim()) return null;
    const ah = tb.halign || 0, av = tb.valign || 0;
    const usaAl = (ah || av) && ah !== 3 && ah !== 5 && tb.endPoint;
    const p = usaAl ? tb.endPoint : tb.startPoint;
    return corLibre(e, { k: 't', x: p?.x || 0, y: p?.y || 0, h: tb.textHeight || 1, rot: tb.rotation || 0, t,
      ah: ah === 4 ? 1 : ah === 3 || ah === 5 ? 0 : ah, av: ah === 4 ? 2 : av, w: 0, tag: e.tag || undefined });
  }

  function entidadeLibre(e, atributos) {
    const P = (p) => [p?.x || 0, p?.y || 0];
    switch (e.type) {
      case 'LINE': return corLibre(e, { k: 'p', pts: [...P(e.startPoint), ...P(e.endPoint)], b: null, f: false });
      case 'LWPOLYLINE': case 'POLYLINE2D': case 'POLYLINE3D': {
        if (e.flag & 64 || e.flag & 16) return null;
        const vs = (e.vertices || []).filter((v) => !(v.flag & 16));
        const pts = [], b = [];
        for (const v of vs) { pts.push(v.x || 0, v.y || 0); b.push(v.bulge || 0); }
        return corLibre(e, { k: 'p', pts, b, f: !!(e.flag & 1) });
      }
      case 'CIRCLE': return corLibre(e, { k: 'c', x: e.center.x, y: e.center.y, r: e.radius });
      case 'ARC': return corLibre(e, { k: 'a', x: e.center.x, y: e.center.y, r: e.radius, a1: e.startAngle, a2: e.endAngle });
      case 'ELLIPSE': return corLibre(e, { k: 'e', x: e.center.x, y: e.center.y, mx: e.majorAxisEndPoint.x, my: e.majorAxisEndPoint.y, razao: e.axisRatio || 1, a1: e.startAngle || 0, a2: e.endAngle ?? PI2 });
      case 'SPLINE': {
        const fit = (e.fitPoints || []).flatMap(P), ctrl = (e.controlPoints || []).flatMap(P);
        return corLibre(e, { k: 's', pts: fit.length >= 4 ? fit : splinePts(ctrl, e.knots || [], e.degree || 3) });
      }
      case 'TEXT': return textoLibre(e, e);
      case 'MTEXT': {
        const t = limparMtext(e.text);
        if (!t.trim()) return null;
        const ap = e.attachmentPoint || 1;
        let rot = e.rotation || 0;
        if (!rot && e.direction && (e.direction.x || e.direction.y)) rot = Math.atan2(e.direction.y, e.direction.x);
        return corLibre(e, { k: 't', x: e.insertionPoint.x, y: e.insertionPoint.y, h: e.textHeight || 1, rot, t, ah: (ap - 1) % 3, av: [3, 2, 1][Math.floor((ap - 1) / 3)], w: e.rectWidth || 0 });
      }
      case 'INSERT': {
        const ats = (e.attribs && e.attribs.length ? e.attribs : atributos[e.handle] || [])
          .filter((a) => !(a.flags & 1) && a.isVisible !== false).map((a) => textoLibre(a.text || a, a)).filter(Boolean);
        return corLibre(e, { k: 'i', bloco: e.name, x: e.insertionPoint.x, y: e.insertionPoint.y, sx: e.xScale ?? 1, sy: e.yScale ?? 1, rot: e.rotation || 0,
          nc: Math.max(1, e.columnCount || 1), nr: Math.max(1, e.rowCount || 1), dc: e.columnSpacing || 0, dr: e.rowSpacing || 0, at: ats });
      }
      case 'DIMENSION': return e.name ? corLibre(e, { k: 'i', bloco: e.name, x: 0, y: 0, sx: 1, sy: 1, rot: 0, nc: 1, nr: 1, dc: 0, dr: 0, at: [] }) : null;
      case 'SOLID': case 'TRACE': {
        const c4 = e.corner4 || e.corner3;
        return corLibre(e, { k: 'f', pts: [...P(e.corner1), ...P(e.corner2), ...P(c4), ...P(e.corner3)] });
      }
      case '3DFACE': {
        const pts = [e.firstCorner, e.secondCorner, e.thirdCorner, e.fourthCorner].filter(Boolean).flatMap(P);
        return pts.length >= 6 ? corLibre(e, { k: 'p', pts, b: null, f: true }) : null;
      }
      case 'LEADER': return corLibre(e, { k: 'p', pts: (e.vertices || []).flatMap(P), b: null, f: false });
      case 'HATCH': {
        const lacos = [];
        for (const bp of e.boundaryPaths || []) {
          if (bp.vertices) { lacos.push(comBulges(bp.vertices.flatMap(P), bp.vertices.map((v) => v.bulge || 0), true)); continue; }
          const pts = [];
          for (const ed of bp.edges || []) {
            if (ed.type === 1) { if (!pts.length) pts.push(...P(ed.start)); pts.push(...P(ed.end)); }
            else if (ed.type === 2) {
              let a1 = ed.startAngle, a2 = ed.endAngle;
              const ccw = ed.isCCW !== false;
              if (!ccw) { a1 = -a1; a2 = -a2; }
              pts.push(...arcoPts(ed.center.x, ed.center.y, ed.radius, a1, a2, !ccw));
            } else if (ed.type === 3) {
              let a1 = ed.startAngle, a2 = ed.endAngle;
              const ccw = ed.isCCW !== false;
              if (!ccw) { a1 = -a1; a2 = -a2; }
              pts.push(...elipsePts(ed.center.x, ed.center.y, ed.end.x, ed.end.y, ed.lengthOfMinorAxis, a1, a2, !ccw));
            } else if (ed.type === 4) {
              const f = (ed.fitDatum || []).flatMap(P);
              pts.push(...(f.length >= 4 ? f : splinePts((ed.controlPoints || []).flatMap(P), ed.knots || [], ed.degree || 3)));
            }
          }
          lacos.push(pts);
        }
        return corLibre(e, { k: 'h', lacos: lacos.filter((l) => l.length >= 6), solida: e.solidFill === 1 });
      }
      default: return null;
    }
  }

  // sistema de coordenadas do objeto com normal para baixo (-Z): no plano, é um espelho em X
  function espelhar(e) {
    const mx = (pts) => { for (let i = 0; i < pts.length; i += 2) pts[i] = -pts[i]; };
    switch (e.k) {
      case 'p': case 's': case 'f': mx(e.pts); if (e.b) e.b = e.b.map((v) => -v); break;
      case 'c': e.x = -e.x; break;
      case 'a': { e.x = -e.x; const a1 = e.a1; e.a1 = Math.PI - e.a2; e.a2 = Math.PI - a1; break; }
      case 'e': e.x = -e.x; e.mx = -e.mx; { const a1 = e.a1; e.a1 = Math.PI - e.a2; e.a2 = Math.PI - a1; } break;
      case 't': e.x = -e.x; break;
      case 'i': e.x = -e.x; e.rot = -e.rot; e.sx = -e.sx; break;
      case 'h': e.lacos.forEach(mx); break;
    }
  }

  // ---------- geometria ----------
  function arcoPts(cx, cy, r, a1, a2, horario) {
    let d = horario ? a1 - a2 : a2 - a1;
    while (d <= 0) d += PI2;
    while (d > PI2 + 1e-9) d -= PI2;
    const n = Math.max(4, Math.ceil(d / PI2 * 72));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a1 + (horario ? -1 : 1) * d * i / n;
      out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return out;
  }
  function elipsePts(cx, cy, mx, my, razao, a1, a2, horario) {
    let d = horario ? a1 - a2 : a2 - a1;
    while (d <= 0) d += PI2;
    while (d > PI2 + 1e-9) d -= PI2;
    const n = Math.max(6, Math.ceil(d / PI2 * 72));
    const nx = -my * razao, ny = mx * razao;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = a1 + (horario ? -1 : 1) * d * i / n, c = Math.cos(t), s = Math.sin(t);
      out.push(cx + mx * c + nx * s, cy + my * c + ny * s);
    }
    return out;
  }
  // trecho com bulge (arco entre dois vértices): bulge = tan(ângulo/4)
  function comBulges(pts, b, fechada) {
    if (!b || !b.some((v) => v)) return fechada && pts.length >= 6 ? pts.concat(pts[0], pts[1]) : pts;
    const n = pts.length / 2, out = [pts[0], pts[1]];
    const lim = fechada ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const x1 = pts[2 * i], y1 = pts[2 * i + 1], j = (i + 1) % n, x2 = pts[2 * j], y2 = pts[2 * j + 1], bu = b[i] || 0;
      if (!bu) { out.push(x2, y2); continue; }
      const th = 4 * Math.atan(bu), dx = x2 - x1, dy = y2 - y1, c = Math.hypot(dx, dy);
      if (c < 1e-12) continue;
      const r = c / (2 * Math.sin(th / 2));
      const mxp = (x1 + x2) / 2, myp = (y1 + y2) / 2, h = r * Math.cos(th / 2);
      const cx = mxp - h * dy / c, cy = myp + h * dx / c;
      const a1 = Math.atan2(y1 - cy, x1 - cx);
      const seg = Math.max(2, Math.ceil(Math.abs(th) / PI2 * 72));
      for (let k = 1; k <= seg; k++) {
        const a = a1 + th * k / seg;
        out.push(cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a));
      }
    }
    return out;
  }
  // B-spline pelos pontos de controle (de Boor); sem nós válidos, usa o próprio polígono de controle
  function splinePts(ctrl, nos, grau) {
    const n = ctrl.length / 2;
    if (n < 2) return ctrl;
    const p = Math.min(grau || 3, n - 1);
    if (nos.length !== n + p + 1) return ctrl;
    const t0 = nos[p], t1 = nos[n], amostras = Math.min(160, n * 4);
    const out = [], dx = new Float64Array(p + 1), dy = new Float64Array(p + 1);
    let k = p;
    for (let s = 0; s <= amostras; s++) {
      const t = t0 + (t1 - t0) * s / amostras;
      while (k < n - 1 && t >= nos[k + 1]) k++;
      for (let j = 0; j <= p; j++) { dx[j] = ctrl[2 * (k - p + j)]; dy[j] = ctrl[2 * (k - p + j) + 1]; }
      for (let r = 1; r <= p; r++) {
        for (let j = p; j >= r; j--) {
          const i = k - p + j, den = nos[i + p - r + 1] - nos[i];
          const a = den ? (t - nos[i]) / den : 0;
          dx[j] = (1 - a) * dx[j - 1] + a * dx[j];
          dy[j] = (1 - a) * dy[j - 1] + a * dy[j];
        }
      }
      out.push(dx[p], dy[p]);
    }
    return out;
  }

  // ---------- achatar: blocos expandidos em polilinhas e textos prontos para desenhar ----------
  // saída: pts (Float32, relativos à origem), ini (início de cada polilinha), cam/cor/tipo por polilinha,
  // snaps (vértices reais, para "grudar" a medição), textos, camadas e caixa do desenho
  function achatar(m, ents = m.ents, LIMITE = 12e6) {
    const nomes = Object.keys(m.camadas);
    const idx = new Map(nomes.map((n, i) => [n, i]));
    const camadas = nomes.map((n) => ({ nome: n, cor: m.camadas[n].cor, ligada: m.camadas[n].ligada }));
    const cam = (n) => {
      if (!idx.has(n)) { idx.set(n, camadas.length); camadas.push({ nome: n, cor: 0xFFFFFF, ligada: true }); }
      return idx.get(n);
    };
    const pts = cresce(Float64Array), ini = cresce(Uint32Array), ci = cresce(Uint16Array), co = cresce(Uint32Array), ti = cresce(Uint8Array), sn = cresce(Float64Array);
    const textos = [];
    const blocos = new Map(); // "bloco|camada" → {bloco, camada, n, soltos}  (soltos = inseridos direto no desenho)
    const atributos = [];     // blocos com atributos: {bloco, camada, x, y, at: {TAG: valor}}
    let cortado = false;

    function poly(lista, M, fech, c, cor, tipo) {
      const n = lista.length / 2;
      if (n < 2) return;
      if (pts.n / 2 + n > LIMITE) { cortado = true; return; }
      ini.push(pts.n / 2);
      for (let i = 0; i < lista.length; i += 2) {
        const x = lista[i], y = lista[i + 1];
        pts.push(M[0] * x + M[2] * y + M[4]);
        pts.push(M[1] * x + M[3] * y + M[5]);
      }
      ci.push(c); co.push(cor); ti.push((fech ? 1 : 0) | tipo);
    }
    function snap(x, y, M) { sn.push(M[0] * x + M[2] * y + M[4]); sn.push(M[1] * x + M[3] * y + M[5]); }

    function corEf(e, camNome, corBloco) {
      if (e.rgb !== undefined && e.cor !== 0 && e.cor !== 256) return e.rgb;
      if (e.cor === 256) return (m.camadas[camNome] || { cor: 0xFFFFFF }).cor;
      if (e.cor === 0) return corBloco;
      return ACI[e.cor] ?? 0xFFFFFF;
    }

    function desenhar(ents, M, camPai, corPai, nivel) {
      for (const e of ents) {
        if (cortado) return;
        const camNome = e.c === '0' && camPai !== null ? camPai : e.c;
        const c = cam(camNome), cor = corEf(e, camNome, corPai);
        switch (e.k) {
          case 'p': {
            const l = comBulges(e.pts, e.b, e.f);
            poly(l, M, e.f, c, cor, 0);
            for (let i = 0; i < e.pts.length; i += 2) snap(e.pts[i], e.pts[i + 1], M);
            break;
          }
          case 's': poly(e.pts, M, false, c, cor, 0); if (e.pts.length >= 2) { snap(e.pts[0], e.pts[1], M); snap(e.pts[e.pts.length - 2], e.pts[e.pts.length - 1], M); } break;
          case 'c': poly(arcoPts(e.x, e.y, e.r, 0, PI2, false), M, true, c, cor, 0); snap(e.x, e.y, M); break;
          case 'a': {
            const l = arcoPts(e.x, e.y, e.r, e.a1, e.a2, false);
            poly(l, M, false, c, cor, 0);
            snap(e.x, e.y, M); snap(l[0], l[1], M); snap(l[l.length - 2], l[l.length - 1], M);
            break;
          }
          case 'e': {
            const cheia = Math.abs(e.a2 - e.a1 - PI2) < 1e-6 || (e.a1 === 0 && e.a2 === 0);
            poly(elipsePts(e.x, e.y, e.mx, e.my, e.razao, e.a1, cheia ? e.a1 + PI2 : e.a2, false), M, cheia, c, cor, 0);
            snap(e.x, e.y, M);
            break;
          }
          case 'f': poly(e.pts, M, true, c, cor, 2); break;
          case 'h': for (const l of e.lacos) poly(l, M, true, c, cor, e.solida ? 2 : 4); break;
          case 't': texto(e, M, c, cor); break;
          case 'i': {
            const b = m.blocos[e.bloco];
            if (!b || nivel > 16) break;
            // contagem (blocos anônimos de cota, hachura etc. começam com *)
            if (!String(e.bloco).startsWith('*')) {
              const k = e.bloco + '|' + camNome;
              const q = blocos.get(k) || { bloco: e.bloco, camada: camNome, n: 0, soltos: 0 };
              q.n += e.nc * e.nr;
              if (!nivel) q.soltos += e.nc * e.nr;
              blocos.set(k, q);
              const comTag = e.at.filter((a) => a.tag);
              if (comTag.length) {
                atributos.push({ bloco: e.bloco, camada: camNome, x: M[0] * e.x + M[2] * e.y + M[4], y: M[1] * e.x + M[3] * e.y + M[5],
                  at: Object.fromEntries(comTag.map((a) => [a.tag, a.t])) });
              }
            }
            const cs = Math.cos(e.rot), sr = Math.sin(e.rot);
            for (let ix = 0; ix < e.nc; ix++) for (let iy = 0; iy < e.nr; iy++) {
              // T(x,y)·R(rot)·T(colunas, linhas)·S(sx,sy)·T(-base)
              const ox = ix * e.dc, oy = iy * e.dr;
              const tx = e.x + cs * ox - sr * oy, ty = e.y + sr * ox + cs * oy;
              const L = [cs * e.sx, sr * e.sx, -sr * e.sy, cs * e.sy, 0, 0];
              L[4] = tx - (L[0] * b.x + L[2] * b.y);
              L[5] = ty - (L[1] * b.x + L[3] * b.y);
              desenhar(b.ents, mult(M, L), camNome, cor, nivel + 1);
            }
            snap(e.x, e.y, M);
            for (const a of e.at) {
              const ac = a.c === '0' ? camNome : a.c;
              texto(a, M, cam(ac), corEf(a, ac, cor));
            }
            break;
          }
        }
      }
    }
    function texto(e, M, c, cor) {
      const x = M[0] * e.x + M[2] * e.y + M[4], y = M[1] * e.x + M[3] * e.y + M[5];
      const esc = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
      let rot = e.rot + Math.atan2(M[1], M[0]);
      if (M[0] * M[3] - M[1] * M[2] < 0) rot = Math.atan2(M[1], M[0]) - e.rot + Math.PI;
      let t = e.t;
      // MTEXT com largura: quebra aproximada (≈ 0,6 da altura por letra)
      if (e.w > 0) {
        const max = Math.max(4, Math.floor(e.w / (e.h * 0.6)));
        t = t.split('\n').map((ln) => quebrar(ln, max)).join('\n');
      }
      textos.push({ x, y, h: e.h * esc, rot, t, ah: e.ah, av: e.av, c, cor });
    }

    desenhar(ents.filter((e) => e.k !== 'v'), [1, 0, 0, 1, 0, 0], null, 0xFFFFFF, 0);

    // caixa "robusta": ignora pontos perdidos muito longe (comuns em desenhos reais)
    const P = pts.fim();
    const caixa = caixaRobusta(P, textos);
    const ox = (caixa[0] + caixa[2]) / 2, oy = (caixa[1] + caixa[3]) / 2;
    const P32 = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 2) { P32[i] = P[i] - ox; P32[i + 1] = P[i + 1] - oy; }
    const S = sn.fim(), S32 = new Float32Array(S.length);
    for (let i = 0; i < S.length; i += 2) { S32[i] = S[i] - ox; S32[i + 1] = S[i + 1] - oy; }
    for (const t of textos) { t.x -= ox; t.y -= oy; }
    const I = ini.fim(), ini2 = new Uint32Array(I.length + 1);
    ini2.set(I); ini2[I.length] = P.length / 2;
    return {
      pts: P32, ini: ini2, cam: ci.fim(), cor: co.fim(), tipo: ti.fim(), snaps: S32, textos, camadas,
      origem: [ox, oy], caixa: [caixa[0] - ox, caixa[1] - oy, caixa[2] - ox, caixa[3] - oy], unidades: m.unidades, cortado,
      blocos: [...blocos.values()].sort((a, b) => b.n - a.n), atributos,
    };
  }

  // folhas de impressão: desenho do papel achatado + janelas para o modelo (coordenadas absolutas)
  function folhas(m) {
    const out = [];
    for (const l of [...m.layouts].sort((a, b) => a.ordem - b.ordem)) {
      const ativa = /^\*paper_space$/i.test(l.bloco);
      const ents = ativa && m.papel.length ? m.papel : (m.blocos[l.bloco] || { ents: [] }).ents;
      const janelas = ents.filter((e) => e.k === 'v' && e.ligada && e.w > 0 && e.h > 0 && e.vh > 0)
        .map((e) => ({ cx: e.cx, cy: e.cy, w: e.w, h: e.h, vcx: e.vcx, vcy: e.vcy, k: e.h / e.vh }));
      if (ents.length < 2 && !janelas.length) continue; // folha vazia
      const d = achatar(m, ents, 4e6);
      out.push({ nome: l.nome, d, janelas });
    }
    return out;
  }

  const quebrar = (s, max) => {
    if (s.length <= max) return s;
    const out = [];
    let ln = '';
    for (const w of s.split(' ')) {
      if (ln && (ln + ' ' + w).length > max) { out.push(ln); ln = w; } else ln = ln ? ln + ' ' + w : w;
    }
    if (ln) out.push(ln);
    return out.join('\n');
  };

  function caixaRobusta(P, textos) {
    const n = P.length / 2;
    if (!n) {
      if (!textos.length) return [0, 0, 1, 1];
      const xs = textos.map((t) => t.x), ys = textos.map((t) => t.y);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1];
    }
    const passo = Math.max(1, Math.floor(n / 20000));
    const xs = [], ys = [];
    for (let i = 0; i < n; i += passo) { xs.push(P[2 * i]); ys.push(P[2 * i + 1]); }
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
    let x1 = q(xs, 0.002), x2 = q(xs, 0.998), y1 = q(ys, 0.002), y2 = q(ys, 0.998);
    [x1, y1, x2, y2] = parteMaior(P, passo, x1, y1, x2, y2);
    const mx = (x2 - x1) * 0.04 || 1, my = (y2 - y1) * 0.04 || 1;
    return [x1 - mx, y1 - my, x2 + mx, y2 + my];
  }

  // desenho com partes muito distantes (ex.: planta-chave a km da planta): enquadra a parte com mais traços
  function parteMaior(P, passo, x1, y1, x2, y2) {
    const N = 48, cel = new Int32Array(N * N), w = (x2 - x1) || 1, h = (y2 - y1) || 1;
    const n = P.length / 2;
    for (let i = 0; i < n; i += passo) {
      const cx = Math.floor((P[2 * i] - x1) / w * N), cy = Math.floor((P[2 * i + 1] - y1) / h * N);
      if (cx >= 0 && cx < N && cy >= 0 && cy < N) cel[cx * N + cy]++;
    }
    // grupos de células ocupadas, juntando as que estão a até 2 células de distância
    const rot = new Int32Array(N * N).fill(-1), grupos = [];
    for (let s = 0; s < N * N; s++) {
      if (!cel[s] || rot[s] >= 0) continue;
      const g = { n: 0, a: N, b: N, c: -1, d: -1 }, fila = [s];
      rot[s] = grupos.length;
      while (fila.length) {
        const k = fila.pop(), cx = Math.floor(k / N), cy = k % N;
        g.n += cel[k]; g.a = Math.min(g.a, cx); g.b = Math.min(g.b, cy); g.c = Math.max(g.c, cx); g.d = Math.max(g.d, cy);
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
          const ax = cx + dx, ay = cy + dy, j = ax * N + ay;
          if (ax >= 0 && ax < N && ay >= 0 && ay < N && cel[j] && rot[j] < 0) { rot[j] = grupos.length; fila.push(j); }
        }
      }
      grupos.push(g);
    }
    if (grupos.length < 2) return [x1, y1, x2, y2];
    const maior = Math.max(...grupos.map((g) => g.n));
    let a = N, b = N, c = -1, dd = -1;
    for (const g of grupos) if (g.n >= maior * 0.25) { a = Math.min(a, g.a); b = Math.min(b, g.b); c = Math.max(c, g.c); dd = Math.max(dd, g.d); }
    return [x1 + a / N * w, y1 + b / N * h, x1 + (c + 1) / N * w, y1 + (dd + 1) / N * h];
  }

  const mult = (A, B) => [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];

  function cresce(Tipo) {
    let a = new Tipo(4096), n = 0;
    return {
      push(v) { if (n === a.length) { const b = new Tipo(a.length * 2); b.set(a); a = b; } a[n++] = v; },
      get n() { return n; },
      fim() { return a.slice(0, n); },
    };
  }

  // ---------- medição ----------
  function area(p) { // polígono [x,y,…] (fórmula do laço)
    let s = 0;
    for (let i = 0, n = p.length / 2; i < n; i++) {
      const j = (i + 1) % n;
      s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
    }
    return Math.abs(s) / 2;
  }
  function comprimento(p, fechado) {
    let s = 0;
    const n = p.length / 2;
    for (let i = 1; i < n; i++) s += Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
    if (fechado && n > 2) s += Math.hypot(p[0] - p[2 * n - 2], p[1] - p[2 * n - 1]);
    return s;
  }
  function dentro(px, py, p, a, b) { // ponto dentro do polígono (pts[a..b))
    let r = false;
    for (let i = a, j = b - 1; i < b; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) r = !r;
    }
    return r;
  }

  // unidades do $INSUNITS → metros por unidade do desenho
  const UNIDADES = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

  return { ACI, limparMtext, lerDxf, deLibre, achatar, folhas, area, comprimento, dentro, arcoPts, comBulges, splinePts, UNIDADES };
})();
