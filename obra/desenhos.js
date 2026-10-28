// Desenhos (SVG) dos materiais, peças e equipamentos da calculadora de obra: ajudam a escolher o tipo certo.
// Cada função devolve o texto de um <svg>. As cores de texto usam var(--ink), para funcionar no tema escuro;
// para o PDF, svgParaPng troca as variáveis por cores fixas.
'use strict';

const Des = (() => {
  const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  const f = (n) => Math.round(n * 10) / 10;
  const pts = (l) => l.map((p) => f(p[0]) + ',' + f(p[1])).join(' ');
  const svg = (w, h, corpo, rot = '') => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img"${rot ? ` aria-label="${rot}"` : ''}>${corpo}</svg>`;
  const txt = (x, y, t, o = {}) => `<text x="${f(x)}" y="${f(y)}" font-size="${o.tam || 10}" font-family="Arial,sans-serif" text-anchor="${o.al || 'middle'}" fill="${o.cor || 'var(--ink)'}"${o.neg ? ' font-weight="700"' : ''}${o.rot ? ` transform="rotate(${o.rot} ${f(x)} ${f(y)})"` : ''}>${t}</text>`;
  // números pseudoaleatórios fixos (o desenho sai sempre igual)
  const sorteio = (s) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

  // ---------- caixa em perspectiva isométrica ----------
  // c ao longo de x (comprimento), e ao longo de y (profundidade), h em z (altura). Ajusta a escala para caber em W×H.
  function iso(c, e, h, W, H, m = 16) {
    const brutos = [[0, 0, 0], [c, 0, 0], [c, e, 0], [0, e, 0], [0, 0, h], [c, 0, h], [c, e, h], [0, e, h]].map(([x, y, z]) => [(x - y) * C30, (x + y) * S30 - z]);
    const xs = brutos.map((p) => p[0]), ys = brutos.map((p) => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    const s = Math.min((W - 2 * m) / bw, (H - 2 * m) / bh);
    const ox = (W - bw * s) / 2 - Math.min(...xs) * s, oy = (H - bh * s) / 2 - Math.min(...ys) * s;
    return (x, y, z) => [ox + (x - y) * C30 * s, oy + ((x + y) * S30 - z) * s];
  }
  // faces visíveis: topo (z=h), frente (y=e) e lado (x=c)
  function caixa(P, c, e, h, cor = ['#C9673F', '#A9502C', '#8E4022'], z0 = 0) {
    const topo = [P(0, 0, h), P(c, 0, h), P(c, e, h), P(0, e, h)];
    const frente = [P(0, e, z0), P(c, e, z0), P(c, e, h), P(0, e, h)];
    const lado = [P(c, 0, z0), P(c, e, z0), P(c, e, h), P(c, 0, h)];
    const st = 'stroke="#222" stroke-width="1" stroke-linejoin="round"';
    return `<polygon points="${pts(frente)}" fill="${cor[1]}" ${st}/><polygon points="${pts(lado)}" fill="${cor[2]}" ${st}/><polygon points="${pts(topo)}" fill="${cor[0]}" ${st}/>`;
  }
  // cota ao longo de uma aresta, com o texto um pouco para fora
  function cota(a, b, t, dx = 0, dy = 0) {
    const mx = (a[0] + b[0]) / 2 + dx, my = (a[1] + b[1]) / 2 + dy;
    return `<line x1="${f(a[0] + dx * 0.4)}" y1="${f(a[1] + dy * 0.4)}" x2="${f(b[0] + dx * 0.4)}" y2="${f(b[1] + dy * 0.4)}" stroke="var(--ink)" stroke-width=".7" stroke-dasharray="2 2"/>` + txt(mx, my + 3.5, t, { tam: 10, neg: true });
  }
  // furos numa face (grade de linhas × colunas), na face lateral (x=c) ou no topo (z=h)
  function furos(P, c, e, h, face, lin, col, redondo) {
    let out = '';
    for (let i = 0; i < lin; i++) for (let j = 0; j < col; j++) {
      const u0 = (j + 0.18) / col, u1 = (j + 0.82) / col, v0 = (i + 0.2) / lin, v1 = (i + 0.8) / lin;
      let q;
      if (face === 'lado') q = [P(c, u0 * e, v0 * h), P(c, u1 * e, v0 * h), P(c, u1 * e, v1 * h), P(c, u0 * e, v1 * h)];
      else q = [P(u0 * c, v0 * e, h), P(u1 * c, v0 * e, h), P(u1 * c, v1 * e, h), P(u0 * c, v1 * e, h)];
      if (redondo) {
        const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
        const rx = Math.abs(q[1][0] - q[0][0]) / 2 + 1, ry = Math.abs(q[2][1] - q[0][1]) / 2 + 1;
        out += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(Math.max(rx, ry) * 0.75)}" ry="${f(Math.max(rx, ry) * 0.45)}" fill="#3a2a22" stroke="#222" stroke-width=".6"/>`;
      } else out += `<polygon points="${pts(q)}" fill="#3a2a22" stroke="#222" stroke-width=".6"/>`;
    }
    return out;
  }

  // ---------- tijolos e blocos ----------
  // dimensões em cm: e (largura/espessura) × h (altura) × c (comprimento)
  const CORES = {
    ceramica: ['#D9805A', '#B8603B', '#9A4C2C'], macico: ['#C2562F', '#A2421F', '#873416'],
    concreto: ['#B9BCBF', '#9A9DA1', '#808386'], ecologico: ['#D7A86E', '#BC8B50', '#A0733C'], celular: ['#F2F2EE', '#DADAD4', '#C4C4BC'],
  };
  function tijolo(t) {
    const W = 200, H = 130, P = iso(t.c, t.e, t.h, W, H, 22);
    let s = caixa(P, t.c, t.e, t.h, CORES[t.mat]);
    if (t.furos) s += furos(P, t.c, t.e, t.h, t.furos[0], t.furos[1], t.furos[2], t.furos[3]);
    if (t.mat === 'macico') s += `<polygon points="${pts([P(t.c * 0.3, t.e * 0.3, t.h), P(t.c * 0.7, t.e * 0.3, t.h), P(t.c * 0.7, t.e * 0.7, t.h), P(t.c * 0.3, t.e * 0.7, t.h)])}" fill="#8E3A1A" opacity=".55"/>`;
    s += cota(P(0, t.e, 0), P(t.c, t.e, 0), String(t.c).replace('.', ','), -6, 9);
    s += cota(P(t.c, 0, 0), P(t.c, t.e, 0), String(t.e).replace('.', ','), 8, 8);
    s += cota(P(0, t.e, 0), P(0, t.e, t.h), String(t.h).replace('.', ','), -12, 0);
    return svg(W, H, s, t.nome);
  }

  // ---------- caminhões (vista lateral) ----------
  function roda(x, y, r = 9) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="#222"/><circle cx="${x}" cy="${y}" r="${r * 0.45}" fill="#9aa0a6"/>`; }
  function cabine(x, chao, cor = '#1F5C99') {
    return `<path d="M${x} ${chao - 12} v-34 h22 l12 16 v18 z" fill="${cor}" stroke="#222"/><path d="M${x + 22} ${chao - 44} l9 12 h-9 z" fill="#cfe3f5" stroke="#222" stroke-width=".7"/><rect x="${x + 2}" y="${chao - 42}" width="15" height="11" fill="#cfe3f5" stroke="#222" stroke-width=".7"/>`;
  }
  function cacamba(x, chao, comp, alt, cor = '#F2A516') {
    const y = chao - 14;
    return `<path d="M${x} ${y} v-${alt} h${comp} l-4 ${alt} z" fill="${cor}" stroke="#222"/>` +
      Array.from({ length: Math.floor(comp / 16) }, (_, i) => `<line x1="${x + 8 + i * 16}" y1="${y - alt + 3}" x2="${x + 8 + i * 16}" y2="${y - 2}" stroke="#c98200" stroke-width="1.4"/>`).join('');
  }
  function caminhao(tipo) {
    const W = 230, H = 100, chao = 84;
    let s = `<line x1="4" y1="${chao + 9}" x2="${W - 4}" y2="${chao + 9}" stroke="var(--ink)" stroke-width=".8" opacity=".5"/>`;
    const chassi = (x1, x2) => `<rect x="${x1}" y="${chao - 16}" width="${x2 - x1}" height="5" fill="#333"/>`;
    if (tipo === 'carreta') {
      s += chassi(18, 214) + cacamba(18, chao + 2, 150, 34) + cabine(176, chao) + `<rect x="168" y="${chao - 22}" width="8" height="8" fill="#333"/>`;
      s += [30, 50, 70].map((x) => roda(x, chao)).join('') + roda(186, chao) + roda(206, chao);
    } else {
      const d = { tresq: [70, 22, 1, 1], toco: [92, 26, 1, 1], truck: [118, 32, 2, 1], bitruck: [134, 36, 2, 2] }[tipo];
      const [comp, alt, eixosTras, eixosFrente] = d, x0 = 24, xc = x0 + comp + 6;
      s += chassi(x0, xc + 34) + cacamba(x0, chao, comp, alt) + cabine(xc, chao);
      const tras = eixosTras === 2 ? [x0 + comp * 0.62, x0 + comp * 0.62 + 21] : [x0 + comp * 0.7];
      const frente = eixosFrente === 2 ? [xc - 2, xc + 20] : [xc + 18];
      s += [...tras, ...frente].map((x) => roda(x, chao, tipo === 'tresq' ? 8 : 9)).join('');
    }
    return svg(W, H, s);
  }
  // seção da caçamba (vista de trás): reta, laterais inclinadas ou fundo arredondado
  function secao(forma) {
    const W = 160, H = 110, cor = '#F2A516', mat = '#D8B57A';
    let s = '';
    if (forma === 'reta') {
      s = `<path d="M30 20 V88 H130 V20" fill="none" stroke="#222" stroke-width="5" stroke-linejoin="round"/><rect x="33" y="44" width="94" height="41" fill="${mat}"/>`
        + txt(80, 14, 'L') + txt(144, 58, 'H') + `<line x1="138" y1="20" x2="138" y2="88" stroke="var(--ink)" stroke-dasharray="2 2"/>`;
    } else if (forma === 'trapezio') {
      s = `<path d="M22 20 L44 88 H116 L138 20" fill="none" stroke="#222" stroke-width="5" stroke-linejoin="round"/><path d="M33 52 L45 85 H115 L127 52 Z" fill="${mat}"/>`
        + txt(80, 14, 'L (em cima)') + txt(80, 102, 'Lb (fundo)') + txt(148, 58, 'H');
    } else {
      s = `<path d="M28 18 V50 A52 40 0 0 0 132 50 V18" fill="none" stroke="#222" stroke-width="5"/><path d="M31 56 A49 37 0 0 0 129 56 Z" fill="${mat}"/>`
        + txt(80, 12, 'L') + txt(146, 52, 'H') + txt(80, 104, 'fundo arredondado');
    }
    return svg(W, H, `<g stroke-linecap="round">${s}</g>`.replace(/#F2A516/g, cor));
  }
  // onde medir: caçamba vista de cima com os pontos numerados
  function pontos(n, destaque = -1) {
    const W = 220, H = 120, x0 = 20, y0 = 14, w = 180, h = 92;
    let s = `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="4" fill="#D8B57A" stroke="#222" stroke-width="3"/>` + txt(x0 + w + 6, y0 + h / 2, 'cabine', { tam: 8, rot: 90 });
    const lista = pontosPos(n);
    lista.forEach(([u, v], i) => {
      const x = x0 + u * w, y = y0 + v * h, d = i === destaque;
      s += `<circle cx="${f(x)}" cy="${f(y)}" r="${d ? 11 : 9}" fill="${d ? '#1a73e8' : '#fff'}" stroke="#222" stroke-width="1.5"/>` + txt(x, y + 3.5, i + 1, { tam: 10, neg: true, cor: d ? '#fff' : '#111' });
    });
    return svg(W, H, s);
  }
  // posições relativas (0–1) dos pontos de medida: 4 cantos (a ~15% das paredes) e centro; 9 = grade 3×3
  function pontosPos(n) {
    if (n === 9) return [[0.15, 0.2], [0.5, 0.2], [0.85, 0.2], [0.15, 0.5], [0.5, 0.5], [0.85, 0.5], [0.15, 0.8], [0.5, 0.8], [0.85, 0.8]];
    return [[0.15, 0.2], [0.85, 0.2], [0.85, 0.8], [0.15, 0.8], [0.5, 0.5]];
  }
  // como medir: régua do fundo até o material ou da borda até o material (vazio)
  function comoMedir(modo) {
    const W = 200, H = 110;
    let s = `<path d="M30 16 V92 H170 V16" fill="none" stroke="#222" stroke-width="4"/><path d="M33 50 Q70 38 100 44 T167 52 V89 H33 Z" fill="#D8B57A"/>`;
    if (modo === 'vazio') s += `<line x1="100" y1="16" x2="100" y2="44" stroke="#1a73e8" stroke-width="3"/>` + txt(108, 34, 'vazio', { al: 'start', tam: 11, neg: true }) + `<line x1="20" y1="16" x2="180" y2="16" stroke="var(--ink)" stroke-dasharray="3 3"/>` + txt(176, 11, 'borda', { al: 'end', tam: 9 });
    else s += `<line x1="100" y1="44" x2="100" y2="89" stroke="#1a73e8" stroke-width="3"/>` + txt(108, 72, 'altura', { al: 'start', tam: 11, neg: true });
    return svg(W, H, s);
  }

  // ---------- materiais a granel ----------
  function monte(tipo) {
    const W = 160, H = 100, r = sorteio({ areia: 3, brita0: 5, brita1: 7, brita2: 11, brita3: 13, rachao: 17, pedrisco: 19, po: 23, solo: 29, bica: 31 }[tipo] || 37);
    const cor = { areia: '#E3C48C', po: '#C9C9C4', solo: '#8B5A36', bica: '#A8A39A' }[tipo] || '#9DA1A6';
    let s = `<path d="M10 88 Q40 30 80 22 Q120 30 150 88 Z" fill="${cor}" stroke="#555" stroke-width="1"/>`;
    const dentro = (x, y) => y < 88 && y > 22 + Math.abs(x - 80) * 0.95 - 4;
    const pedra = (tam, n, tons) => {
      for (let i = 0; i < n; i++) {
        const x = 14 + r() * 132, y = 26 + r() * 60;
        if (!dentro(x, y)) continue;
        const k = 5 + Math.floor(r() * 3), p = [];
        for (let j = 0; j < k; j++) { const a = j / k * 6.283 + r() * 0.6, rr = tam * (0.6 + r() * 0.5); p.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8]); }
        s += `<polygon points="${pts(p)}" fill="${tons[Math.floor(r() * tons.length)]}" stroke="#444" stroke-width=".6"/>`;
      }
    };
    const pontinhos = (n, tons, rad) => { for (let i = 0; i < n; i++) { const x = 14 + r() * 132, y = 26 + r() * 60; if (dentro(x, y)) s += `<circle cx="${f(x)}" cy="${f(y)}" r="${rad}" fill="${tons[i % tons.length]}"/>`; } };
    if (tipo === 'areia') pontinhos(260, ['#C9A66A', '#F2DDB0', '#B8935A'], 0.9);
    else if (tipo === 'po') pontinhos(300, ['#AFAFAA', '#E0E0DC'], 0.7);
    else if (tipo === 'solo') { pontinhos(160, ['#6F4528', '#A06C45'], 1.3); pedra(2.5, 12, ['#7a5236']); }
    else if (tipo === 'pedrisco') pedra(2, 260, ['#8E9297', '#B4B8BC', '#6F7378']);
    else if (tipo === 'brita0') pedra(2.6, 200, ['#8E9297', '#B4B8BC', '#6F7378']);
    else if (tipo === 'brita1') pedra(3.6, 130, ['#8E9297', '#B4B8BC', '#6F7378']);
    else if (tipo === 'brita2') pedra(5, 80, ['#8E9297', '#B4B8BC', '#6F7378']);
    else if (tipo === 'brita3') pedra(6.5, 55, ['#8E9297', '#B4B8BC', '#6F7378']);
    else if (tipo === 'rachao') pedra(13, 26, ['#8E9297', '#A9ADB1', '#6F7378', '#9a9080']);
    else if (tipo === 'bica') { pontinhos(140, ['#8E9297', '#C9C9C4'], 0.9); pedra(3, 80, ['#8E9297', '#B4B8BC']); }
    return svg(W, H, s);
  }

  // ---------- peças de concreto ----------
  const CONC = ['#C7CACD', '#A9ADB1', '#8D9195'];
  function cilindro(cx, topo, rx, alt, cor = CONC) {
    const ry = rx * 0.38;
    return `<path d="M${f(cx - rx)} ${f(topo)} V${f(topo + alt)} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(topo + alt)} V${f(topo)}" fill="${cor[1]}" stroke="#222"/><ellipse cx="${f(cx)}" cy="${f(topo)}" rx="${f(rx)}" ry="${f(ry)}" fill="${cor[0]}" stroke="#222"/>`;
  }
  function peca(tipo) {
    const W = 180, H = 120;
    if (tipo === 'estaca') return svg(W, H, `<line x1="10" y1="34" x2="170" y2="34" stroke="#8B5A36" stroke-width="2"/>` + cilindro(90, 22, 16, 88) + txt(122, 70, 'D', { neg: true }) + txt(64, 70, 'L', { neg: true }));
    if (tipo === 'tubulao') return svg(W, H, `<line x1="10" y1="24" x2="170" y2="24" stroke="#8B5A36" stroke-width="2"/>` + cilindro(90, 14, 14, 62)
      + `<path d="M76 76 L52 100 V108 A38 9 0 0 0 128 108 V100 L104 76 Z" fill="${CONC[1]}" stroke="#222"/>` + txt(120, 50, 'D fuste', { al: 'start', neg: true }) + txt(136, 104, 'D base', { al: 'start', neg: true }));
    if (tipo === 'anel') return svg(W, H, cilindro(90, 36, 62, 62) + `<ellipse cx="90" cy="36" rx="48" ry="18" fill="#7f8a94" stroke="#222"/>` + txt(90, 12, 'D externo · D interno', { neg: true }));
    const dims = { sapata: [60, 50, 14], bloco: [40, 40, 30], pilar: [20, 20, 110], viga: [120, 16, 30], laje: [110, 80, 7], parede: [120, 12, 60] }[tipo];
    const P = iso(dims[0], dims[1], dims[2] + (tipo === 'sapata' ? 18 : 0), W, H, 18);
    let s = caixa(P, ...dims, CONC);
    if (tipo === 'sapata') { // pilar de arranque em cima do tronco de pirâmide
      const [c, e, h] = dims, a = c * 0.3, b = e * 0.3;
      s += `<polygon points="${pts([P(0, e, h), P(c, e, h), P(c / 2 + a / 2, e / 2 + b / 2, h + 12), P(c / 2 - a / 2, e / 2 + b / 2, h + 12)])}" fill="${CONC[1]}" stroke="#222"/>`
        + `<polygon points="${pts([P(c, 0, h), P(c, e, h), P(c / 2 + a / 2, e / 2 + b / 2, h + 12), P(c / 2 + a / 2, e / 2 - b / 2, h + 12)])}" fill="${CONC[2]}" stroke="#222"/>`
        + `<polygon points="${pts([P(c / 2 - a / 2, e / 2 - b / 2, h + 12), P(c / 2 + a / 2, e / 2 - b / 2, h + 12), P(c / 2 + a / 2, e / 2 + b / 2, h + 12), P(c / 2 - a / 2, e / 2 + b / 2, h + 12)])}" fill="${CONC[0]}" stroke="#222"/>`;
    }
    return svg(W, H, s);
  }

  // ---------- aço, vala, revestimento, pintura, impermeabilização, reservatório, fôrma, argamassa, solo ----------
  function vergalhao(bitola) {
    const W = 180, H = 60, esp = Math.max(3, Math.min(16, bitola * 0.55)), y = 30;
    let s = `<rect x="14" y="${f(y - esp / 2)}" width="152" height="${f(esp)}" rx="${f(esp / 2)}" fill="#8A6F5A" stroke="#3b2c22"/>`;
    for (let x = 20; x < 162; x += Math.max(5, esp * 0.9)) s += `<line x1="${x}" y1="${f(y - esp / 2)}" x2="${f(x + esp * 0.5)}" y2="${f(y + esp / 2)}" stroke="#5d4636" stroke-width="1"/>`;
    return svg(W, H, s + txt(90, 54, `Ø ${String(bitola).replace('.', ',')} mm`, { neg: true, tam: 11 }));
  }
  function vala() {
    const W = 200, H = 120;
    return svg(W, H, `<path d="M6 22 H40 L62 104 H138 L160 22 H194" fill="none" stroke="#8B5A36" stroke-width="3"/>`
      + `<path d="M42 28 H158 L138 104 H62 Z" fill="#B98A5E" opacity=".55"/><path d="M58 90 H142 L138 104 H62 Z" fill="#E3C48C"/><path d="M54 76 H146 L142 90 H58 Z" fill="#EBD3A3"/>`
      + `<circle cx="100" cy="84" r="13" fill="#4B87C5" stroke="#222"/><circle cx="100" cy="84" r="9" fill="#cfe3f5"/>`
      + txt(100, 16, 'largura em cima') + txt(100, 116, 'largura do fundo') + txt(178, 66, 'prof.') + txt(30, 66, 'talude'));
  }
  function revestimento(c = 60, l = 60) {
    const W = 160, H = 110, k = 90 / Math.max(c, l), w = c * k / 2.2, h = l * k / 2.2;
    let s = '';
    for (let i = 0; i * (h + 2) < 96; i++) for (let j = 0; j * (w + 2) < 140; j++) s += `<rect x="${f(10 + j * (w + 2))}" y="${f(8 + i * (h + 2))}" width="${f(w)}" height="${f(h)}" fill="${(i + j) % 2 ? '#E8E4DA' : '#D9D3C4'}" stroke="#999" stroke-width=".5"/>`;
    return svg(W, H, `<rect x="8" y="6" width="144" height="100" fill="#888"/>${s}`);
  }
  function pintura() {
    return svg(160, 110, `<path d="M30 30 H90 V96 A30 8 0 0 1 30 96 Z" fill="#cfd6de" stroke="#222"/><ellipse cx="60" cy="30" rx="30" ry="8" fill="#5B8DEF" stroke="#222"/>`
      + `<rect x="36" y="52" width="48" height="26" fill="#fff" stroke="#999"/>` + txt(60, 69, 'TINTA', { tam: 9, neg: true, cor: '#333' })
      + `<rect x="104" y="20" width="40" height="18" rx="9" fill="#5B8DEF" stroke="#222"/><path d="M124 38 V56 H112 V100" fill="none" stroke="#555" stroke-width="3"/>`);
  }
  function impermeabilizacao(tipo) {
    const cores = { polimerica: '#9BA3AB', manta: '#2E2E2E', emulsao: '#3a3a3a', acrilica: '#E6E1D3', cristalizante: '#8F959B' };
    const P = iso(120, 70, 18, 180, 120, 14);
    let s = caixa(P, 120, 70, 12, CONC) + `<polygon points="${pts([P(0, 0, 12), P(120, 0, 12), P(120, 70, 12), P(0, 70, 12)])}" fill="${cores[tipo] || '#555'}" stroke="#222"/>`;
    if (tipo === 'manta') s += [0, 1, 2].map((i) => `<line x1="${f(P(i * 40 + 38, 0, 12)[0])}" y1="${f(P(i * 40 + 38, 0, 12)[1])}" x2="${f(P(i * 40 + 38, 70, 12)[0])}" y2="${f(P(i * 40 + 38, 70, 12)[1])}" stroke="#777" stroke-width="2"/>`).join('');
    return svg(180, 120, s);
  }
  function reservatorio(tipo) {
    const W = 180, H = 120, agua = '#6FA8DC';
    if (tipo === 'vertical') return svg(W, H, cilindro(90, 18, 50, 84, ['#c9d3dc', '#aab6c2', '#8e9aa6']) + `<path d="M40 50 V102 A50 19 0 0 0 140 102 V50 A50 19 0 0 1 40 50 Z" fill="${agua}" opacity=".75"/>` + txt(90, 12, 'D') + txt(152, 64, 'H', { al: 'start' }));
    if (tipo === 'horizontal') return svg(W, H, `<rect x="30" y="24" width="120" height="70" rx="35" fill="#c9d3dc" stroke="#222"/><path d="M38 66 H142 A35 35 0 0 1 115 94 H65 A35 35 0 0 1 38 66 Z" fill="${agua}"/>` + txt(90, 16, 'C') + txt(160, 62, 'D', { al: 'start' }) + txt(90, 84, 'nível', { tam: 9, cor: '#fff' }));
    const P = iso(110, 70, 60, W, H, 14);
    return svg(W, H, caixa(P, 110, 70, 60, ['#c9d3dc', '#aab6c2', '#8e9aa6']) + `<polygon points="${pts([P(0, 70, 0), P(110, 70, 0), P(110, 70, 38), P(0, 70, 38)])}" fill="${agua}" opacity=".75"/><polygon points="${pts([P(110, 0, 0), P(110, 70, 0), P(110, 70, 38), P(110, 0, 38)])}" fill="#5a93c8" opacity=".75"/>`);
  }
  function forma(tipo) {
    const W = 180, H = 120, mad = ['#D9B27C', '#C49A60', '#A9824C'];
    if (tipo === 'pilar') { const P = iso(24, 24, 100, W, H, 14); return svg(W, H, caixa(P, 24, 24, 100, mad) + [25, 50, 75].map((z) => `<line x1="${f(P(0, 24, z)[0])}" y1="${f(P(0, 24, z)[1])}" x2="${f(P(24, 24, z)[0])}" y2="${f(P(24, 24, z)[1])}" stroke="#7a5a30" stroke-width="2"/>`).join('')); }
    if (tipo === 'viga') { const P = iso(130, 20, 34, W, H, 14); return svg(W, H, caixa(P, 130, 20, 34, mad) + `<polygon points="${pts([P(0, 3, 34), P(130, 3, 34), P(130, 17, 34), P(0, 17, 34)])}" fill="#555" opacity=".5"/>`); }
    if (tipo === 'laje') { const P = iso(120, 90, 30, W, H, 14); return svg(W, H, caixa(P, 120, 90, 4, mad, 0) + [20, 60, 100].map((x) => `<line x1="${f(P(x, 90, 0)[0])}" y1="${f(P(x, 90, 0)[1] + 26)}" x2="${f(P(x, 90, 0)[0])}" y2="${f(P(x, 90, 0)[1])}" stroke="#8a6a3a" stroke-width="3"/>`).join('')); }
    const P = iso(70, 60, 20, W, H, 16);
    return svg(W, H, caixa(P, 70, 60, 20, mad) + `<polygon points="${pts([P(3, 3, 20), P(67, 3, 20), P(67, 57, 20), P(3, 57, 20)])}" fill="#555" opacity=".5"/>`);
  }
  function argamassa(tipo) {
    const W = 180, H = 110;
    const parede = '<rect x="20" y="10" width="70" height="92" fill="#C9673F"/>' + Array.from({ length: 6 }, (_, i) => `<line x1="20" y1="${10 + i * 15.5}" x2="90" y2="${10 + i * 15.5}" stroke="#ddd" stroke-width="2"/>`).join('');
    if (tipo === 'chapisco') { const r = sorteio(9); let p = ''; for (let i = 0; i < 160; i++) p += `<circle cx="${f(92 + r() * 6)}" cy="${f(10 + r() * 92)}" r="1.4" fill="#777"/>`; return svg(W, H, parede + p + txt(130, 58, 'chapisco', { neg: true })); }
    if (tipo === 'reboco') return svg(W, H, parede + `<rect x="90" y="10" width="12" height="92" fill="#D7D2C6" stroke="#999"/>` + txt(140, 58, 'emboço / reboco', { neg: true }));
    if (tipo === 'contrapiso') return svg(W, H, `<rect x="10" y="64" width="160" height="30" fill="${CONC[1]}" stroke="#222"/><rect x="10" y="48" width="160" height="16" fill="#CFC8B8" stroke="#222"/>` + txt(90, 40, 'contrapiso', { neg: true }) + txt(90, 84, 'laje', { cor: '#333' }));
    return svg(W, H, Array.from({ length: 5 }, (_, i) => Array.from({ length: 3 }, (_, j) => `<rect x="${10 + j * 54 + (i % 2) * 27}" y="${10 + i * 19}" width="50" height="16" fill="#C9673F" stroke="#7a3a1f"/>`).join('')).join('') + txt(90, 108, 'juntas de assentamento', { tam: 9 }));
  }
  function solo(estado) {
    // mesma escala para os três: o cubo cresce solto e encolhe compactado
    const W = 180, H = 110, lado = { corte: 46, solto: 56, compactado: 40 }[estado], P0 = iso(60, 60, 60, 120, 110, 6);
    const P = (x, y, z) => { const p = P0(x, y, z); return [p[0], p[1] + (60 - lado) * 0.9]; };
    const rot = { corte: '1,00 m³ no corte', solto: '≈ 1,25 m³ solto', compactado: '≈ 0,90 m³ compactado' }[estado];
    return svg(W, H, `<g transform="translate(30 -6)">${caixa(P, lado, lado, lado, ['#A07048', '#8B5A36', '#734628'])}</g>` + txt(90, 106, rot, { tam: 10, neg: true }));
  }
  function conversao(tipo) {
    const W = 160, H = 100;
    if (tipo === 'massa') return svg(W, H, `<path d="M30 80 H130 L118 36 H42 Z" fill="#9aa0a6" stroke="#222"/>` + txt(80, 64, 't ↔ m³', { tam: 16, neg: true, cor: '#fff' }));
    if (tipo === 'declividade') return svg(W, H, `<path d="M14 84 L146 40 V84 Z" fill="#cfe3f5" stroke="#222"/>` + txt(80, 96, 'horizontal') + txt(152, 66, 'V', { al: 'start' }) + txt(66, 54, '%', { tam: 14, neg: true }));
    // manômetro
    if (tipo === 'pressao') return svg(W, H, `<circle cx="80" cy="48" r="36" fill="#fff" stroke="#222" stroke-width="3"/><path d="M56 66 A30 30 0 1 1 104 66" fill="none" stroke="#bbb" stroke-width="4"/>`
      + `<path d="M80 48 L100 28" stroke="#c62828" stroke-width="3"/><circle cx="80" cy="48" r="4" fill="#222"/><rect x="74" y="84" width="12" height="14" fill="#9aa0a6" stroke="#222"/>` + txt(80, 72, 'mca · bar', { tam: 10 }));
    // tubo com o diâmetro em polegadas
    if (tipo === 'polegada') return svg(W, H, `<ellipse cx="40" cy="50" rx="18" ry="30" fill="#cfe3f5" stroke="#222"/><path d="M40 20 H130 M40 80 H130" stroke="#222"/><ellipse cx="130" cy="50" rx="18" ry="30" fill="#e8eef4" stroke="#222"/>`
      + `<path d="M40 24 V76" stroke="#c62828" stroke-dasharray="3 2"/>` + txt(88, 54, 'pol ↔ mm', { tam: 12, neg: true }));
    if (tipo === 'volume') return svg(W, H, `<path d="M50 20 H110 L104 88 H56 Z" fill="#cfe3f5" stroke="#222"/><path d="M53 50 H107" stroke="#4B87C5" stroke-width="2"/>` + txt(80, 72, 'L ↔ m³', { tam: 12, neg: true }));
    return svg(W, H, `<path d="M10 60 H110" stroke="#4B87C5" stroke-width="18"/><path d="M110 40 L150 60 L110 80 Z" fill="#4B87C5"/>` + txt(60, 64, 'L/s ↔ m³/h', { tam: 11, neg: true, cor: '#fff' }));
  }

  // capa de cada calculadora na tela inicial
  const capas = {
    cubicagem: () => caminhao('truck'), tijolos: () => tijolo({ c: 19, e: 9, h: 14, mat: 'ceramica', furos: ['lado', 2, 3] }),
    concreto: () => peca('sapata'), aco: () => vergalhao(12.5), vala: () => vala(), terra: () => solo('solto'), conversao: () => conversao('massa'),
    argamassa: () => argamassa('reboco'), revestimento: () => revestimento(60, 60), pintura: () => pintura(), impermeabilizacao: () => impermeabilizacao('manta'),
    reservatorio: () => reservatorio('vertical'), formas: () => forma('pilar'), conversoes: () => conversao('vazao'),
  };

  // SVG → PNG (para o PDF): as variáveis de cor viram cores fixas
  function svgParaPng(texto, larg = 600) {
    return new Promise((ok, erro) => {
      const fixo = texto.replace(/var\(--ink\)/g, '#222').replace('<svg ', `<svg width="${larg}" `);
      const img = new Image();
      img.onload = () => {
        const k = larg / img.width, c = document.createElement('canvas');
        c.width = larg; c.height = Math.round(img.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? ok(b) : erro(new Error('desenho'))), 'image/png');
      };
      img.onerror = () => erro(new Error('desenho'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fixo);
    });
  }

  return { tijolo, caminhao, secao, pontos, pontosPos, comoMedir, monte, peca, vergalhao, vala, revestimento, pintura, impermeabilizacao, reservatorio, forma, argamassa, solo, conversao, capas, svgParaPng };
})();
