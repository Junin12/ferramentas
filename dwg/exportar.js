// Exportações do visualizador: PDF, imagem, SVG, DXF, quantitativos (Excel), relatório (Word) e coordenadas (KML/CSV).
// Usa o desenho já aberto (app.js) e o desenho de cena (pintar.js). Bibliotecas do cdnjs só carregam quando usadas.
'use strict';

const LIBS = {
  PDFLib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  JSZip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};
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

const FORMATOS = {
  pdf: { nome: 'PDF', desc: 'Vetorial, para imprimir ou mandar. Na folha de impressão, sai no tamanho do papel.' },
  png: { nome: 'Imagem PNG', desc: 'Imagem nítida, boa para RDO e mensagens.' },
  jpg: { nome: 'Imagem JPG', desc: 'Imagem mais leve.' },
  svg: { nome: 'SVG', desc: 'Vetorial para sites e apresentações.' },
  dxf: { nome: 'DXF', desc: 'Para abrir em programas gratuitos (LibreCAD, QCAD) ou AutoCAD antigo. Vai o espaço do modelo: linhas, arcos, círculos, textos e blocos. Hachuras, tipos de linha e folhas de impressão não vão.' },
  xlsx: { nome: 'Excel (quantitativos)', desc: 'Contagem de blocos, atributos, comprimentos e áreas por camada e lista de textos.' },
  docx: { nome: 'Word (relatório)', desc: 'Imagem do desenho e tabelas de quantitativos, pronto para editar.' },
  kml: { nome: 'Google Earth (KML)', desc: 'Linhas e pontos do desenho georreferenciado (UTM) em latitude e longitude.' },
  csv: { nome: 'Coordenadas (CSV)', desc: 'Vértices das linhas com E, N, latitude e longitude, para Excel.' },
};
const TITULOS = { pdf: 'DWG para PDF', png: 'DWG para imagem', jpg: 'DWG para imagem', svg: 'DWG para SVG', dxf: 'DWG para DXF',
  xlsx: 'Quantitativos do DWG', docx: 'Relatório do DWG em Word', kml: 'DWG para Google Earth', csv: 'Coordenadas do DWG' };

// ---------- painel ----------
const $e = (s) => F.$('#exportar ' + s);
let formato = 'pdf';

function abrirExportar(f) {
  if (f === 'imagem') f = 'png';
  if (f === 'coordenadas') f = 'kml';
  if (FORMATOS[f]) formato = f;
  $e('[name=fmt][value="' + formato + '"]').checked = true;
  // fuso UTM sugerido: o último usado (padrão 23, região de Uberaba)
  try { const z = localStorage.getItem('dwg-fuso'); if (z) $e('#ex-fuso').value = z; } catch (e) { /* padrão */ }
  atualizarOpcoes();
  painelCamadas(false);
  F.$('#exportar').classList.remove('hide');
  F.$('#b-exportar').setAttribute('aria-pressed', 'true');
}
function fecharExportar() {
  F.$('#exportar').classList.add('hide');
  F.$('#b-exportar').setAttribute('aria-pressed', 'false');
}
F.$('#b-exportar').addEventListener('click', () => (F.$('#exportar').classList.contains('hide') ? abrirExportar(formato) : fecharExportar()));
$e('#ex-fechar').addEventListener('click', fecharExportar);
F.$('#exportar').addEventListener('change', (e) => { if (e.target.name === 'fmt') formato = e.target.value; atualizarOpcoes(); });

const utm = () => d && Math.abs(d.origem[0]) > 100000 && Math.abs(d.origem[0]) < 900000 && Math.abs(d.origem[1]) > 100000 && Math.abs(d.origem[1]) < 10000000;

function atualizarOpcoes() {
  const f = formato, emFolha = folha >= 0;
  const mostra = (sel, sim) => $e(sel).classList.toggle('hide', !sim);
  $e('#ex-desc').textContent = FORMATOS[f].desc;
  const desenho = ['pdf', 'png', 'jpg', 'svg', 'docx'].includes(f);
  mostra('#op-oque', desenho);
  $e('#ex-oque option[value=folha]').disabled = !emFolha;
  if (emFolha && desenho) $e('#ex-oque').value = 'folha';
  else if ($e('#ex-oque').value === 'folha') $e('#ex-oque').value = 'todo';
  const papel = (f === 'pdf' || f === 'svg') && $e('#ex-oque').value !== 'folha';
  mostra('#op-papel', papel);
  mostra('#op-escala', papel);
  mostra('#op-cores', desenho);
  mostra('#op-res', f === 'png' || f === 'jpg');
  mostra('#op-utm', f === 'kml' || f === 'csv');
  const semUtm = (f === 'kml' || f === 'csv') && !utm();
  const escalaChutada = papel && $e('#ex-escala').value !== '0' && Cad.UNIDADES[d?.unidades] === undefined;
  $e('#ex-aviso').textContent = semUtm ? 'Este desenho não parece estar em coordenadas UTM (E e N em metros), então não dá para converter para latitude e longitude.'
    : escalaChutada ? `A escala usa o desenho em ${unidadeNome()} (o arquivo não diz a unidade). Se não for, mude em Distância › “Desenho em”.` : '';
  $e('#ex-ir').disabled = semUtm;
}

$e('#ex-ir').addEventListener('click', (e) => F.trabalhando(e.currentTarget, async (msg) => {
  const op = {
    oque: $e('#ex-oque').value, papel: $e('#ex-papel').value, escala: +$e('#ex-escala').value, pb: $e('#ex-cores').value === 'pb',
    lw: +$e('#ex-linha').value, res: +$e('#ex-res').value, soVisiveis: $e('#ex-visiveis').checked,
    fuso: +$e('#ex-fuso').value, sul: $e('#ex-hemis').value === 'S',
  };
  try { localStorage.setItem('dwg-fuso', String(op.fuso)); } catch (err) { /* só não lembra */ }
  const base = F.nomeBase(nomeArquivo) + (op.oque === 'folha' && folha >= 0 ? ' - ' + folhas[folha].nome : '');
  // deixa o botão mostrar a mensagem antes do trabalho pesado
  const passo = async (m) => { msg(m); await new Promise((r) => setTimeout(r, 30)); };
  let blob, ext = formato;
  if (formato === 'pdf') { await passo('Gerando PDF…'); blob = await gerarPdf(op); }
  else if (formato === 'png' || formato === 'jpg') { await passo('Gerando imagem…'); blob = await gerarImagem(op, formato); }
  else if (formato === 'svg') { await passo('Gerando SVG…'); blob = gerarSvg(op); }
  else if (formato === 'dxf') {
    await passo('Gerando DXF…');
    const ocultas = op.soVisiveis ? d.camadas.filter((c, i) => !vis[i]).map((c) => c.nome) : [];
    const r = await pedirAoLeitor({ acao: 'dxf', camadasOcultas: ocultas });
    blob = new Blob([r.dxf], { type: 'application/dxf' });
  } else if (formato === 'xlsx') { await passo('Somando quantitativos…'); blob = await gerarXlsx(op); }
  else if (formato === 'docx') { await passo('Montando o relatório…'); blob = await gerarDocx(op); }
  else if (formato === 'kml') { await passo('Convertendo coordenadas…'); blob = gerarKml(op); }
  else if (formato === 'csv') { await passo('Convertendo coordenadas…'); blob = gerarCsv(op); }
  F.baixar(blob, base + '.' + ext);
  F.toast(`Pronto: ${FORMATOS[formato].nome} (${F.tamanho(blob.size)}).`);
}));

// ---------- cenas para exportar ----------
const visDe = (op) => (op.soVisiveis ? vis : d.camadas.map(() => true));
const hoje = () => new Date().toLocaleDateString('pt-BR');

// área do modelo a exportar (coordenadas relativas à origem)
function areaModelo(op) {
  if (op.oque === 'tela' && folha < 0) return [(0 - V.tx) / V.s, -(H - V.ty) / V.s, (W - V.tx) / V.s, -(0 - V.ty) / V.s];
  return d.caixa;
}

// cena em milímetros (papel), para PDF, SVG e a imagem do relatório
function cenaPapel(op) {
  if (op.oque === 'folha' && folha >= 0) {
    const f = folhas[folha], p = papelDaFolha(f);
    const s = p.fat, tx = p.larg / 2 - p.cx * s, ty = p.alt / 2 + p.cy * s;
    return { larg: p.larg, alt: p.alt, itens: itensDaFolha(f, d, visDe(op), s, tx, ty), rodape: '', escala: 'folha ' + p.nome };
  }
  const [x1, y1, x2, y2] = areaModelo(op), aw = x2 - x1, ah = y2 - y1;
  let [Pw, Ph] = PAPEIS[op.papel] || PAPEIS.A3;
  if (aw < ah) [Pw, Ph] = [Ph, Pw]; // retrato para área alta
  const m = 10, rod = 7, uw = Pw - 2 * m, uh = Ph - 2 * m - rod;
  let s, escala;
  if (!op.escala) { s = Math.min(uw / aw, uh / ah); escala = 'sem escala (ajustado à folha)'; }
  else {
    s = fator * 1000 / op.escala;
    escala = 'escala 1:' + op.escala;
    if (aw * s > uw * 1.001 || ah * s > uh * 1.001) F.toast(`Nesta escala a área não cabe no ${op.papel}: saiu o centro. Use um papel maior ou “Ajustar à folha”.`, true);
  }
  const ucx = m + uw / 2, ucy = m + uh / 2;
  const tx = ucx - ((x1 + x2) / 2) * s, ty = ucy + ((y1 + y2) / 2) * s;
  return { larg: Pw, alt: Ph, itens: [{ D: d, vis: visDe(op), s, tx, ty, clip: [m, m, Pw - m, Ph - m - rod] }],
    rodape: `${nomeArquivo} · ${escala} · ${op.papel} · ${hoje()} · gerado em wiapps.com.br/ferramentas`, escala };
}

// cena em pixels, com o lado maior = maxPx
function cenaImagem(op, maxPx) {
  const p = cenaPapel({ ...op, escala: 0, papel: 'A3' });
  if (op.oque === 'folha' && folha >= 0) {
    const k = maxPx / Math.max(p.larg, p.alt);
    return { larg: Math.round(p.larg * k), alt: Math.round(p.alt * k), k, base: p };
  }
  // imagem só da área, com 2% de margem
  const [x1, y1, x2, y2] = areaModelo(op), aw = x2 - x1, ah = y2 - y1, mg = 0.02 * Math.max(aw, ah);
  const s = maxPx / (Math.max(aw, ah) + 2 * mg);
  const larg = Math.round((aw + 2 * mg) * s), alt = Math.round((ah + 2 * mg) * s);
  return { larg, alt, k: 1, base: { larg, alt, itens: [{ D: d, vis: visDe(op), s, tx: (mg - x1) * s, ty: (mg + y2) * s, clip: null }] } };
}

// ---------- imagem ----------
async function gerarImagem(op, tipo) {
  const ci = cenaImagem(op, op.res);
  // limite de memória do canvas no celular (~40 milhões de pixels)
  if (ci.larg * ci.alt > 40e6) throw new Error('Imagem grande demais para este aparelho. Escolha uma resolução menor.');
  const c = document.createElement('canvas');
  c.width = ci.larg; c.height = ci.alt;
  // espessura: na folha, em mm do papel; na área do modelo, em px (cresce com a resolução)
  const lw = op.oque === 'folha' && folha >= 0 ? Math.max(op.lw, 1 / ci.k) : Math.max(1, op.res / 2400) * op.lw / 0.18;
  pintar(c.getContext('2d'), ci.base, { k: ci.k, fundo: '#fff', papel: true, pb: op.pb, lw, minTexto: 2 });
  return new Promise((ok, erro) => c.toBlob((b) => (b ? ok(b) : erro(new Error('Falha ao gerar a imagem.'))), tipo === 'jpg' ? 'image/jpeg' : 'image/png', 0.92));
}

// ---------- PDF vetorial (pdf-lib + operadores escritos à mão: rápido para milhões de pontos) ----------
const WINANSI = /[^\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g;
// símbolos comuns em desenho que a fonte padrão do PDF não tem
const paraWinAnsi = (s) => s.replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/≠/g, '<>').replace(/∅|⌀/g, 'Ø').replace(/Δ/g, 'D').replace(/μ/g, 'µ').replace(WINANSI, '?');
const rgbPdf = (c) => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255].map((v) => +v.toFixed(3)).join(' ');

async function gerarPdf(op) {
  await carregarLib('PDFLib');
  const { PDFDocument, StandardFonts, PDFName } = PDFLib;
  const cena = cenaPapel(op);
  const K = 72 / 25.4, Hmm = cena.alt;
  const doc = await PDFDocument.create();
  doc.setTitle(nomeArquivo);
  doc.setProducer('WiApps Ferramentas');
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([cena.larg * K, cena.alt * K]);
  const out = [];
  for (const it of cena.itens) pdfItem(out, it, op, K, Hmm, fonte);
  if (cena.rodape) {
    const t = paraWinAnsi(cena.rodape), sz = 2.4 * K;
    out.push(`BT /F1 ${sz.toFixed(2)} Tf 0.35 0.35 0.35 rg ${(10 * K).toFixed(2)} ${((Hmm - cena.alt + 5) * K).toFixed(2)} Td ${fonte.encodeText(t).toString()} Tj ET`);
  }
  const stream = doc.context.flateStream(out.join('\n'));
  page.node.addContentStream(doc.context.register(stream));
  page.node.setFontDictionary(PDFName.of('F1'), fonte.ref);
  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

function pdfItem(out, it, op, K, Hmm, fonte) {
  const D = it.D, s = it.s;
  // coordenadas do modelo direto no PDF: X = x·s + tx (mm) → pontos; Y invertido (PDF cresce para cima)
  const casas = Math.max(0, Math.min(6, Math.ceil(-Math.log10(0.02 / s))));
  const f = (v) => v.toFixed(casas);
  out.push('q');
  let cx1 = -Infinity, cy1 = -Infinity, cx2 = Infinity, cy2 = Infinity;
  if (it.clip) {
    const [X1, Y1, X2, Y2] = it.clip;
    out.push(`${(X1 * K).toFixed(2)} ${((Hmm - Y2) * K).toFixed(2)} ${((X2 - X1) * K).toFixed(2)} ${((Y2 - Y1) * K).toFixed(2)} re W n`);
    cx1 = (X1 - it.tx) / s; cx2 = (X2 - it.tx) / s; cy1 = (it.ty - Y2) / s; cy2 = (it.ty - Y1) / s;
  }
  out.push(`${(s * K).toFixed(6)} 0 0 ${(s * K).toFixed(6)} ${(it.tx * K).toFixed(3)} ${((Hmm - it.ty) * K).toFixed(3)} cm`);
  out.push(`${(op.lw / s).toFixed(casas + 2)} w 1 J 1 j`);
  const { pts: P, ini } = D;
  for (const g of montarGrupos(D)) {
    if (it.vis && !it.vis[g.cam]) continue;
    const cor = corPapel(g.tipo, g.cor, op.pb);
    out.push(rgbPdf(cor) + (g.tipo ? ' rg' : ' RG'));
    let n = 0;
    for (const i of g.polis) {
      const a = ini[i], b = ini[i + 1];
      // fora do recorte: pula
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let j = a; j < b; j++) { const x = P[2 * j], y = P[2 * j + 1]; if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
      if (x2 < cx1 || x1 > cx2 || y2 < cy1 || y1 > cy2) continue;
      let lin = f(P[2 * a]) + ' ' + f(P[2 * a + 1]) + ' m';
      for (let j = a + 1; j < b; j++) lin += ' ' + f(P[2 * j]) + ' ' + f(P[2 * j + 1]) + ' l';
      if (D.tipo[i] & 1) lin += ' h';
      out.push(lin);
      // descarrega de tempos em tempos (caminhos muito longos pesam no leitor de PDF)
      if (++n % 500 === 0) out.push(g.tipo ? 'f*' : 'S');
    }
    out.push(g.tipo ? 'f*' : 'S');
  }
  // textos (fonte Helvetica; altura do CAD = altura das maiúsculas)
  for (const t of D.textos) {
    if (it.vis && !it.vis[t.c]) continue;
    if (t.h * s < 0.35 || t.x < cx1 - t.h * 40 || t.x > cx2 + t.h * 40 || t.y < cy1 - t.h * 40 || t.y > cy2 + t.h * 40) continue;
    const tam = t.h / 0.718, cs = Math.cos(t.rot), sn = Math.sin(t.rot);
    const cor = op.pb ? 0 : impressa(t.cor);
    const linhas = t.t.split('\n'), passo = t.h * 1.66;
    const dy0 = linhas.length > 1 ? (t.av === 3 ? 0 : t.av === 2 ? -(linhas.length - 1) * passo / 2 : -(linhas.length - 1) * passo) : 0;
    const base = [0, 0.207 * tam, -t.h / 2, -t.h][t.av] || 0;
    linhas.forEach((ln, i) => {
      const txt = paraWinAnsi(ln);
      if (!txt.trim()) return;
      const w = fonte.widthOfTextAtSize(txt, tam);
      const ox = -w * [0, 0.5, 1][t.ah || 0], oy = base - (dy0 + i * passo);
      const X = t.x + cs * ox - sn * oy, Y = t.y + sn * ox + cs * oy;
      out.push(`BT /F1 ${tam.toFixed(4)} Tf ${rgbPdf(cor)} rg ${cs.toFixed(5)} ${sn.toFixed(5)} ${(-sn).toFixed(5)} ${cs.toFixed(5)} ${f(X)} ${f(Y)} Tm ${fonte.encodeText(txt).toString()} Tj ET`);
    });
  }
  out.push('Q');
}

// ---------- SVG ----------
const escXml = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

function gerarSvg(op) {
  const cena = cenaPapel(op);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${cena.larg.toFixed(2)}mm" height="${cena.alt.toFixed(2)}mm" viewBox="0 0 ${cena.larg.toFixed(3)} ${cena.alt.toFixed(3)}">`,
    `<rect width="100%" height="100%" fill="#fff"/>`];
  cena.itens.forEach((it, n) => {
    const D = it.D, s = it.s, casas = Math.max(0, Math.min(6, Math.ceil(-Math.log10(0.02 / s))));
    const f = (v) => +v.toFixed(casas);
    if (it.clip) out.push(`<clipPath id="r${n}"><rect x="${it.clip[0]}" y="${it.clip[1]}" width="${it.clip[2] - it.clip[0]}" height="${it.clip[3] - it.clip[1]}"/></clipPath>`);
    out.push(`<g${it.clip ? ` clip-path="url(#r${n})"` : ''}><g transform="matrix(${s} 0 0 ${-s} ${it.tx} ${it.ty})" stroke-linecap="round" stroke-linejoin="round">`);
    for (const g of montarGrupos(D)) {
      if (it.vis && !it.vis[g.cam]) continue;
      const cor = corPapel(g.tipo, g.cor, op.pb);
      let dd = '';
      for (const i of g.polis) {
        const a = D.ini[i], b = D.ini[i + 1];
        dd += 'M' + f(D.pts[2 * a]) + ' ' + f(D.pts[2 * a + 1]);
        for (let j = a + 1; j < b; j++) dd += 'L' + f(D.pts[2 * j]) + ' ' + f(D.pts[2 * j + 1]);
        if (D.tipo[i] & 1) dd += 'Z';
      }
      out.push(g.tipo ? `<path fill="${hex(cor)}" fill-rule="evenodd" d="${dd}"/>` : `<path fill="none" stroke="${hex(cor)}" stroke-width="${+(op.lw / s).toFixed(casas + 2)}" d="${dd}"/>`);
    }
    out.push('</g>');
    const bl = ['alphabetic', 'text-after-edge', 'central', 'hanging'], anc = ['start', 'middle', 'end'];
    for (const t of D.textos) {
      if (it.vis && !it.vis[t.c]) continue;
      const px = t.h * s;
      if (px < 0.35) continue;
      const X = t.x * s + it.tx, Y = -t.y * s + it.ty, linhas = t.t.split('\n'), passo = px * 1.66;
      const dy0 = linhas.length > 1 ? (t.av === 3 ? 0 : t.av === 2 ? -(linhas.length - 1) * passo / 2 : -(linhas.length - 1) * passo) : 0;
      const spans = linhas.map((ln, i) => `<tspan x="${X.toFixed(3)}" y="${(Y + dy0 + i * passo).toFixed(3)}">${escXml(ln)}</tspan>`).join('');
      out.push(`<text font-family="Arial,Helvetica,sans-serif" font-size="${(px / 0.72).toFixed(3)}" fill="${op.pb ? '#000' : hex(impressa(t.cor))}" text-anchor="${anc[t.ah] || 'start'}" dominant-baseline="${bl[t.av] || 'alphabetic'}"${t.rot ? ` transform="rotate(${(-t.rot * 180 / Math.PI).toFixed(3)} ${X.toFixed(3)} ${Y.toFixed(3)})"` : ''}>${spans}</text>`);
    }
    out.push('</g>');
  });
  if (cena.rodape) out.push(`<text x="10" y="${cena.alt - 5}" font-family="Arial,sans-serif" font-size="2.4" fill="#595959">${escXml(cena.rodape)}</text>`);
  out.push('</svg>');
  return new Blob([out.join('\n')], { type: 'image/svg+xml' });
}

// ---------- quantitativos ----------
function quantitativos(op) {
  const v = visDe(op), idx = new Map(d.camadas.map((c, i) => [c.nome, i]));
  const ok = (nome) => v[idx.get(nome)] !== false;
  const comp = new Map(), areas = new Map();
  const { pts: P, ini, cam, tipo } = d;
  for (let i = 0; i < cam.length; i++) {
    if (!v[cam[i]]) continue;
    const p = P.subarray(2 * ini[i], 2 * ini[i + 1]), nome = d.camadas[cam[i]].nome, t = tipo[i];
    if (!(t & 6)) {
      const c = comp.get(nome) || { n: 0, m: 0 };
      c.n++; c.m += Cad.comprimento(p, !!(t & 1)) * fator;
      comp.set(nome, c);
    }
    if (t & 1) {
      const a = areas.get(nome) || { n: 0, m2: 0, nh: 0, h2: 0 }, ar = Cad.area(p) * fator * fator;
      if (t & 6) { a.nh++; a.h2 += ar; } else { a.n++; a.m2 += ar; }
      areas.set(nome, a);
    }
  }
  const ord = (m) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
  const atributos = d.atributos.filter((a) => ok(a.camada));
  const tags = [...new Set(atributos.flatMap((a) => Object.keys(a.at)))];
  return {
    blocos: d.blocos.filter((b) => ok(b.camada)),
    atributos, tags,
    comprimentos: ord(comp), areas: ord(areas),
    textos: d.textos.filter((t) => v[t.c]),
  };
}
const unidadeNome = () => F.$('#unid').selectedOptions[0].textContent;

// ---------- Excel (SpreadsheetML escrito à mão, empacotado com JSZip) ----------
function colLetra(i) { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function planilha(linhas, larguras) {
  // estilos: 1 = cabeçalho, 2 = 0,00, 3 = inteiro, 4 = 0,000
  const rows = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, c) => {
    const ref = colLetra(c) + (r + 1);
    if (v === null || v === undefined || v === '') return '';
    if (r === 0) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${escXml(v)}</t></is></c>`;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${Number.isInteger(v) ? 3 : v.casas === 3 ? 4 : 2}"><v>${v}</v></c>`;
    if (v && typeof v === 'object' && 'n' in v) return `<c r="${ref}" s="${v.s}"><v>${v.n}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = (larguras || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const ult = colLetra(Math.max(0, (linhas[0] || []).length - 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + (cols ? `<cols>${cols}</cols>` : '') + `<sheetData>${rows}</sheetData>`
    + (linhas.length > 1 ? `<autoFilter ref="A1:${ult}${linhas.length}"/>` : '') + `</worksheet>`;
}
const n3 = (v) => ({ n: v, s: 4 }), n2 = (v) => ({ n: v, s: 2 });

async function gerarXlsx(op) {
  await carregarLib('JSZip');
  const q = quantitativos(op), ox = d.origem[0], oy = d.origem[1];
  const abas = [
    ['Resumo', [['Item', 'Valor'], ['Arquivo', nomeArquivo], ['Data', hoje()], ['Desenho em', unidadeNome()],
      ['Camadas consideradas', op.soVisiveis ? 'só as visíveis na tela' : 'todas'], ['Blocos diferentes', q.blocos.length],
      ['Blocos inseridos (total)', q.blocos.reduce((s, b) => s + b.n, 0)], ['Textos', q.textos.length],
      ['Observação', 'Comprimentos em m e áreas em m², convertidos pela unidade acima. Áreas de hachuras com furos são somadas sem descontar os furos.']], [28, 60]],
    ['Blocos', [['Bloco', 'Camada', 'Quantidade', 'Inseridos direto no desenho'], ...q.blocos.map((b) => [b.bloco, b.camada, b.n, b.soltos])], [40, 24, 12, 16]],
    ['Comprimentos', [['Camada', 'Linhas e polilinhas', 'Comprimento total (m)'], ...q.comprimentos.map(([c, v]) => [c, v.n, n2(v.m)])], [30, 18, 22]],
    ['Áreas', [['Camada', 'Contornos fechados', 'Área dos contornos (m²)', 'Hachuras', 'Área hachurada (m²)'],
      ...q.areas.map(([c, v]) => [c, v.n, n2(v.m2), v.nh, n2(v.h2)])], [30, 18, 22, 12, 20]],
  ];
  if (q.atributos.length) abas.push(['Atributos', [['Bloco', 'Camada', 'X', 'Y', ...q.tags],
    ...q.atributos.map((a) => [a.bloco, a.camada, n3(a.x), n3(a.y), ...q.tags.map((t) => a.at[t] ?? '')])], [30, 20, 14, 14, ...q.tags.map(() => 14)]]);
  abas.push(['Textos', [['Texto', 'Camada', 'X', 'Y', 'Altura'], ...q.textos.slice(0, 100000).map((t) => [t.t.replace(/\n/g, ' '), d.camadas[t.c].nome, n3(t.x + ox), n3(t.y + oy), n3(t.h)])], [50, 22, 14, 14, 10]]);

  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${abas.map((a, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas.map((a, i) => `<sheet name="${escXml(a[0])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((a, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F5C99"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`);
  abas.forEach((a, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, planilha(a[1], a[2])));
  return z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------- Word (relatório) ----------
const pW = (txt, estilo, extra = '') => `<w:p>${estilo ? `<w:pPr><w:pStyle w:val="${estilo}"/></w:pPr>` : ''}<w:r>${extra}<w:t xml:space="preserve">${escXml(txt)}</w:t></w:r></w:p>`;
function tabelaW(cab, linhas, larg) {
  const total = larg.reduce((a, b) => a + b, 0), tw = larg.map((l) => Math.round(l / total * 9638));
  const cel = (v, i, cabec) => `<w:tc><w:tcPr><w:tcW w:w="${tw[i]}" w:type="dxa"/>${cabec ? '<w:shd w:val="clear" w:color="auto" w:fill="1F5C99"/>' : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/>${typeof v === 'number' ? '<w:jc w:val="right"/>' : ''}</w:pPr><w:r>${cabec ? '<w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>' : ''}<w:t xml:space="preserve">${escXml(typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 2) : v)}</w:t></w:r></w:p></w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid>${tw.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
    + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cab.map((v, i) => cel(v, i, true)).join('')}</w:tr>`
    + linhas.map((l) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${l.map((v, i) => cel(v, i, false)).join('')}</w:tr>`).join('') + `</w:tbl>`;
}

async function gerarDocx(op) {
  await carregarLib('JSZip');
  const q = quantitativos(op);
  // imagem do desenho: fundo branco, 2400 px
  const img = await gerarImagem({ ...op, res: 2400 }, 'png');
  const ci = cenaImagem(op, 2400);
  const largCm = 17, altCm = Math.min(22, largCm * ci.alt / ci.larg), emuW = Math.round(altCm * ci.larg / ci.alt * 360000), emuH = Math.round(altCm * 360000);
  const desenho = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emuW}" cy="${emuH}"/><wp:docPr id="1" name="Desenho"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="desenho.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emuW}" cy="${emuH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="6350"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const partes = [
    pW('Relatório do desenho', 'Titulo'),
    pW(nomeArquivo, 'Subtitulo'),
    pW(`Gerado em ${hoje()} · desenho em ${unidadeNome()} · camadas: ${op.soVisiveis ? 'só as visíveis' : 'todas'}${folha >= 0 && op.oque === 'folha' ? ' · folha ' + folhas[folha].nome : ''}`, 'Info'),
    desenho,
    pW('Blocos', 'Secao'),
  ];
  const LIM = 300;
  partes.push(q.blocos.length ? tabelaW(['Bloco', 'Camada', 'Quantidade'], q.blocos.slice(0, LIM).map((b) => [b.bloco, b.camada, b.n]), [5, 3, 1.4]) : pW('Nenhum bloco com nome.', ''));
  if (q.blocos.length > LIM) partes.push(pW(`… e mais ${q.blocos.length - LIM} linhas (a lista completa sai no Excel).`, 'Info'));
  partes.push(pW('Comprimentos por camada', 'Secao'));
  partes.push(tabelaW(['Camada', 'Linhas', 'Comprimento (m)'], q.comprimentos.map(([c, v]) => [c, v.n, v.m]), [5, 1.4, 2]));
  const comArea = q.areas.filter(([, v]) => v.m2 > 0 || v.h2 > 0);
  if (comArea.length) {
    partes.push(pW('Áreas por camada', 'Secao'));
    partes.push(tabelaW(['Camada', 'Contornos', 'Área (m²)', 'Hachuras', 'Área hachurada (m²)'], comArea.map(([c, v]) => [c, v.n, v.m2, v.nh, v.h2]), [4, 1.3, 1.8, 1.3, 2]));
  }
  if (q.atributos.length && q.atributos.length <= LIM && q.tags.length <= 6) {
    partes.push(pW('Atributos dos blocos', 'Secao'));
    partes.push(tabelaW(['Bloco', ...q.tags], q.atributos.map((a) => [a.bloco, ...q.tags.map((t) => a.at[t] ?? '')]), [3, ...q.tags.map(() => 2)]));
  }
  partes.push(pW('Comprimentos em metros e áreas em m², convertidos pela unidade do desenho. Textos e a lista completa de atributos saem na exportação para Excel.', 'Info'));
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${partes.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Titulo"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="1F5C99"/><w:sz w:val="36"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Subtitulo"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Secao"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F5C99"/><w:sz w:val="26"/></w:rPr></w:style>`
    + `<w:style w:type="paragraph" w:styleId="Info"><w:name w:val="Info"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>`;
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/desenho.png"/><Relationship Id="rIdEst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.file('word/document.xml', docXml);
  z.file('word/styles.xml', estilos);
  z.file('word/media/desenho.png', img);
  return z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---------- UTM → latitude/longitude (SIRGAS 2000 ≈ WGS 84; fórmulas de Snyder) ----------
function utmGeo(E, N, fuso, sul) {
  const a = 6378137, fl = 1 / 298.257222101, k0 = 0.9996, e2 = fl * (2 - fl), ep2 = e2 / (1 - e2);
  const x = E - 500000, y = sul ? N - 10000000 : N;
  const mu = (y / k0) / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sp = Math.sin(p1), cp = Math.cos(p1), tp = Math.tan(p1);
  const C1 = ep2 * cp * cp, T1 = tp * tp, N1 = a / Math.sqrt(1 - e2 * sp * sp), R1 = a * (1 - e2) / Math.pow(1 - e2 * sp * sp, 1.5), D = x / (N1 * k0);
  const lat = p1 - (N1 * tp / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (fuso * 6 - 183) * Math.PI / 180 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / cp;
  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}

function gerarKml(op) {
  const v = visDe(op), ox = d.origem[0], oy = d.origem[1];
  const { pts: P, ini, cam, tipo } = d;
  const porCamada = new Map();
  let total = 0;
  for (let i = 0; i < cam.length && total < 60000; i++) {
    if (!v[cam[i]] || tipo[i] & 6) continue;
    const coords = [];
    for (let j = ini[i]; j < ini[i + 1]; j++) {
      const [la, lo] = utmGeo(P[2 * j] + ox, P[2 * j + 1] + oy, op.fuso, op.sul);
      coords.push(lo.toFixed(7) + ',' + la.toFixed(7) + ',0');
    }
    if (tipo[i] & 1) coords.push(coords[0]);
    (porCamada.get(cam[i]) || porCamada.set(cam[i], []).get(cam[i])).push(`<Placemark><styleUrl>#c${cam[i]}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords.join(' ')}</coordinates></LineString></Placemark>`);
    total++;
  }
  // KML usa cor em aabbggrr
  const corKml = (c) => { c = legivel(c); return 'ff' + (c & 255).toString(16).padStart(2, '0') + (c >> 8 & 255).toString(16).padStart(2, '0') + (c >> 16 & 255).toString(16).padStart(2, '0'); };
  const estilos = [...porCamada.keys()].map((c) => `<Style id="c${c}"><LineStyle><color>${corKml(d.camadas[c].cor)}</color><width>2</width></LineStyle></Style>`).join('');
  const pastas = [...porCamada.entries()].map(([c, l]) => `<Folder><name>${escXml(d.camadas[c].nome)}</name>${l.join('')}</Folder>`).join('');
  const q = quantitativos(op);
  const pontos = q.atributos.slice(0, 20000).map((a) => {
    const [la, lo] = utmGeo(a.x, a.y, op.fuso, op.sul);
    const nome = Object.values(a.at)[0] ?? a.bloco;
    const desc = Object.entries(a.at).map(([k, x]) => `${k}: ${x}`).join('\n');
    return `<Placemark><name>${escXml(nome)}</name><description>${escXml(a.bloco + '\n' + desc)}</description><Point><coordinates>${lo.toFixed(7)},${la.toFixed(7)},0</coordinates></Point></Placemark>`;
  }).join('');
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escXml(nomeArquivo)}</name>`
    + `<description>${escXml(`UTM fuso ${op.fuso}${op.sul ? 'S' : 'N'}, SIRGAS 2000. Gerado em ${hoje()}.`)}</description>${estilos}${pastas}`
    + (pontos ? `<Folder><name>Pontos (blocos com atributos)</name>${pontos}</Folder>` : '') + `</Document></kml>`;
  if (total >= 60000) F.toast('Desenho grande: saíram as primeiras 60 mil linhas. Desligue camadas para escolher o que vai.', true);
  return new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
}

function gerarCsv(op) {
  const v = visDe(op), ox = d.origem[0], oy = d.origem[1];
  const { pts: P, ini, cam, tipo } = d;
  const br = (x, c) => x.toFixed(c).replace('.', ',');
  const out = ['﻿Camada;Objeto;Vértice;E;N;Latitude;Longitude'];
  let obj = 0, linhas = 0;
  for (let i = 0; i < cam.length && linhas < 1e6; i++) {
    if (!v[cam[i]] || tipo[i] & 6) continue;
    obj++;
    const nome = d.camadas[cam[i]].nome.replace(/;/g, ',');
    for (let j = ini[i], k = 1; j < ini[i + 1]; j++, k++) {
      const E = P[2 * j] + ox, N = P[2 * j + 1] + oy, [la, lo] = utmGeo(E, N, op.fuso, op.sul);
      out.push(`${nome};${obj};${k};${br(E, 3)};${br(N, 3)};${br(la, 8)};${br(lo, 8)}`);
      linhas++;
    }
  }
  if (linhas >= 1e6) F.toast('Saiu o primeiro 1 milhão de vértices. Desligue camadas para escolher o que vai.', true);
  return new Blob([out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}
