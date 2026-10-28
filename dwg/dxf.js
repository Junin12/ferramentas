// Grava o desenho (espaço do modelo) como DXF R12 (AC1009): o formato mais simples, que qualquer programa de CAD abre.
// Vão: linhas, polilinhas (com arcos), círculos, arcos, textos, blocos e cotas (como blocos). Elipses e splines viram polilinhas.
// Não vão: hachuras, tipos de linha, estilos de texto e folhas de impressão.
'use strict';

const CadDxf = (() => {
  const RAD = 180 / Math.PI;
  const n = (v) => { const r = Math.round(v * 1e6) / 1e6; return Object.is(r, -0) ? '0' : String(r); };

  // cor RGB → índice ACI mais próximo (R12 não tem cor verdadeira)
  function aciMaisProxima(rgb) {
    const r = rgb >> 16 & 255, g = rgb >> 8 & 255, b = rgb & 255;
    let melhor = 7, md = Infinity;
    for (let i = 1; i < 256; i++) {
      const c = Cad.ACI[i], dr = (c >> 16 & 255) - r, dg = (c >> 8 & 255) - g, db = (c & 255) - b, dd = dr * dr + dg * dg + db * db;
      if (dd < md) { md = dd; melhor = i; }
    }
    return melhor;
  }

  // nomes de camada e bloco: só letras, números, $ - _ e até 31 caracteres, sem repetir.
  // Blocos anônimos (*D cotas, *U, *X hachuras…) mantêm o * e são gravados com a marca de anônimo.
  function nomeador() {
    const usados = new Map(), vistos = new Set();
    return (nome) => {
      nome = String(nome ?? '0');
      if (usados.has(nome)) return usados.get(nome);
      const anon = nome.startsWith('*');
      let base = (anon ? '*' : '') + (anon ? nome.slice(1) : nome).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_$-]/g, '_').toUpperCase();
      base = base.slice(0, 31) || '_';
      let s = base, i = 1;
      while (vistos.has(s)) { const suf = '_' + i++; s = base.slice(0, 31 - suf.length) + suf; }
      vistos.add(s); usados.set(nome, s);
      return s;
    };
  }

  function escrever(m, ocultas) {
    const out = [];
    const L = (...pares) => { for (let i = 0; i < pares.length; i += 2) out.push(String(pares[i]).padStart(3), pares[i + 1]); };
    const nomeCam = nomeador(), nomeBloco = nomeador();
    const ocult = new Set(ocultas);
    const cor = (e) => (e.rgb !== undefined && e.cor !== 0 && e.cor !== 256 ? aciMaisProxima(e.rgb) : e.cor ?? 256);

    // só os blocos usados (direta ou indiretamente) pelo modelo
    const usados = new Set();
    const marcar = (ents) => { for (const e of ents) if (e.k === 'i' && m.blocos[e.bloco] && !usados.has(e.bloco)) { usados.add(e.bloco); marcar(m.blocos[e.bloco].ents); } };
    marcar(m.ents);

    function ent(e) {
      const c = nomeCam(e.c), cr = cor(e);
      const comum = [8, c, 62, cr];
      switch (e.k) {
        case 'p': {
          const np = e.pts.length / 2;
          if (np < 2) return;
          const temB = e.b && e.b.some((v) => v);
          if (np === 2 && !temB && !e.f) { L(0, 'LINE', ...comum, 10, n(e.pts[0]), 20, n(e.pts[1]), 30, 0, 11, n(e.pts[2]), 21, n(e.pts[3]), 31, 0); return; }
          L(0, 'POLYLINE', ...comum, 66, 1, 10, 0, 20, 0, 30, 0, 70, e.f ? 1 : 0);
          for (let i = 0; i < np; i++) {
            L(0, 'VERTEX', 8, c, 10, n(e.pts[2 * i]), 20, n(e.pts[2 * i + 1]), 30, 0);
            if (temB && e.b[i]) L(42, n(e.b[i]));
          }
          L(0, 'SEQEND', 8, c);
          return;
        }
        case 's': case 'e': {
          const pts = e.k === 's' ? e.pts : Cad.arcoPts ? elipse(e) : [];
          if (pts.length < 4) return;
          L(0, 'POLYLINE', ...comum, 66, 1, 10, 0, 20, 0, 30, 0, 70, 0);
          for (let i = 0; i < pts.length; i += 2) L(0, 'VERTEX', 8, c, 10, n(pts[i]), 20, n(pts[i + 1]), 30, 0);
          L(0, 'SEQEND', 8, c);
          return;
        }
        case 'c': L(0, 'CIRCLE', ...comum, 10, n(e.x), 20, n(e.y), 30, 0, 40, n(e.r)); return;
        case 'a': L(0, 'ARC', ...comum, 10, n(e.x), 20, n(e.y), 30, 0, 40, n(e.r), 50, n(e.a1 * RAD), 51, n(e.a2 * RAD)); return;
        case 'f': if (e.pts.length >= 8) L(0, 'SOLID', ...comum, 10, n(e.pts[0]), 20, n(e.pts[1]), 30, 0, 11, n(e.pts[2]), 21, n(e.pts[3]), 31, 0,
          12, n(e.pts[6]), 22, n(e.pts[7]), 32, 0, 13, n(e.pts[4]), 23, n(e.pts[5]), 33, 0); return;
        case 't': texto(e, c, cr); return;
        case 'i': {
          if (!usados.has(e.bloco)) return;
          L(0, 'INSERT', ...comum, 2, nomeBloco(e.bloco), 10, n(e.x), 20, n(e.y), 30, 0, 41, n(e.sx), 42, n(e.sy), 43, 1, 50, n(e.rot * RAD));
          if (e.nc > 1 || e.nr > 1) L(70, e.nc, 71, e.nr, 44, n(e.dc), 45, n(e.dr));
          // atributos viram textos comuns (no R12 eles precisariam da definição no bloco)
          for (const a of e.at) texto(a, a.c === '0' ? c : nomeCam(a.c), cor(a));
          return;
        }
      }
    }
    // MTEXT de várias linhas vira um TEXT por linha
    function texto(e, c, cr) {
      const linhas = e.t.split('\n'), passo = e.h * 1.66;
      const dx = Math.sin(e.rot) * passo, dy = -Math.cos(e.rot) * passo;
      const desl = linhas.length > 1 ? (e.av === 3 ? 0 : e.av === 2 ? -(linhas.length - 1) / 2 : -(linhas.length - 1)) : 0;
      linhas.forEach((t, i) => {
        if (!t.trim()) return;
        const x = e.x + dx * (i + desl), y = e.y + dy * (i + desl);
        L(0, 'TEXT', 8, c, 62, cr, 10, n(x), 20, n(y), 30, 0, 40, n(e.h), 1, t.replace(/[\r\n]/g, ' '), 50, n(e.rot * RAD));
        if (e.ah || e.av) L(72, e.ah || 0, 73, e.av || 0, 11, n(x), 21, n(y), 31, 0);
      });
    }
    function elipse(e) {
      const cheia = Math.abs(e.a2 - e.a1 - 2 * Math.PI) < 1e-6;
      const nx = -e.my * e.razao, ny = e.mx * e.razao, pts = [];
      let d = e.a2 - e.a1; while (d <= 0) d += 2 * Math.PI;
      const k = Math.max(8, Math.ceil(d / (2 * Math.PI) * 72));
      for (let i = 0; i <= k; i++) { const t = e.a1 + d * i / k; pts.push(e.x + e.mx * Math.cos(t) + nx * Math.sin(t), e.y + e.my * Math.cos(t) + ny * Math.sin(t)); }
      if (cheia) pts.push(pts[0], pts[1]);
      return pts;
    }

    // ---- cabeçalho e tabelas ----
    L(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$DWGCODEPAGE', 3, 'ANSI_1252', 0, 'ENDSEC');
    // gera o conteúdo antes das tabelas para conhecer todas as camadas usadas
    const corpo = out.splice(0);
    L(0, 'SECTION', 2, 'BLOCKS');
    for (const nome of usados) {
      const b = m.blocos[nome], nb = nomeBloco(nome);
      L(0, 'BLOCK', 8, '0', 2, nb, 70, nb.startsWith('*') ? 1 : 0, 10, n(b.x), 20, n(b.y), 30, 0, 3, nb);
      for (const e of b.ents) ent(e);
      L(0, 'ENDBLK', 8, '0');
    }
    L(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
    for (const e of m.ents) if (!ocult.has(e.c)) ent(e);
    L(0, 'ENDSEC', 0, 'EOF');
    const conteudo = out.splice(0);

    L(0, 'SECTION', 2, 'TABLES');
    L(0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0, 0, 'ENDTAB');
    const camadas = Object.keys(m.camadas);
    if (!camadas.includes('0')) camadas.unshift('0');
    L(0, 'TABLE', 2, 'LAYER', 70, camadas.length);
    for (const nome of camadas) {
      const info = m.camadas[nome] || { cor: 0xFFFFFF, ligada: true };
      const ci = aciMaisProxima(info.cor);
      L(0, 'LAYER', 2, nomeCam(nome), 70, 0, 62, info.ligada ? ci : -ci, 6, 'CONTINUOUS');
    }
    L(0, 'ENDTAB');
    L(0, 'TABLE', 2, 'STYLE', 70, 1, 0, 'STYLE', 2, 'STANDARD', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, '', 0, 'ENDTAB');
    L(0, 'ENDSEC');
    const tabelas = out.splice(0);

    // Windows-1252 (letras acentuadas); o que não cabe vira "?"
    const txt = [...corpo, ...tabelas, ...conteudo].join('\r\n') + '\r\n';
    const bytes = new Uint8Array(txt.length);
    for (let i = 0; i < txt.length; i++) { const ch = txt.charCodeAt(i); bytes[i] = ch < 256 ? ch : 63; }
    return bytes;
  }

  return { escrever };
})();
