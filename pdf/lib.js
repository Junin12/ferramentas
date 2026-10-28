// Lógica pura da conversão PDF -> Word (sem DOM, testável no Node).
// Coordenadas em pontos, origem no canto superior esquerdo da página (y cresce para baixo).
(function (root) {
  'use strict';

  const T = 2.5; // tolerância para considerar retas e bordas coincidentes
  const tw = (pt) => Math.max(0, Math.round(pt * 20)); // pontos -> twips (1/20 de ponto)
  const perto = (a, b, t = T) => Math.abs(a - b) <= t;
  const limita = (v, a, b) => Math.min(b, Math.max(a, v));

  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  /* ---------- texto: linhas, trechos (separados por espaço grande) e estilos ---------- */

  const estilo = (i) => [i.bold ? 1 : 0, i.italic ? 1 : 0, i.cor || '', i.fonte || '', Math.round(i.size * 2)].join('|');

  function addRun(tr, t, it) {
    const k = estilo(it);
    const ult = tr.runs[tr.runs.length - 1];
    if (ult && ult.k === k) ult.t += t;
    else tr.runs.push({ k, t, bold: it.bold, italic: it.italic, cor: it.cor, fonte: it.fonte, size: it.size });
  }

  function fecharLinha(l) {
    l.items.sort((a, b) => a.x - b.x);
    l.trechos = [];
    let tr = null;
    let fim = null;
    for (const it of l.items) {
      const gap = fim === null ? 0 : it.x - fim;
      if (!tr || gap > l.size * 1.6) {
        tr = { x: it.x, right: it.x + it.w, runs: [] };
        l.trechos.push(tr);
      } else if (gap > l.size * 0.15) {
        const ult = tr.runs[tr.runs.length - 1];
        if (ult && !/\s$/.test(ult.t) && !/^\s/.test(it.str)) addRun(tr, ' ', it);
      }
      addRun(tr, it.str, it);
      tr.right = Math.max(tr.right, it.x + it.w);
      fim = Math.max(fim === null ? -Infinity : fim, it.x + it.w);
    }
    for (const t of l.trechos) {
      t.runs.forEach((r) => (r.t = r.t.replace(/\s+/g, ' ')));
      t.runs[0].t = t.runs[0].t.replace(/^ /, '');
      t.runs[t.runs.length - 1].t = t.runs[t.runs.length - 1].t.replace(/ $/, '');
      t.runs = t.runs.filter((r) => r.t);
    }
    l.trechos = l.trechos.filter((t) => t.runs.length);
    l.x = l.trechos.length ? l.trechos[0].x : l.items[0].x;
    l.right = Math.max(...l.trechos.map((t) => t.right));
    l.text = l.trechos.map((t) => t.runs.map((r) => r.t).join('')).join(' ');
  }

  // items: [{str, x, y (linha de base), w, size, bold, italic, cor, fonte}] -> linhas de texto
  function montarLinhas(items) {
    const its = items.filter((i) => i.str && i.str.trim() !== '').sort((a, b) => a.y - b.y || a.x - b.x);
    const linhas = [];
    for (const it of its) {
      const l = linhas[linhas.length - 1];
      if (l && Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.size, it.size) * 0.4)) {
        l.items.push(it);
        l.size = Math.max(l.size, it.size);
      } else linhas.push({ y: it.y, size: it.size, items: [it] });
    }
    linhas.forEach(fecharLinha);
    return linhas.filter((l) => l.trechos.length);
  }

  // Junta linhas consecutivas só quando a anterior vai até perto da margem direita
  // (parágrafo corrido). Listas, colunas alinhadas e títulos ficam em parágrafos próprios.
  function paragrafos(linhas) {
    if (!linhas.length) return [];
    const maxRight = Math.max(...linhas.map((l) => l.right));
    const paras = [];
    let cur = null;
    let prev = null;
    for (const l of linhas) {
      const continua =
        cur && prev &&
        prev.trechos.length === 1 && l.trechos.length === 1 &&
        l.y - prev.y <= l.size * 1.7 &&
        Math.abs(prev.size - l.size) < 1.5 &&
        prev.right >= maxRight * 0.9 &&
        Math.abs(prev.x - l.x) < l.size * 3;
      if (continua) cur.linhas.push(l);
      else {
        cur = { linhas: [l] };
        paras.push(cur);
      }
      prev = l;
    }
    for (const p of paras) {
      const a = p.linhas[0];
      const z = p.linhas[p.linhas.length - 1];
      p.x = a.x;
      p.right = Math.max(...p.linhas.map((l) => l.right));
      p.top = a.y - a.size * 0.9;
      p.bottom = z.y + z.size * 0.25;
      if (p.linhas.length === 1) p.trechos = a.trechos;
      else {
        const runs = [];
        p.linhas.forEach((l, i) => {
          const rs = l.trechos[0].runs.map((r) => ({ ...r }));
          if (i) rs[0].t = ' ' + rs[0].t;
          runs.push(...rs);
        });
        p.trechos = [{ x: p.x, right: p.right, runs }];
      }
    }
    return paras;
  }

  /* ---------- retas desenhadas -> células -> tabelas ---------- */

  // retas: {h: true|false, p (y da horizontal ou x da vertical), a, b (início e fim), cor}
  function juntar(lst) {
    lst = lst.slice().sort((s, t) => s.p - t.p || s.a - t.a);
    const out = [];
    for (const s of lst) {
      let alvo = null;
      for (let j = out.length - 1; j >= 0 && out[j].p >= s.p - 1.5; j--) {
        const o = out[j];
        if (s.a <= o.b + 1.5 && s.b >= o.a - 1.5) { alvo = o; break; }
      }
      if (alvo) {
        alvo.a = Math.min(alvo.a, s.a);
        alvo.b = Math.max(alvo.b, s.b);
      } else out.push({ ...s });
    }
    return out;
  }

  function acharCelulas(H, V) {
    const cobreH = (y, xa, xb) => H.some((h) => perto(h.p, y) && h.a <= xa + T && h.b >= xb - T);
    const cobreV = (x, ya, yb) => V.some((v) => perto(v.p, x) && v.a <= ya + T && v.b >= yb - T);
    const cruzH = H.map(() => []);
    const cruzV = V.map(() => []);
    const pontos = [];
    H.forEach((h, i) => V.forEach((v, j) => {
      if (v.p >= h.a - T && v.p <= h.b + T && h.p >= v.a - T && h.p <= v.b + T) {
        cruzH[i].push(v.p);
        cruzV[j].push(h.p);
        pontos.push([i, j]);
      }
    }));
    cruzH.forEach((l) => l.sort((a, b) => a - b));
    cruzV.forEach((l) => l.sort((a, b) => a - b));
    const cels = [];
    const vistas = new Set();
    // cada cruzamento é o canto superior esquerdo de no máximo uma célula: a menor que fecha
    for (const [i, j] of pontos) {
      const x = V[j].p;
      const y = H[i].p;
      const xs = cruzH[i].filter((x2) => x2 > x + T);
      const ys = cruzV[j].filter((y2) => y2 > y + T);
      achou: for (const x2 of xs) {
        for (const y2 of ys) {
          if (cobreH(y2, x, x2) && cobreV(x2, y, y2)) {
            const k = [x, y, x2, y2].map(Math.round).join(',');
            if (!vistas.has(k) && x2 - x >= 3 && y2 - y >= 3) {
              vistas.add(k);
              cels.push({ x1: x, y1: y, x2, y2, items: [], imgs: [] });
            }
            break achou;
          }
        }
      }
    }
    return cels;
  }

  // Tabela "aberta" (só divisórias, sem a moldura inteira, como em muitos laudos):
  // devolve as bordas que faltam na moldura, como retas invisíveis
  function fecharAbertas(H, V) {
    const todas = [...H, ...V];
    const pai = todas.map((_, i) => i);
    const raiz = (i) => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
    H.forEach((h, i) => V.forEach((v, j) => {
      if (v.p >= h.a - T && v.p <= h.b + T && h.p >= v.a - T && h.p <= v.b + T) pai[raiz(i)] = raiz(H.length + j);
    }));
    const grupos = new Map();
    todas.forEach((l, i) => { const r = raiz(i); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(l); });
    const novas = [];
    for (const g of grupos.values()) {
      const hs = g.filter((l) => l.h);
      const vs = g.filter((l) => !l.h);
      if (hs.length < 2 || vs.length < 2) continue;
      const x1 = Math.min(...hs.map((h) => h.a), ...vs.map((v) => v.p));
      const x2 = Math.max(...hs.map((h) => h.b), ...vs.map((v) => v.p));
      const y1 = Math.min(...vs.map((v) => v.a), ...hs.map((h) => h.p));
      const y2 = Math.max(...vs.map((v) => v.b), ...hs.map((h) => h.p));
      if (hs.filter((h) => h.b - h.a >= (x2 - x1) * 0.8).length < 2) continue;
      const temH = (y) => hs.some((h) => perto(h.p, y) && h.a <= x1 + T && h.b >= x2 - T);
      const temV = (x) => vs.some((v) => perto(v.p, x) && v.a <= y1 + T && v.b >= y2 - T);
      if (!temH(y1)) novas.push({ h: true, p: y1, a: x1, b: x2, virtual: true });
      if (!temH(y2)) novas.push({ h: true, p: y2, a: x1, b: x2, virtual: true });
      if (!temV(x1)) novas.push({ h: false, p: x1, a: y1, b: y2, virtual: true });
      if (!temV(x2)) novas.push({ h: false, p: x2, a: y1, b: y2, virtual: true });
    }
    return novas;
  }

  // a borda só aparece no Word se havia reta desenhada cobrindo a maior parte daquele lado
  const desenhada = (L, p, a, b) => L.some((l) => !l.virtual && perto(l.p, p) && Math.min(l.b, b) - Math.max(l.a, a) >= (b - a) * 0.7);

  const dentro = (a, b, t = T) => a.x1 >= b.x1 - t && a.x2 <= b.x2 + t && a.y1 >= b.y1 - t && a.y2 <= b.y2 + t;
  const contem = (c, x, y) => x > c.x1 && x < c.x2 && y > c.y1 && y < c.y2;
  const pontoTexto = (it) => [it.x + Math.min(it.w, it.size) * 0.5, it.y - it.size * 0.3];

  function grade(vals) {
    const v = vals.slice().sort((a, b) => a - b);
    const out = [];
    for (const x of v) if (!out.length || x - out[out.length - 1] > T) out.push(x);
    return out;
  }
  const indice = (lst, v) => lst.reduce((m, x, i) => (Math.abs(x - v) < Math.abs(lst[m] - v) ? i : m), 0);

  // conteúdo de uma célula: linhas de texto e imagens, de cima para baixo
  function conteudo(items, imgs) {
    return [...montarLinhas(items), ...imgs.map((im) => ({ img: im, y: im.y + im.h, size: im.h }))].sort((a, b) => a.y - b.y);
  }
  const topoDe = (l) => (l.img ? l.img.y : l.y - l.size * 0.9);
  const baseDe = (l) => (l.img ? l.img.y + l.img.h : l.y + l.size * 0.25);

  // soltos: textos dentro da área da tabela mas fora das células (vão para os espaços sem borda);
  // os que forem usados são marcados com .usado
  function montarTabela(cels, medSize, corBorda, soltos) {
    const xs = grade(cels.flatMap((c) => [c.x1, c.x2]));
    const ys = grade(cels.flatMap((c) => [c.y1, c.y2]));
    for (const c of cels) {
      c.c0 = indice(xs, c.x1); c.c1 = indice(xs, c.x2);
      c.r0 = indice(ys, c.y1); c.r1 = indice(ys, c.y2);
      c.linhas = conteudo(c.items, c.imgs);
    }
    cels = cels.filter((c) => c.c1 > c.c0 && c.r1 > c.r0);
    const nC = xs.length - 1;
    const cobre = (k, r, c) => k.r0 <= r && k.r1 > r && k.c0 <= c && k.c1 > c;
    const linhas = [];
    for (let r = 0; r < ys.length - 1; r++) {
      const pedacos = [];
      for (let c = 0; c < nC;) {
        const cel = cels.find((k) => cobre(k, r, c));
        if (cel) {
          pedacos.push({ cel, span: cel.c1 - c, vm: cel.r1 - cel.r0 > 1 ? (cel.r0 === r ? 'restart' : 'cont') : null });
          c = cel.c1;
        } else {
          let c2 = c + 1;
          while (c2 < nC && !cels.some((k) => cobre(k, r, c2))) c2++;
          const vaga = { x1: xs[c], x2: xs[c2], y1: ys[r], y2: ys[r + 1] };
          const dela = soltos.filter((it) => !it.usado && contem(vaga, ...pontoTexto(it)));
          dela.forEach((it) => (it.usado = true));
          pedacos.push({ cel: null, vaga, linhas: conteudo(dela, []), span: c2 - c, vm: null });
          c = c2;
        }
      }
      const y1 = ys[r];
      const y2 = ys[r + 1];
      const proprias = pedacos.filter((p) => p.cel);
      const textuais = proprias.filter((p) => p.cel.linhas.filter((l) => !l.img).length >= 3);
      // corpo de tabela só com divisórias verticais (ex.: laudos): uma linha do Word por linha de texto
      const dividir = y2 - y1 > medSize * 4 && proprias.every((p) => !p.vm) &&
        textuais.length >= Math.max(2, proprias.length / 2);
      if (!dividir) {
        linhas.push({
          y1, y2,
          partes: pedacos.map((p) => ({
            ...p,
            y1: p.cel ? p.cel.y1 : y1, y2: p.cel ? p.cel.y2 : y2,
            linhas: p.cel ? (p.vm !== 'cont' ? p.cel.linhas : []) : p.linhas,
            bordas: p.cel ? p.cel.bordas : null,
          })),
        });
        continue;
      }
      const todas = proprias.flatMap((p) => p.cel.linhas).sort((a, b) => a.y - b.y);
      const grupos = [];
      for (const l of todas) {
        const g = grupos[grupos.length - 1];
        if (g && l.y - g.fim <= Math.max(2, l.size * 0.6)) g.fim = l.y;
        else grupos.push({ y: l.y, fim: l.y, size: l.size });
      }
      const lim = [y1, ...grupos.slice(1).map((g, i) => (grupos[i].fim + g.y) / 2 + g.size * 0.2), y2];
      grupos.forEach((g, i) => linhas.push({
        y1: lim[i], y2: lim[i + 1],
        partes: pedacos.map((p) => ({
          ...p, vm: null, y1: lim[i], y2: lim[i + 1],
          linhas: (p.cel ? p.cel.linhas : p.linhas).filter((l) => l.y > lim[i] && l.y <= lim[i + 1]),
          bordas: p.cel ? { t: i === 0 && p.cel.bordas.t, b: i === grupos.length - 1 && p.cel.bordas.b, l: p.cel.bordas.l, r: p.cel.bordas.r } : null,
        })),
      }));
    }
    // linha alta e vazia (resto de moldura da página) só empurraria o conteúdo para outra folha
    const uteis = linhas.filter((l) => l.y2 - l.y1 < 60 || l.partes.some((p) => p.vm || p.linhas.length));
    return { x1: xs[0], x2: xs[xs.length - 1], y1: ys[0], y2: ys[ys.length - 1], xs, linhas: uteis.length ? uteis : linhas, corBorda, cels };
  }

  // Acha tabelas com bordas e distribui nelas os textos e imagens que caem nas células.
  // Devolve as tabelas e o que sobrou fora delas.
  function tabelasDaPagina({ retas, fundos, itens, imagens }) {
    const H = juntar(retas.filter((r) => r.h));
    const V = juntar(retas.filter((r) => !r.h));
    if (!H.length || !V.length || H.length * V.length > 60000) return { tabelas: [], itens, imagens };
    const abertas = fecharAbertas(H, V);
    let cels = acharCelulas(H.concat(abertas.filter((l) => l.h)), V.concat(abertas.filter((l) => !l.h)));
    if (cels.length > 3000) return { tabelas: [], itens, imagens };
    for (const c of cels) {
      c.bordas = { t: desenhada(H, c.y1, c.x1, c.x2), b: desenhada(H, c.y2, c.x1, c.x2), l: desenhada(V, c.x1, c.y1, c.y2), r: desenhada(V, c.x2, c.y1, c.y2) };
    }

    // célula que contém outras: se as de dentro têm texto, a de fora é só moldura; senão as de dentro são enfeite
    const pts = itens.map(pontoTexto);
    const temTexto = (c) => pts.some(([x, y]) => contem(c, x, y));
    const fora = new Set();
    for (const a of cels) {
      const filhas = cels.filter((b) => b !== a && dentro(b, a));
      if (!filhas.length) continue;
      if (filhas.some(temTexto)) fora.add(a);
      else filhas.forEach((b) => fora.add(b));
    }
    cels = cels.filter((c) => !fora.has(c));

    // textos: cada pedaço vai para a célula onde cai; o que passa da borda (com espaço) é cortado
    const sobra = [];
    const fila = itens.slice();
    while (fila.length) {
      const it = fila.shift();
      const [px, py] = pontoTexto(it);
      const c = cels.find((k) => contem(k, px, py));
      if (!c) { sobra.push(it); continue; }
      if (it.x + it.w > c.x2 + 2 && it.str.trim().includes(' ')) {
        const cw = it.w / it.str.length;
        const corte = it.str.lastIndexOf(' ', Math.floor((c.x2 - it.x) / cw));
        if (corte > 0) {
          c.items.push({ ...it, str: it.str.slice(0, corte), w: corte * cw });
          fila.unshift({ ...it, str: it.str.slice(corte + 1), x: it.x + (corte + 1) * cw, w: it.w - (corte + 1) * cw });
          continue;
        }
      }
      c.items.push(it);
    }
    const imgsSobra = [];
    for (const im of imagens) {
      const c = cels.find((k) => contem(k, im.x + im.w / 2, im.y + im.h / 2) && im.w <= k.x2 - k.x1 + T && im.h <= k.y2 - k.y1 + T);
      if (c) c.imgs.push(im);
      else imgsSobra.push(im);
    }

    // fundo colorido da célula
    for (const c of cels) {
      const area = (c.x2 - c.x1) * (c.y2 - c.y1);
      const f = fundos
        .filter((f) => f.cor !== 'FFFFFF' && dentro(c, f) && (f.x2 - f.x1) * (f.y2 - f.y1) <= area * 40)
        .sort((a, b) => (a.x2 - a.x1) * (a.y2 - a.y1) - (b.x2 - b.x1) * (b.y2 - b.y1))[0];
      if (f) c.fundo = f.cor;
    }

    // células que se tocam formam uma tabela
    const pai = cels.map((_, i) => i);
    const raiz = (i) => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
    const toca = (a, b) =>
      ((perto(a.x2, b.x1) || perto(b.x2, a.x1)) && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > T) ||
      ((perto(a.y2, b.y1) || perto(b.y2, a.y1)) && Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > T);
    for (let i = 0; i < cels.length; i++) for (let j = i + 1; j < cels.length; j++) if (toca(cels[i], cels[j])) pai[raiz(i)] = raiz(j);
    const grupos = new Map();
    cels.forEach((c, i) => { const r = raiz(i); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(c); });

    const tamanhos = itens.map((i) => i.size).sort((a, b) => a - b);
    const medSize = tamanhos[Math.floor(tamanhos.length / 2)] || 10;
    const alturaPagina = Math.max(...itens.map((i) => i.y), ...cels.map((c) => c.y2), 1);
    const tabelas = [];
    for (const g of grupos.values()) {
      const vazio = g.every((c) => !c.items.length && !c.imgs.length);
      // caixa sozinha vazia, ou moldura em volta da página: não é tabela
      if (vazio || (g.length === 1 && g[0].y2 - g[0].y1 > alturaPagina * 0.4)) {
        g.forEach((c) => { sobra.push(...c.items); imgsSobra.push(...c.imgs); });
        continue;
      }
      const x1 = Math.min(...g.map((c) => c.x1));
      const x2 = Math.max(...g.map((c) => c.x2));
      const y1 = Math.min(...g.map((c) => c.y1));
      const y2 = Math.max(...g.map((c) => c.y2));
      const borda = H.find((h) => h.p >= y1 - T && h.p <= y2 + T && h.b > x1 && h.a < x2);
      tabelas.push(montarTabela(g, medSize, (borda && borda.cor) || '000000', sobra));
    }
    return { tabelas, itens: sobra.filter((it) => !it.usado), imagens: imgsSobra };
  }

  /* ---------- tabelas sem bordas: colunas de texto alinhadas ---------- */

  // une intervalos [a, b] que se sobrepõem; devolve as colunas ordenadas
  function uniao(ints) {
    const v = ints.slice().sort((p, q) => p[0] - q[0]);
    const out = [];
    for (const [a, b] of v) {
      const u = out[out.length - 1];
      if (u && a <= u[1] + 3) u[1] = Math.max(u[1], b);
      else out.push([a, b]);
    }
    return out;
  }

  function tabelaSemBorda(bloco, cols) {
    const xs = [cols[0][0] - 2, ...cols.slice(1).map((c, i) => (cols[i][1] + c[0]) / 2), cols[cols.length - 1][1] + 2];
    // alinhamento de cada coluna pela maioria das células (números costumam vir à direita)
    const meio = (v) => v.slice().sort((p, q) => p - q)[Math.floor(v.length / 2)];
    const alinh = cols.map(([a, b]) => {
      const trs = bloco.flatMap((l) => l.trechos.filter((t) => (t.x + t.right) / 2 >= a - 1 && (t.x + t.right) / 2 <= b + 1));
      if (trs.length < 2) return '';
      const n = (f) => { const m = meio(trs.map(f)); return trs.filter((t) => Math.abs(f(t) - m) <= 2).length; };
      const esq = n((t) => t.x);
      const dir = n((t) => t.right);
      const cen = n((t) => (t.x + t.right) / 2);
      if (dir > esq && dir >= trs.length * 0.6) return 'right';
      if (cen > esq && cen > dir && cen >= trs.length * 0.6) return 'center';
      return 'left';
    });
    const linhas = bloco.map((l, i) => {
      const prox = bloco[i + 1];
      const y1 = l.y - l.size * 0.95;
      const y2 = prox ? prox.y - prox.size * 0.95 : l.y + l.size * 0.3;
      const partes = cols.map(([a, b], c) => {
        const trs = l.trechos.filter((t) => (t.x + t.right) / 2 >= a - 1 && (t.x + t.right) / 2 <= b + 1);
        const conteudos = trs.length ? [{ y: l.y, size: l.size, trechos: trs, x: trs[0].x, right: Math.max(...trs.map((t) => t.right)), jc: trs.length === 1 && alinh[c] }] : [];
        return { cel: { x1: a - 2, x2: b + 2 }, span: 1, vm: null, y1, y2, linhas: conteudos, bordas: null };
      });
      return { y1, y2, partes };
    });
    return { x1: xs[0], x2: xs[xs.length - 1], y1: linhas[0].y1, y2: linhas[linhas.length - 1].y2, xs, linhas, corBorda: '000000' };
  }

  // Procura blocos de 3+ linhas seguidas cujos trechos formam as mesmas colunas.
  // Devolve as tabelas achadas e as linhas que continuam como texto.
  function tabelasSemBorda(linhas) {
    const tabelas = [];
    const resto = [];
    let bloco = [];
    let cols = [];
    const fechar = () => {
      // linha de um trecho só no fim do bloco (ex.: o título seguinte) não é linha da tabela
      while (bloco.length && bloco[bloco.length - 1].trechos.length < 2) resto.push(bloco.pop());
      cols = uniao(bloco.flatMap((l) => l.trechos.map((t) => [t.x, t.right])));
      const multi = bloco.filter((l) => l.trechos.length >= 2).length;
      const ok = cols.length >= 2 && multi >= bloco.length * 0.5 &&
        ((bloco.length >= 3 && cols.length >= 3) || bloco.length >= 4);
      if (ok) tabelas.push(tabelaSemBorda(bloco, cols));
      else resto.push(...bloco);
      bloco = [];
      cols = [];
    };
    for (const l of linhas) {
      const ant = bloco[bloco.length - 1];
      const perto = ant && l.y - ant.y <= Math.max(ant.size, l.size) * 2.4 && Math.abs(ant.size - l.size) < 2.5;
      if (!ant) {
        if (l.trechos.length >= 2) { bloco = [l]; cols = uniao(l.trechos.map((t) => [t.x, t.right])); }
        else resto.push(l);
        continue;
      }
      const novas = uniao(cols.concat(l.trechos.map((t) => [t.x, t.right])));
      // a linha entra se não junta colunas (um título largo, por exemplo, juntaria)
      if (perto && novas.length >= 2 && novas.length >= cols.length && (l.trechos.length >= 2 || bloco.length >= 2)) {
        bloco.push(l);
        cols = novas;
        continue;
      }
      fechar();
      if (l.trechos.length >= 2) { bloco = [l]; cols = uniao(l.trechos.map((t) => [t.x, t.right])); }
      else resto.push(l);
    }
    if (bloco.length) fechar();
    resto.sort((a, b) => a.y - b.y);
    return { tabelas, linhas: resto };
  }

  /* ---------- desenhos vetoriais (plantas, croquis, gráficos) -> regiões para virar imagem ---------- */

  // caminhos: [{x1,y1,x2,y2,t}] t: 0 reta horiz./vert., 1 reta inclinada (x1,y1 -> x2,y2), 2 área preenchida, 3 curva (caixa)
  function regioesDeDesenho(caminhos, W, H) {
    if (!caminhos.length) return [];
    const P = 3;
    const nx = Math.ceil(W / P) + 2;
    const ny = Math.ceil(H / P) + 2;
    const g = new Uint8Array(nx * ny);
    const cel = (x, y) => {
      const i = Math.floor(x / P);
      const j = Math.floor(y / P);
      return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1;
    };
    const marca = (x, y) => { const k = cel(x, y); if (k >= 0) g[k] = 1; };
    const reta = (x1, y1, x2, y2) => {
      const n = Math.min(4000, Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (P / 2))));
      for (let k = 0; k <= n; k++) marca(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n);
    };
    for (const c of caminhos) {
      if (c.t <= 1) reta(c.x1, c.y1, c.x2, c.y2);
      else if ((c.x2 - c.x1) * (c.y2 - c.y1) > W * H * 0.25) {
        reta(c.x1, c.y1, c.x2, c.y1); reta(c.x1, c.y2, c.x2, c.y2);
        reta(c.x1, c.y1, c.x1, c.y2); reta(c.x2, c.y1, c.x2, c.y2);
      } else {
        for (let x = c.x1; x < c.x2 + P; x += P) for (let y = c.y1; y < c.y2 + P; y += P) marca(Math.min(x, c.x2), Math.min(y, c.y2));
      }
    }
    // engorda as marcas para juntar traços vizinhos e rotula as manchas
    const d = new Uint8Array(nx * ny);
    const R = 2;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!g[j * nx + i]) continue;
      for (let b = Math.max(0, j - R); b <= Math.min(ny - 1, j + R); b++) for (let a = Math.max(0, i - R); a <= Math.min(nx - 1, i + R); a++) d[b * nx + a] = 1;
    }
    const rot = new Int32Array(nx * ny).fill(-1);
    let n = 0;
    const fila = new Int32Array(nx * ny);
    for (let k0 = 0; k0 < d.length; k0++) {
      if (!d[k0] || rot[k0] >= 0) continue;
      let ini = 0, fim = 0;
      fila[fim++] = k0;
      rot[k0] = n;
      while (ini < fim) {
        const k = fila[ini++];
        const i = k % nx;
        for (const v of [k - 1, k + 1, k - nx, k + nx]) {
          if (v < 0 || v >= d.length || (v === k - 1 && i === 0) || (v === k + 1 && i === nx - 1)) continue;
          if (d[v] && rot[v] < 0) { rot[v] = n; fila[fim++] = v; }
        }
      }
      n++;
    }
    const est = new Map();
    for (const c of caminhos) {
      const k = cel((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2);
      const r = k >= 0 ? rot[k] : -1;
      if (r < 0) continue;
      let e = est.get(r);
      if (!e) est.set(r, (e = { n: 0, comp: 0, x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }));
      e.n++;
      if (c.t >= 1) e.comp++;
      e.x1 = Math.min(e.x1, c.x1, c.x2); e.x2 = Math.max(e.x2, c.x1, c.x2);
      e.y1 = Math.min(e.y1, c.y1, c.y2); e.y2 = Math.max(e.y2, c.y1, c.y2);
    }
    const out = [];
    for (const e of est.values()) {
      if (e.x2 - e.x1 < 30 || e.y2 - e.y1 < 30) continue;
      if (e.comp < 6 && e.n < 40) continue;
      out.push({ x1: Math.max(0, e.x1 - 3), y1: Math.max(0, e.y1 - 3), x2: Math.min(W, e.x2 + 3), y2: Math.min(H, e.y2 + 3) });
    }
    return out;
  }

  /* ---------- XML do Word ---------- */

  function runXml(r) {
    const sz = limita(Math.round(r.size * 2), 8, 144);
    const f = r.fonte ? esc(r.fonte) : '';
    return '<w:r><w:rPr>' +
      (f ? `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>` : '') +
      (r.bold ? '<w:b/>' : '') + (r.italic ? '<w:i/>' : '') +
      (r.cor ? `<w:color w:val="${r.cor}"/>` : '') +
      `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`;
  }

  // p: {trechos, x, right}; L e R: limites do texto (margens da página ou da célula)
  // linha: altura exata da linha em pontos (células de uma linha só, para a tabela não crescer no Word)
  function paraXml(p, L, R, antes = 0, escala = 1, linha = 0) {
    const larg = R - L;
    const tr = p.trechos;
    let jc = '';
    let ind = 0;
    const tabs = [];
    if (p.jc) {
      jc = p.jc === 'left' ? '' : p.jc;
      if (!jc) ind = p.x - L;
    } else if (tr.length === 1) {
      const c = (p.x + p.right) / 2;
      // centralizado/à direita só vale para linha única e curta; parágrafo longo numa coluna da direita é só recuado
      const curta = (!p.linhas || p.linhas.length === 1) && p.right - p.x < larg * 0.75;
      if (curta && p.x > L + larg * 0.08 && Math.abs(c - (L + R) / 2) < larg * 0.04 + 3) jc = 'center';
      else if (curta && Math.abs(p.right - R) < 6 && p.x > L + larg * 0.3) jc = 'right';
      else ind = p.x - L;
    } else {
      ind = tr[0].x - L;
      let ant = ind;
      tr.slice(1).forEach((t, i, arr) => {
        const direita = i === arr.length - 1 && Math.abs(t.right - R) < 6;
        let pos = direita ? larg : t.x - L;
        if (pos <= ant + 3) pos = ant + 6;
        tabs.push(`<w:tab w:val="${direita ? 'right' : 'left'}" w:pos="${tw(pos * escala)}"/>`);
        ant = pos;
      });
    }
    return '<w:p><w:pPr>' +
      (tabs.length ? `<w:tabs>${tabs.join('')}</w:tabs>` : '') +
      `<w:spacing w:before="${antes}" w:after="0"${linha ? ` w:line="${tw(linha)}" w:lineRule="exact"` : ""}/>` +
      (ind > 1 ? `<w:ind w:left="${tw(ind * escala)}"/>` : '') +
      (jc ? `<w:jc w:val="${jc}"/>` : '') +
      '</w:pPr>' +
      tr.map((t, i) => (i ? '<w:r><w:tab/></w:r>' : '') + t.runs.map(runXml).join('')).join('') +
      '</w:p>';
  }

  let docPrId = 0;
  function imagemXml(im, L, R, antes = 0, escala = 1, maxH = 0) {
    let w = im.w * escala;
    let h = im.h * escala;
    const max = (R - L) * escala;
    if (w > max) { h *= max / w; w = max; }
    if (maxH && h > maxH) { w *= maxH / h; h = maxH; }
    const ind = limita((im.x - L) * escala, 0, Math.max(0, max - w));
    const cx = Math.round(w * 12700);
    const cy = Math.round(h * 12700);
    const id = ++docPrId;
    // linha com a altura exata da imagem: sem a folga de texto que o Word põe embaixo
    return '<w:p><w:pPr>' + `<w:spacing w:before="${antes}" w:after="0" w:line="${tw(h)}" w:lineRule="exact"/>` + (ind > 1 ? `<w:ind w:left="${tw(ind)}"/>` : '') + '</w:pPr>' +
      '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Imagem ${id}"/>` + graficoXml(im, id, cx, cy) +
      '</wp:inline></w:drawing></w:r></w:p>';
  }

  function graficoXml(im, id, cx, cy) {
    return '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="imagem${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${im.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic>';
  }

  // imagem solta, presa na posição exata da página (quando há texto ou tabela ao lado dela)
  function ancoraXml(im) {
    const id = ++docPrId;
    const e = (v) => Math.round(v * 12700);
    return '<w:r><w:drawing>' +
      `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
      '<wp:simplePos x="0" y="0"/>' +
      `<wp:positionH relativeFrom="page"><wp:posOffset>${e(im.x)}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="page"><wp:posOffset>${e(im.y)}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${e(im.w)}" cy="${e(im.h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
      `<wp:docPr id="${id}" name="Imagem ${id}"/><wp:cNvGraphicFramePr/>` + graficoXml(im, id, e(im.w), e(im.h)) +
      '</wp:anchor></w:drawing></w:r>';
  }

  // parágrafo quase invisível: dá a distância vertical antes de uma tabela e separa tabelas seguidas
  const espacador = (gap) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${limita(tw(gap), 20, 2000)}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>`;

  function tabelaXml(t, L, R) {
    const larg = t.xs.slice(1).map((x, i) => x - t.xs[i]);
    const total = larg.reduce((a, b) => a + b, 0);
    const escala = Math.min(1, (R - L) / total);
    const cols = larg.map((w) => Math.max(1, tw(w * escala)));
    const ind = escala < 1 ? 0 : Math.max(0, t.x1 - L);
    const borda = (lado, on) => (on ? `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="${t.corBorda}"/>` : `<w:${lado} w:val="nil"/>`);
    let xml = '<w:tbl><w:tblPr>' +
      `<w:tblW w:w="${cols.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblInd w:w="${tw(ind)}" w:type="dxa"/>` +
      '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="40" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid>' + cols.map((w) => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>';
    for (const ln of t.linhas) {
      const alt = ln.y2 - ln.y1;
      // o Word soma a espessura das bordas de cima e de baixo à altura da linha
      const bordaTB = (ln.partes.some((p) => p.bordas && p.bordas.t) ? 0.5 : 0) + (ln.partes.some((p) => p.bordas && p.bordas.b) ? 0.5 : 0);
      xml += `<w:tr><w:trPr><w:trHeight w:val="${tw(alt - bordaTB)}" w:hRule="atLeast"/></w:trPr>`;
      let c = 0;
      for (const p of ln.partes) {
        const w = cols.slice(c, c + p.span).reduce((a, b) => a + b, 0);
        c += p.span;
        const b = p.bordas || {};
        const conteudos = p.linhas.filter((l) => !l.img || l.img.rid); // imagem que não pôde ser extraída fica de fora
        let valign = 'top';
        if (conteudos.length) {
          const topo = Math.min(...conteudos.map(topoDe));
          const base = Math.max(...conteudos.map(baseDe));
          const gt = topo - p.y1;
          const gb = p.y2 - base;
          valign = Math.abs(gt - gb) <= (gt + gb) * 0.3 + 1 ? 'center' : gt < gb ? 'top' : 'bottom';
        }
        xml += '<w:tc><w:tcPr>' + `<w:tcW w:w="${w}" w:type="dxa"/>` +
          (p.span > 1 ? `<w:gridSpan w:val="${p.span}"/>` : '') +
          (p.vm === 'restart' ? '<w:vMerge w:val="restart"/>' : p.vm === 'cont' ? '<w:vMerge/>' : '') +
          `<w:tcBorders>${borda('top', b.t)}${borda('left', b.l)}${borda('bottom', b.b)}${borda('right', b.r)}</w:tcBorders>` +
          (p.cel && p.cel.fundo ? `<w:shd w:val="clear" w:color="auto" w:fill="${p.cel.fundo}"/>` : '') +
          `<w:vAlign w:val="${valign}"/></w:tcPr>`;
        if (!conteudos.length) xml += espacador(Math.min(alt - 1, 12));
        else {
          const cL = (p.cel || p.vaga).x1 + 2;
          const cR = (p.cel || p.vaga).x2 - 2;
          const unica = conteudos.length === 1 && !conteudos[0].img && !p.vm ? limita(alt - bordaTB - 0.3, conteudos[0].size * 1.05, conteudos[0].size * 1.15) : 0;
          xml += conteudos.map((l) => (l.img ? imagemXml(l.img, cL, cR, 0, escala) : paraXml(l, cL, cR, 0, escala, unica))).join('');
        }
        xml += '</w:tc>';
      }
      xml += '</w:tr>';
    }
    return xml + '</w:tbl>';
  }

  const sectPr = (W, H, m) =>
    `<w:sectPr><w:pgSz w:w="${tw(W)}" w:h="${tw(H)}"${W > H ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${tw(m.t)}" w:right="${tw(m.r)}" w:bottom="${tw(m.b)}" w:left="${tw(m.l)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

  // pg: {w, h, linhas (texto fora das tabelas), tabelas, imagens}
  function paginaXml(pg, ultima) {
    const blocos = [
      ...paragrafos(pg.linhas).map((p) => ({ tipo: 'p', top: p.top, bottom: p.bottom, x1: p.x, x2: p.right, p })),
      ...pg.tabelas.map((t) => ({ tipo: 't', top: t.y1, bottom: t.y2, x1: t.x1, x2: t.x2, t })),
      ...pg.imagens.filter((im) => im.rid).map((im) => ({ tipo: 'i', top: im.y, bottom: im.y + im.h, x1: im.x, x2: im.x + im.w, im })),
    ].sort((a, b) => a.top - b.top);
    const W = pg.w;
    const H = pg.h;
    const m = blocos.length
      ? {
          l: limita(Math.min(...blocos.map((b) => b.x1)) - 2, 14, 72),
          r: limita(W - Math.max(...blocos.map((b) => b.x2)) - 2, 14, 72),
          t: limita(Math.min(...blocos.map((b) => b.top)) - 2, 14, 72),
          b: limita(H - Math.max(...blocos.map((b) => b.bottom)) - 12, 6, 57),
        }
      : { l: 57, r: 57, t: 57, b: 57 };
    const L = m.l;
    const R = W - m.r;
    // imagem com algo ao lado (logo ao lado do cabeçalho, planta ao lado da tabela): no Word ela ficaria
    // empilhada e empurraria a página para baixo; vai solta, na posição exata, e não ocupa linha
    const ladoALado = (a, b) => a.top < b.bottom - 2 && a.bottom > b.top + 2 && (a.x2 <= b.x1 + 2 || a.x1 >= b.x2 - 2);
    const soltas = blocos.filter((b) => b.tipo === 'i' && blocos.some((o) => o !== b && ladoALado(o, b)));
    const maxH = H - m.t - m.b - 4;
    // altura que o bloco vai ocupar no Word (Arial: uma linha tem ~1,15 × o tamanho da letra)
    const altura = (b) => {
      if (b.tipo === 'p') return b.p.linhas.reduce((s, l) => s + l.size * 1.15, 0);
      if (b.tipo === 'i') {
        let h = b.im.h;
        if (b.im.w > R - L) h *= (R - L) / b.im.w;
        return Math.min(h, maxH);
      }
      return b.t.linhas.reduce((s, ln) => s + Math.max(ln.y2 - ln.y1, ...ln.partes.map((p) => (p.vm ? 0 :
        p.linhas.reduce((a, l) => a + (l.img ? l.img.h : l.size * (p.linhas.length === 1 ? 1.05 : 1.15)), 0)))), 0);
    };
    // "onde o Word está" na página: o espaço antes de cada bloco é medido a partir daí, e não do PDF,
    // para que uma diferença de altura lá em cima seja absorvida no próximo espaço em branco
    let cursor = m.t;
    let antTabela = false;
    let xml = soltas.length
      ? '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>' + soltas.map((b) => ancoraXml(b.im)).join('') + '</w:p>'
      : '';
    for (const b of blocos.filter((b) => !soltas.includes(b))) {
      let gap = Math.min(100, Math.max(0, b.top - cursor));
      if (b.tipo === 't') {
        if (gap > 3 || antTabela) xml += espacador(gap = Math.max(gap, 1));
        else gap = 0;
        xml += tabelaXml(b.t, L, R);
      } else if (b.tipo === 'i') xml += imagemXml(b.im, L, R, tw(gap), 1, maxH);
      else xml += paraXml(b.p, L, R, tw(gap));
      antTabela = b.tipo === 't';
      cursor += gap + altura(b);
    }
    if (ultima) return xml + (antTabela ? espacador(1) : '') + sectPr(W, H, m); // o Word espera um parágrafo depois da última tabela
    return xml + '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>' + sectPr(W, H, m) + '</w:pPr></w:p>';
  }

  function documentXml(paginas) {
    docPrId = 0;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' +
      paginas.map((pg, i) => paginaXml(pg, i === paginas.length - 1)).join('') +
      '</w:body></w:document>';
  }

  // imagens: [{rid, arquivo}] (arquivo dentro de word/media/)
  function relsXml(imagens) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      imagens.map((im) => `<Relationship Id="${im.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.arquivo}"/>`).join('') +
      '</Relationships>';
  }

  const STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>' +
    '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:widowControl w:val="0"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults></w:styles>';

  const CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  const ROOT_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const api = {
    esc, montarLinhas, paragrafos, tabelasDaPagina, tabelasSemBorda, regioesDeDesenho,
    documentXml, relsXml, STYLES, CONTENT_TYPES, ROOT_RELS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfWord = api;
})(typeof self !== 'undefined' ? self : this);
