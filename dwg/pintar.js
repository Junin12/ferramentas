// Desenho de uma "cena" (modelo ou folha com janelas) em canvas, usado pela tela e pelas exportações em imagem.
// Cena: { larg, alt, itens: [{ D, vis, s, tx, ty, clip }] } — cada item leva o desenho D (Cad.achatar) para o alvo:
// X = x·s + tx, Y = −y·s + ty (Y para baixo, como no canvas); clip = [X1, Y1, X2, Y2] no alvo ou null.
'use strict';

const hex = (c) => '#' + (c & 0xFFFFFF).toString(16).padStart(6, '0');
const lum = (c) => 0.3 * (c >> 16 & 255) + 0.59 * (c >> 8 & 255) + 0.11 * (c & 255);
// fundo escuro: cor muito escura (preto, azul-marinho) fica cinza-claro para aparecer
const legivel = (c) => (lum(c) < 40 ? 0xC8C8C8 : c);
// papel branco: branco/cinza-claro vira preto; amarelo e outras cores claras escurecem um pouco
const impressa = (c) => {
  const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
  if (Math.min(r, g, b) > 190) return 0;
  if (lum(c) > 170) return (Math.round(r * 0.7) << 16) | (Math.round(g * 0.7) << 8) | Math.round(b * 0.7);
  return c;
};
// hachura sobre papel branco: cor bem clara (equivale a 22% de opacidade)
const clarear = (c, a) => ((Math.round(255 - (255 - (c >> 16 & 255)) * a) << 16) | (Math.round(255 - (255 - (c >> 8 & 255)) * a) << 8) | Math.round(255 - (255 - (c & 255)) * a));

// cor de um grupo (tipo 0 linha, 2 preenchimento sólido, 4 hachura) no papel branco.
// Preenchimento branco é máscara de fundo (tabelas, textos): continua branco no papel.
function corPapel(tipo, cor, pb) {
  if (tipo === 2) return Math.min(cor >> 16 & 255, cor >> 8 & 255, cor & 255) > 190 ? 0xFFFFFF : pb ? 0x555555 : impressa(cor);
  if (tipo) return pb ? 0xD9D9D9 : clarear(impressa(cor), 0.22);
  return pb ? 0 : impressa(cor);
}

// agrupa as polilinhas de D por (camada, cor, tipo): um Path2D e a lista de índices por grupo
function montarGrupos(D) {
  if (D.grupos) return D.grupos;
  const mapa = new Map();
  const { pts: P, ini, cam, cor, tipo } = D;
  for (let i = 0; i < cam.length; i++) {
    const t = tipo[i] & 6, k = cam[i] * 8 + t + cor[i] * 4096;
    let g = mapa.get(k);
    if (!g) { g = { cam: cam[i], cor: cor[i], tipo: t, polis: [], path: typeof Path2D !== 'undefined' ? new Path2D() : null }; mapa.set(k, g); }
    g.polis.push(i);
    if (!g.path) continue;
    const a = ini[i], b = ini[i + 1];
    g.path.moveTo(P[2 * a], P[2 * a + 1]);
    for (let j = a + 1; j < b; j++) g.path.lineTo(P[2 * j], P[2 * j + 1]);
    if (tipo[i] & 1) g.path.closePath();
  }
  // preenchimentos primeiro (ficam por baixo das linhas)
  D.grupos = [...mapa.values()].sort((a, b) => (b.tipo ? 1 : 0) - (a.tipo ? 1 : 0) || b.tipo - a.tipo);
  return D.grupos;
}

// op: { k (px do alvo por unidade da cena), fundo, papel (cores para fundo branco), pb (preto e branco), lw (espessura em unidades da cena), minTexto }
function pintar(c, cena, op) {
  const k = op.k || 1;
  c.setTransform(k, 0, 0, k, 0, 0);
  c.fillStyle = op.fundo;
  c.fillRect(0, 0, cena.larg, cena.alt);
  const corL = op.pb ? () => '#000' : op.papel ? (x) => hex(impressa(x)) : (x) => hex(legivel(x));
  for (const it of cena.itens) {
    const D = it.D, vis = it.vis;
    c.save();
    if (it.clip) {
      c.setTransform(k, 0, 0, k, 0, 0);
      c.beginPath();
      c.rect(it.clip[0], it.clip[1], it.clip[2] - it.clip[0], it.clip[3] - it.clip[1]);
      c.clip();
    }
    c.setTransform(it.s * k, 0, 0, -it.s * k, it.tx * k, it.ty * k);
    c.lineWidth = (op.lw || 1) / it.s;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    for (const g of montarGrupos(D)) {
      if (vis && !vis[g.cam]) continue;
      if (g.tipo) {
        if (op.papel || op.pb) {
          c.fillStyle = hex(corPapel(g.tipo, g.cor, op.pb));
        } else {
          c.globalAlpha = g.tipo === 2 ? 0.85 : 0.22;
          c.fillStyle = hex(legivel(g.cor));
        }
        c.fill(g.path, 'evenodd');
        c.globalAlpha = 1;
      } else {
        c.strokeStyle = corL(g.cor);
        c.stroke(g.path);
      }
    }
    pintarTextos(c, it, cena, op, k, corL);
    c.restore();
  }
}

function pintarTextos(c, it, cena, op, k, corL) {
  c.setTransform(k, 0, 0, k, 0, 0);
  const base = ['alphabetic', 'bottom', 'middle', 'top'], alin = ['left', 'center', 'right'];
  const [cx1, cy1, cx2, cy2] = it.clip || [0, 0, cena.larg, cena.alt];
  let ultimaFonte = '';
  for (const t of it.D.textos) {
    if (it.vis && !it.vis[t.c]) continue;
    const px = t.h * it.s;
    if (px * k < (op.minTexto ?? 3.5) || px * k > 4000) continue;
    const X = t.x * it.s + it.tx, Y = -t.y * it.s + it.ty;
    const alcance = px * Math.max(4, t.t.length) * 0.7;
    if (X < cx1 - alcance || X > cx2 + alcance || Y < cy1 - alcance || Y > cy2 + alcance) continue;
    const fonte = Math.round(px / 0.72 * 1000) / 1000 + 'px Arial,sans-serif';
    if (fonte !== ultimaFonte) { c.font = fonte; ultimaFonte = fonte; }
    c.fillStyle = corL(t.cor);
    c.textAlign = alin[t.ah] || 'left';
    c.textBaseline = base[t.av] || 'alphabetic';
    const linhas = t.t.split('\n'), passo = px * 1.66;
    // MTEXT de várias linhas: o alinhamento vertical vale para o bloco todo
    const dy0 = linhas.length > 1 ? (t.av === 3 ? 0 : t.av === 2 ? -(linhas.length - 1) * passo / 2 : -(linhas.length - 1) * passo) : 0;
    c.save();
    c.translate(X, Y);
    if (t.rot) c.rotate(-t.rot);
    for (let i = 0; i < linhas.length; i++) c.fillText(linhas[i], 0, dy0 + i * passo);
    c.restore();
  }
}

// itens de uma folha: o papel (transformação s, tx, ty) e o modelo dentro de cada janela, recortado
function itensDaFolha(f, modelo, visModelo, s, tx, ty) {
  const po = f.d.origem, mo = modelo.origem;
  const itens = [{ D: f.d, vis: null, s, tx, ty, clip: null }];
  for (const j of f.janelas) {
    itens.push({
      D: modelo, vis: visModelo, s: s * j.k,
      tx: tx + s * ((j.cx - po[0]) + (mo[0] - j.vcx) * j.k),
      ty: ty - s * ((j.cy - po[1]) + (mo[1] - j.vcy) * j.k),
      clip: [tx + s * (j.cx - j.w / 2 - po[0]), ty - s * (j.cy + j.h / 2 - po[1]), tx + s * (j.cx + j.w / 2 - po[0]), ty - s * (j.cy - j.h / 2 - po[1])],
    });
  }
  // janelas por baixo do carimbo e da moldura
  return [...itens.slice(1), itens[0]];
}

// tamanho de papel da folha (mm): compara a moldura com A0–A4 em mm, cm, polegadas e metros
const PAPEIS = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210] };
function papelDaFolha(f) {
  const P = f.d.pts;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < P.length; i += 2) { const x = P[i], y = P[i + 1]; if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  for (const j of f.janelas) {
    x1 = Math.min(x1, j.cx - j.w / 2 - f.d.origem[0]); x2 = Math.max(x2, j.cx + j.w / 2 - f.d.origem[0]);
    y1 = Math.min(y1, j.cy - j.h / 2 - f.d.origem[1]); y2 = Math.max(y2, j.cy + j.h / 2 - f.d.origem[1]);
  }
  const caixas = [[x1, y1, x2, y2], f.d.caixa];
  let melhor = null;
  for (const cx of caixas) {
    const w = cx[2] - cx[0], h = cx[3] - cx[1];
    if (!(w > 0 && h > 0)) continue;
    for (const fat of [1, 10, 25.4, 1000]) for (const [nome, [pw, ph0]] of Object.entries(PAPEIS)) for (const deitado of [true, false]) {
      const Pw = deitado ? pw : ph0, Ph = deitado ? ph0 : pw;
      // moldura costuma ser um pouco menor que o papel (margens)
      const err = Math.max(Math.abs(w * fat - Pw) / Pw, Math.abs(h * fat - Ph) / Ph);
      if (!melhor || err < melhor.err) melhor = { err, nome, Pw, Ph, fat, caixa: cx };
    }
  }
  if (melhor && melhor.err < 0.1) {
    const [a, b, c, d] = melhor.caixa;
    return { nome: melhor.nome, larg: melhor.Pw, alt: melhor.Ph, fat: melhor.fat, cx: (a + c) / 2, cy: (b + d) / 2 };
  }
  // sem papel padrão: usa a caixa do desenho com a unidade que dá um tamanho plausível (100 mm a 2 m)
  const [a, b, c, d] = f.d.caixa, w = c - a, h = d - b, lado = Math.max(w, h);
  const fat = [1, 10, 25.4, 1000].find((x) => lado * x >= 100 && lado * x <= 2000) || 1;
  return { nome: 'personalizado', larg: w * fat, alt: h * fat, fat, cx: (a + c) / 2, cy: (b + d) / 2 };
}
