// Exportações da área: imagem com o mapa (PNG/JPG), PDF com mapa e tabela de pontos, KML, DXF em UTM e CSV.
'use strict';

const LIBS = { PDFLib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js' };
function carregarLib(nome) {
  if (window[nome]) return Promise.resolve();
  return new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = LIBS[nome];
    s.crossOrigin = 'anonymous';
    s.onload = ok;
    s.onerror = () => erro(new Error('Não consegui baixar uma biblioteca. Verifique a internet.'));
    document.head.append(s);
  });
}

const escXml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const nomeArq = () => (atual.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'area');
const agora = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const TIPOS = { v: 'vértice (média)', t: 'trilha', m: 'mapa' };

// tudo o que as exportações precisam: medidas, fuso UTM e coordenadas de cada ponto
function dados() {
  const pts = atual.pts, m = Geo.medir(pts);
  const la = pts.reduce((s, p) => s + p.la, 0) / pts.length, lo = pts.reduce((s, p) => s + p.lo, 0) / pts.length;
  const fuso = Geo.fusoDe(lo);
  const utm = pts.map((p) => Geo.geoUtm(p.la, p.lo, fuso));
  return { pts, m, fuso, sul: la < 0, centro: { la, lo }, utm };
}
const resumo = (d) => [
  `Área: ${Geo.fmtArea(d.m.area)} ± ${Geo.num(d.m.margem, 0)} m² (95%)`,
  `Perímetro: ${Geo.fmtDist(d.m.perimetro)} · ${d.pts.length} pontos`,
  `Área no plano UTM ${d.fuso}${d.sul ? 'S' : 'N'} (como o CAD mede): ${Geo.num(d.m.utm, 1)} m²`,
  `Centro: ${d.centro.la.toFixed(6)}, ${d.centro.lo.toFixed(6)} · SIRGAS 2000 · ${agora()}`,
];

// ---------- imagem do mapa ----------
// Web Mercator: pixel do mundo no zoom z (fracionário)
const mundo = (la, lo, z) => {
  const s = 256 * 2 ** z, f = la * Math.PI / 180;
  return [(lo + 180) / 360 * s, (1 - Math.log(Math.tan(f) + 1 / Math.cos(f)) / Math.PI) / 2 * s];
};
async function carregarTile(url) {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch (e) { return null; }
}

async function desenharMapa(W, H, prog) {
  const d = dados(), M = 70;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of d.pts) { const [x, y] = mundo(p.la, p.lo, 0); x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); }
  // zoom que faz a área caber; as imagens vêm do zoom inteiro (até o máximo existente) e são ampliadas
  const zf = Math.min(21, Math.log2(Math.min((W - 2 * M) / Math.max(x2 - x1, 1e-9), (H - 2 * M - 120) / Math.max(y2 - y1, 1e-9))));
  const zt = Math.max(0, Math.min(ZMAX_IMG, Math.floor(zf))), k = 2 ** (zf - zt);
  const cx = (x1 + x2) / 2 * 2 ** zf, cy = (y1 + y2) / 2 * 2 ** zf + 60; // centro acima da faixa de informação (120 px)
  const ox = cx - W / 2, oy = cy - H / 2;
  const P = (p) => { const [x, y] = mundo(p.la, p.lo, zf); return [x - ox, y - oy]; };

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#2b3036';
  g.fillRect(0, 0, W, H);

  // quadros de imagem
  const T = 256 * k, tx1 = Math.floor(ox / T), ty1 = Math.floor(oy / T), tx2 = Math.floor((ox + W) / T), ty2 = Math.floor((oy + H) / T);
  const lista = [];
  for (let x = tx1; x <= tx2; x++) for (let y = ty1; y <= ty2; y++) lista.push([x, y]);
  let feitos = 0, falhas = 0;
  const fundo = conf.camada === 'ruas' ? [TILES.ruas] : [TILES.sat, TILES.nomes];
  for (const t of fundo) {
    await Promise.all(lista.map(async ([x, y]) => {
      const n = 2 ** zt, xx = ((x % n) + n) % n;
      if (y < 0 || y >= n) return;
      const img = await carregarTile(t.replace('{z}', zt).replace('{y}', y).replace('{x}', xx));
      if (img) g.drawImage(img, Math.round(x * T - ox), Math.round(y * T - oy), Math.ceil(T), Math.ceil(T)); else falhas++;
      prog && prog(`Montando o mapa… ${Math.round(++feitos / (lista.length * fundo.length) * 100)}%`);
    }));
  }

  // polígono
  const xy = d.pts.map(P);
  g.lineJoin = 'round';
  g.beginPath();
  xy.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = 'rgba(255,214,10,0.22)';
  g.fill();
  g.strokeStyle = '#000a'; g.lineWidth = 7; g.stroke();
  g.strokeStyle = '#FFD60A'; g.lineWidth = 3.5; g.stroke();

  const rotulo = (txt, x, y, tam, fundoCor = '#000c', corTxt = '#fff') => {
    g.font = `600 ${tam}px Arial,sans-serif`;
    const w = g.measureText(txt).width + tam * 0.8, h = tam * 1.5;
    g.fillStyle = fundoCor; g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, 5); g.fill();
    g.fillStyle = corTxt; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x, y + 1);
  };
  // comprimento dos lados e números dos vértices (sem trilha, que tem pontos demais)
  const poucos = d.pts.length <= 40 && !d.pts.some((p) => p.t === 't');
  if (poucos) {
    xy.forEach((a, i) => { const b = xy[(i + 1) % xy.length]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 70) rotulo(Geo.fmtDist(Geo.distancia(d.pts[i], d.pts[(i + 1) % d.pts.length])), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 15); });
  }
  xy.forEach(([x, y], i) => {
    if (!poucos && d.pts[i].t === 't') return;
    g.fillStyle = '#FFD60A'; g.strokeStyle = '#111'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.font = '700 11px Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 1);
  });
  // área no meio
  const cxp = xy.reduce((s, p) => s + p[0], 0) / xy.length, cyp = xy.reduce((s, p) => s + p[1], 0) / xy.length;
  rotulo(Geo.fmtArea(d.m.area), cxp, cyp, 22, '#FFD60A', '#111');

  // norte e escala
  g.fillStyle = '#000b'; g.beginPath(); g.roundRect(W - 62, 14, 48, 64, 8); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(W - 38, 22); g.lineTo(W - 28, 52); g.lineTo(W - 38, 46); g.lineTo(W - 48, 52); g.closePath(); g.fill();
  g.font = '700 14px Arial,sans-serif'; g.textAlign = 'center'; g.fillText('N', W - 38, 66);
  const mpx = 40075016.686 * Math.cos(d.centro.la * Math.PI / 180) / (256 * 2 ** zf);
  const alvo = mpx * 180, base = 10 ** Math.floor(Math.log10(alvo)), passo = [1, 2, 5, 10].map((v) => v * base).filter((v) => v <= alvo).pop();
  const wpx = passo / mpx, ey = H - 140;
  g.fillStyle = '#000b'; g.beginPath(); g.roundRect(14, ey - 30, wpx + 28, 44, 6); g.fill();
  g.fillStyle = '#fff'; g.fillRect(28, ey, wpx, 6); g.fillStyle = '#111'; g.fillRect(28 + wpx / 2, ey + 1, wpx / 2 - 1, 4);
  g.fillStyle = '#fff'; g.font = '600 13px Arial,sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(Geo.fmtDist(passo), 28, ey - 8);

  // faixa de informação
  g.fillStyle = '#fff'; g.fillRect(0, H - 120, W, 120);
  g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = '700 22px Arial,sans-serif'; g.fillText(atual.nome, 20, H - 88);
  g.font = '15px Arial,sans-serif';
  resumo(d).forEach((l, i) => g.fillText(l, 20, H - 62 + i * 19));
  g.fillStyle = '#666'; g.font = '11px Arial,sans-serif'; g.textAlign = 'right';
  g.fillText((conf.camada === 'ruas' ? 'Mapa © Esri, HERE, Garmin, OpenStreetMap' : ATRIB_SAT) + ' · wiapps.com.br/ferramentas', W - 14, H - 8);
  if (falhas) F.toast('Parte das imagens do mapa não carregou (sem internet?). O desenho da área saiu completo.', true);
  return c;
}

const blobDe = (c, tipo, q) => new Promise((ok, erro) => c.toBlob((b) => (b ? ok(b) : erro(new Error('falha ao gerar a imagem'))), tipo, q));

// ---------- PDF: página A4 com o mapa, o resumo e a tabela de pontos ----------
async function gerarPdf(prog) {
  await carregarLib('PDFLib');
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const d = dados();
  const canvas = await desenharMapa(1600, 1240, prog);
  prog('Montando o PDF…');
  const doc = await PDFDocument.create();
  doc.setTitle(atual.nome);
  doc.setProducer('WiApps Ferramentas');
  const fn = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const ansi = (s) => String(s).replace(/[−–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  const img = await doc.embedJpg(await (await blobDe(canvas, 'image/jpeg', 0.9)).arrayBuffer());
  const A4 = [595.28, 841.89], Mg = 36;
  let pg = doc.addPage(A4), y = A4[1] - Mg;
  const txt = (s, x, tam = 9, f = fn, cor = rgb(0, 0, 0)) => pg.drawText(ansi(s), { x, y, size: tam, font: f, color: cor });
  txt(atual.nome, Mg, 15, fb); y -= 14;
  txt('Levantamento com GPS do celular · gerado em ' + agora(), Mg, 8.5, fn, rgb(0.35, 0.35, 0.35)); y -= 8;
  const iw = A4[0] - 2 * Mg, ih = iw * canvas.height / canvas.width;
  pg.drawImage(img, { x: Mg, y: y - ih, width: iw, height: ih });
  y -= ih + 16;
  txt('Pontos', Mg, 11, fb); y -= 14;
  // tabela de pontos
  const cols = [['Ponto', 0], ['Tipo', 34], ['Latitude', 112], ['Longitude', 182], [`E (UTM ${d.fuso}${d.sul ? 'S' : 'N'})`, 254], ['N (UTM)', 334], ['Precisão', 418], ['Até o próximo', 466]];
  const cab = () => { cols.forEach(([t, x]) => txt(t, Mg + x, 7.5, fb)); y -= 4; pg.drawLine({ start: { x: Mg, y }, end: { x: A4[0] - Mg, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) }); y -= 10; };
  cab();
  d.pts.forEach((p, i) => {
    if (y < Mg + 14) { pg = doc.addPage(A4); y = A4[1] - Mg; cab(); }
    const u = d.utm[i], q = d.pts[(i + 1) % d.pts.length];
    const linha = [`P${i + 1}`, TIPOS[p.t] || p.t, p.la.toFixed(7), p.lo.toFixed(7), Geo.num(u.E, 2), Geo.num(u.N, 2), '±' + Geo.num(p.s * 1.5, 1) + ' m', Geo.fmtDist(Geo.distancia(p, q))];
    cols.forEach(([, x], j) => txt(linha[j], Mg + x, 7.5));
    y -= 10.5;
  });
  const notas = [
    'Área calculada sobre o elipsoide GRS80 (SIRGAS 2000), projeção horizontal do terreno. A área no plano UTM difere pelo fator de escala da projeção.',
    'Margem de 95% estimada pela precisão de cada ponto informada pelo GPS. Precisão = raio com 68% de confiança. Não substitui levantamento topográfico.',
    (conf.camada === 'ruas' ? 'Mapa © Esri, HERE, Garmin, OpenStreetMap.' : ATRIB_SAT + '.') + ' Gerado em wiapps.com.br/ferramentas.',
  ];
  if (y < Mg + 50) { pg = doc.addPage(A4); y = A4[1] - Mg; }
  y -= 8;
  for (const n of notas) { txt(n, Mg, 6.8, fn, rgb(0.4, 0.4, 0.4)); y -= 9; }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

// ---------- KML (Google Earth) ----------
function gerarKml() {
  const d = dados();
  const anel = [...d.pts, d.pts[0]].map((p) => `${p.lo.toFixed(8)},${p.la.toFixed(8)},0`).join(' ');
  const desc = resumo(d).join('\n');
  const marcos = d.pts.map((p, i) => (p.t === 't' ? '' : `<Placemark><name>P${i + 1}</name><styleUrl>#vt</styleUrl><description>${escXml(`${TIPOS[p.t]} · precisão ±${Geo.num(p.s * 1.5, 1)} m`)}</description><Point><coordinates>${p.lo.toFixed(8)},${p.la.toFixed(8)},0</coordinates></Point></Placemark>`)).join('');
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escXml(atual.nome)}</name>`
    + '<Style id="area"><LineStyle><color>ff0ad6ff</color><width>3</width></LineStyle><PolyStyle><color>550ad6ff</color></PolyStyle></Style>'
    + '<Style id="vt"><IconStyle><scale>0.7</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/ylw-circle.png</href></Icon></IconStyle></Style>'
    + `<Placemark><name>${escXml(atual.nome)}</name><description>${escXml(desc)}</description><styleUrl>#area</styleUrl><Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${anel}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
    + (marcos ? `<Folder><name>Vértices</name>${marcos}</Folder>` : '') + '</Document></kml>';
  return new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
}

// ---------- CSV (Excel em português: ponto e vírgula, vírgula decimal) ----------
function gerarCsv() {
  const d = dados(), br = (x, c) => x.toFixed(c).replace('.', ',');
  const out = ['﻿' + `Área;${atual.nome.replace(/;/g, ',')}`, `Área (m²);${br(d.m.area, 2)}`, `Margem 95% (m²);${br(d.m.margem, 2)}`,
    `Perímetro (m);${br(d.m.perimetro, 2)}`, `Área no plano UTM (m²);${br(d.m.utm, 2)}`, `Referência;SIRGAS 2000 UTM ${d.fuso}${d.sul ? 'S' : 'N'}`, '',
    'Ponto;Tipo;Latitude;Longitude;E;N;Precisão (m);Até o próximo (m)'];
  d.pts.forEach((p, i) => out.push([`P${i + 1}`, TIPOS[p.t] || p.t, br(p.la, 8), br(p.lo, 8), br(d.utm[i].E, 3), br(d.utm[i].N, 3), br(p.s * 1.5, 1),
    br(Geo.distancia(p, d.pts[(i + 1) % d.pts.length]), 2)].join(';')));
  return new Blob([out.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}

// ---------- DXF R12 em coordenadas UTM (abre em qualquer CAD e na ferramenta de DWG) ----------
function gerarDxf() {
  const d = dados(), out = [];
  const L = (...p) => { for (let i = 0; i < p.length; i += 2) out.push(String(p[i]).padStart(3), String(p[i + 1])); };
  const n = (v) => String(Math.round(v * 1e4) / 1e4);
  const h = Math.max(0.3, Math.min(20, d.m.perimetro / 120));
  L(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$DWGCODEPAGE', 3, 'ANSI_1252', 0, 'ENDSEC');
  L(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0, 0, 'ENDTAB');
  L(0, 'TABLE', 2, 'LAYER', 70, 4);
  for (const [nome, cor] of [['0', 7], ['AREA', 2], ['VERTICES', 1], ['TEXTOS', 7]]) L(0, 'LAYER', 2, nome, 70, 0, 62, cor, 6, 'CONTINUOUS');
  L(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  L(0, 'POLYLINE', 8, 'AREA', 66, 1, 10, 0, 20, 0, 30, 0, 70, 1);
  d.utm.forEach((u) => L(0, 'VERTEX', 8, 'AREA', 10, n(u.E), 20, n(u.N), 30, 0));
  L(0, 'SEQEND', 8, 'AREA');
  d.utm.forEach((u, i) => {
    if (d.pts[i].t === 't' && d.pts.length > 40) return;
    L(0, 'POINT', 8, 'VERTICES', 10, n(u.E), 20, n(u.N), 30, 0);
    L(0, 'TEXT', 8, 'VERTICES', 10, n(u.E + h * 0.4), 20, n(u.N + h * 0.4), 30, 0, 40, n(h * 0.8), 1, `P${i + 1}`);
  });
  const cE = d.utm.reduce((s, u) => s + u.E, 0) / d.utm.length, cN = d.utm.reduce((s, u) => s + u.N, 0) / d.utm.length;
  const linhas = [atual.nome, `AREA = ${Geo.num(d.m.area, 2)} m2 (+/- ${Geo.num(d.m.margem, 0)} m2)`, `PERIMETRO = ${Geo.num(d.m.perimetro, 2)} m`, `SIRGAS 2000 UTM ${d.fuso}${d.sul ? 'S' : 'N'}`];
  linhas.forEach((t, i) => L(0, 'TEXT', 8, 'TEXTOS', 10, n(cE), 20, n(cN - i * h * 1.8), 30, 0, 40, n(i ? h : h * 1.3), 1, t.replace(/[\r\n]/g, ' '), 72, 1, 11, n(cE), 21, n(cN - i * h * 1.8), 31, 0));
  L(0, 'ENDSEC', 0, 'EOF');
  const txt = out.join('\r\n') + '\r\n', bytes = new Uint8Array(txt.length);
  for (let i = 0; i < txt.length; i++) { const ch = txt.charCodeAt(i); bytes[i] = ch < 256 ? ch : 63; }
  return new Blob([bytes], { type: 'application/dxf' });
}

const EXPORTAR = {
  pdf: [gerarPdf, 'pdf'],
  png: [async (prog) => blobDe(await desenharMapa(1600, 1240, prog), 'image/png'), 'png'],
  jpg: [async (prog) => blobDe(await desenharMapa(1600, 1240, prog), 'image/jpeg', 0.9), 'jpg'],
  kml: [gerarKml, 'kml'],
  csv: [gerarCsv, 'csv'],
  dxf: [gerarDxf, 'dxf'],
};
document.querySelectorAll('#exportar button').forEach((b) => b.addEventListener('click', () => F.trabalhando(b, async (prog) => {
  if (atual.pts.length < 3) throw new Error('Marque pelo menos 3 pontos.');
  const [fn, ext] = EXPORTAR[b.dataset.fmt];
  const blob = await fn(prog);
  F.baixar(blob, `${nomeArq()}.${ext}`);
  F.toast('Pronto: ' + `${nomeArq()}.${ext}`);
})));
