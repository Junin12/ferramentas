'use strict';

const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const MAX_FILE = 150 * 1024 * 1024;

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const st = {
  bytes: null, doc: null, name: 'documento', scale: 1.2, tool: 'select',
  anns: [], sel: null, undo: [], pages: [], dirty: false, uid: 0,
  fontSize: 14, inkWidth: 2,
};
let observer = null;
let drag = null;
let editing = null;

/* ---------- utilidades ---------- */
let toastTimer = 0;
function toast(msg, isErr) {
  const el = $('#status');
  el.textContent = msg;
  el.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), isErr ? 6000 : 3000);
}
function setBusy(on, msg) {
  $('#progress').classList.toggle('hide', !on);
  if (on && msg) toast(msg);
}
function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function snapshot() { return JSON.stringify(st.anns); }
function pushUndo(snap) {
  st.undo.push(snap || snapshot());
  if (st.undo.length > 50) st.undo.shift();
  st.dirty = true;
  updateUI();
}
function getAnn(id) { return st.anns.find((a) => a.id === Number(id)); }

function updateUI() {
  const has = !!st.doc;
  document.querySelectorAll('[data-tool]').forEach((b) => (b.disabled = !has));
  ['save', 'toword', 'paginas', 'assinar', 'smaller', 'bigger', 'zout', 'zin', 'imgfile'].forEach((id) => ($('#' + id).disabled = !has));
  $('[data-tool="form"]').hidden = !st.temForm;
  $('#imglabel').setAttribute('aria-disabled', String(!has));
  $('#undo').disabled = !st.undo.length;
  $('#del').disabled = st.sel === null;
  $('#empty').classList.toggle('hide', has);
  $('#zlabel').textContent = Math.round(st.scale * 100) + '%';
  $('#pages').className = 'tool-' + st.tool;
}

/* ---------- abrir e renderizar ---------- */
async function openFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return toast('Escolha um arquivo .pdf', true);
  if (file.size > MAX_FILE) return toast('Arquivo maior que 150 MB.', true);
  if (!window.pdfjsLib || !window.PDFLib || !window.JSZip) {
    return toast('Não consegui carregar as bibliotecas. Verifique a internet e recarregue.', true);
  }
  try {
    setBusy(true, 'Abrindo PDF…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    st.anns = []; st.undo = []; st.sel = null; st.dirty = false;
    await carregar(bytes, false);
    st.name = file.name.replace(/\.pdf$/i, '');
    if (st.temForm) {
      setTool('form');
      toast('Este PDF tem campos de formulário: toque neles para preencher.');
    } else toast('PDF aberto. Escolha uma ferramenta.');
  } catch (err) {
    console.error(err);
    toast(err && err.name === 'PasswordException' ? 'PDF protegido por senha: ainda não suportado.' : 'Não consegui abrir este PDF. Ele pode estar corrompido.', true);
  } finally {
    setBusy(false);
  }
}

// troca o documento aberto (ao abrir um arquivo e depois de organizar as páginas)
async function carregar(bytes, manterZoom) {
  const doc = await pdfjsLib.getDocument({ isEvalSupported: false, data: bytes.slice() }).promise;
  if (st.doc) st.doc.destroy();
  st.bytes = bytes; st.doc = doc;
  const campos = await doc.getFieldObjects();
  st.temForm = !!campos && Object.keys(campos).length > 0;
  if (!st.temForm && st.tool === 'form') setTool('select');
  await buildPages(manterZoom);
}

// bytes do PDF com o que foi digitado nos campos do formulário.
// O pdf.js guarda o valor por caixa (widget); quem grava no campo é o pdf-lib, do jeito que os leitores de PDF esperam.
async function bytesAtuais() {
  const ser = st.doc.annotationStorage.serializable;
  const vals = ser instanceof Map ? ser : ser && ser.map;
  if (!vals || !vals.size) return st.bytes;
  const { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, StandardFonts } = PDFLib;
  const doc = await PDFDocument.load(st.bytes);
  const form = doc.getForm();
  for (const [nome, caixas] of Object.entries((await st.doc.getFieldObjects()) || {})) {
    for (const cx of caixas) {
      if (!vals.has(cx.id)) continue;
      const v = vals.get(cx.id).value;
      try {
        const campo = form.getField(nome);
        if (campo instanceof PDFTextField) campo.setText(String(v ?? ''));
        else if (campo instanceof PDFCheckBox) v ? campo.check() : campo.uncheck();
        else if (campo instanceof PDFRadioGroup) {
          // a opção vem pelo nome ou, quando o campo tem lista /Opt, pela posição nela ("0", "1"…)
          const ops = campo.getOptions(), ev = cx.exportValues;
          if (v) campo.select(ops.includes(ev) ? ev : ops[Number(ev)] ?? ev);
        }
        else if (campo instanceof PDFDropdown || campo instanceof PDFOptionList) {
          const sel = [].concat(v).filter(Boolean);
          if (sel.length) campo.select(sel.length > 1 ? sel : sel[0]); else campo.clear();
        }
      } catch (e) { console.warn('campo não preenchido:', nome, e); }
    }
  }
  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  return doc.save();
}

async function buildPages(manterZoom) {
  if (observer) observer.disconnect();
  const box = $('#pages');
  box.replaceChildren();
  st.pages = [];
  for (let i = 0; i < st.doc.numPages; i++) {
    const page = await st.doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const div = document.createElement('div');
    div.className = 'page';
    const canvas = document.createElement('canvas');
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    div.append(canvas, overlay);
    box.append(div);
    // vp: posição na tela (já com a rotação da página) → coordenadas do PDF na hora de salvar
    const p = { page, vp, w: vp.width, h: vp.height, div, canvas, overlay, form: null, rendered: false, task: null, i };
    overlay.addEventListener('pointerdown', (e) => onDown(e, p));
    overlay.addEventListener('dblclick', (e) => onDbl(e, p));
    st.pages.push(p);
  }
  if (st.pages.length && !manterZoom) {
    const avail = $('#main').clientWidth - 24;
    st.scale = Math.max(0.5, Math.min(1.4, avail / st.pages[0].w));
  }
  layoutPages();
}

function layoutPages() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && renderPage(st.pages[Number(e.target.dataset.i)])),
    { root: $('#main'), rootMargin: '700px 0px' }
  );
  st.pages.forEach((p) => {
    if (p.task) { try { p.task.cancel(); } catch (e) { /* já terminou */ } }
    p.rendered = false;
    p.canvas.width = 0;
    p.div.dataset.i = p.i;
    p.div.style.width = p.w * st.scale + 'px';
    p.div.style.height = p.h * st.scale + 'px';
    p.div.style.setProperty('--scale-factor', st.scale); // usado pela camada de formulário do pdf.js
    drawOverlay(p.i);
    observer.observe(p.div);
  });
  updateUI();
}

async function renderPage(p) {
  if (!p || p.rendered) return;
  p.rendered = true;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = p.page.getViewport({ scale: st.scale * dpr });
  p.canvas.width = Math.floor(vp.width);
  p.canvas.height = Math.floor(vp.height);
  p.canvas.style.width = p.w * st.scale + 'px';
  p.canvas.style.height = p.h * st.scale + 'px';
  try {
    p.task = p.page.render({ canvasContext: p.canvas.getContext('2d'), viewport: vp });
    await p.task.promise;
    if (st.temForm) await renderForm(p);
  } catch (e) {
    if (e && e.name !== 'RenderingCancelledException') console.error(e);
  }
}

// campos do formulário: o pdf.js desenha caixas de texto, marcações e listas por cima da página.
// O que for digitado fica em st.doc.annotationStorage e entra no arquivo ao salvar.
const LINKS = { // o pdf.js pede este objeto; links do PDF não são usados aqui
  externalLinkEnabled: false, getDestinationHash: () => '#', getAnchorUrl: () => '#', addLinkAttributes() {},
  goToDestination() {}, goToPage() {}, executeNamedAction() {}, executeSetOCGState() {}, navigateTo() {},
};
async function renderForm(p) {
  const anns = (await p.page.getAnnotations({ intent: 'display' })).filter((a) => a.annotationType === 20); // 20 = campo (Widget)
  if (!anns.length) return;
  if (!p.form) {
    p.form = document.createElement('div');
    p.form.className = 'annotationLayer';
    p.div.insertBefore(p.form, p.overlay);
    p.form.addEventListener('input', () => (st.dirty = true));
    p.form.addEventListener('change', () => (st.dirty = true));
  }
  p.form.replaceChildren();
  const viewport = p.page.getViewport({ scale: st.scale }).clone({ dontFlip: true });
  await new pdfjsLib.AnnotationLayer({ div: p.form, accessibilityManager: null, annotationCanvasMap: null, l10n: null, page: p.page, viewport })
    .render({ viewport, annotations: anns, imageResourcesPath: '', renderForms: true, linkService: LINKS, downloadManager: null,
      annotationStorage: st.doc.annotationStorage, enableScripting: false, hasJSActions: false, fieldObjects: null });
}

/* ---------- anotações: desenho ---------- */
function drawOverlay(i) {
  const p = st.pages[i];
  p.overlay.replaceChildren();
  for (const a of st.anns) if (a.page === i) p.overlay.append(makeEl(a, p));
}

function makeEl(a, p) {
  const s = st.scale;
  const sel = st.sel === a.id;
  let el;
  if (a.type === 'ink') {
    el = document.createElementNS(NS, 'svg');
    el.setAttribute('class', 'inkbox');
    el.setAttribute('width', p.w * s);
    el.setAttribute('height', p.h * s);
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('class', 'ann' + (sel ? ' sel' : ''));
    pl.dataset.id = a.id;
    pl.setAttribute('points', a.pts.map((q) => q[0] * s + ',' + q[1] * s).join(' '));
    pl.setAttribute('stroke', a.color);
    pl.setAttribute('stroke-width', a.width * s);
    el.append(pl);
    return el;
  }
  if (a.type === 'img') {
    el = document.createElement('img');
    el.src = a.dataUrl;
    el.alt = 'Imagem inserida';
    el.draggable = false;
  } else {
    el = document.createElement('div');
  }
  el.className = 'ann ' + (a.type === 'text' ? 'txt' : a.type) + (sel ? ' sel' : '');
  el.dataset.id = a.id;
  el.style.left = a.x * s + 'px';
  el.style.top = a.y * s + 'px';
  if (a.type === 'text') {
    el.textContent = a.text;
    el.style.fontSize = a.size * s + 'px';
    el.style.color = a.color;
  } else {
    el.style.width = a.w * s + 'px';
    el.style.height = a.h * s + 'px';
    if (a.type === 'hl') el.style.background = a.color + '99';
  }
  if (sel && (a.type === 'hl' || a.type === 'erase' || a.type === 'img')) {
    // <img> não aceita filhos: o puxador de redimensionar vai ao lado, no overlay
    const h = document.createElement('div');
    h.className = 'handle';
    h.dataset.id = a.id;
    h.style.position = 'absolute';
    h.style.left = (a.x + a.w) * s - 7 + 'px';
    h.style.top = (a.y + a.h) * s - 7 + 'px';
    h.style.right = h.style.bottom = 'auto';
    const wrap = document.createDocumentFragment();
    wrap.append(el, h);
    return wrap;
  }
  return el;
}

function redrawAll() { st.pages.forEach((p) => drawOverlay(p.i)); updateUI(); }
function select(id) {
  st.sel = id === null ? null : Number(id);
  redrawAll();
}

/* ---------- anotações: interação ---------- */
function toPt(e, p) {
  const r = p.overlay.getBoundingClientRect();
  return [(e.clientX - r.left) / st.scale, (e.clientY - r.top) / st.scale];
}

function onDown(e, p) {
  if (e.button !== undefined && e.button !== 0) return;
  if (editing && document.activeElement) document.activeElement.blur(); // fecha a edição e segue com o clique
  const [x, y] = toPt(e, p);
  const handle = e.target.closest('.handle');
  const target = e.target.closest('.ann');

  if (st.tool === 'select') {
    if (handle) {
      const a = getAnn(handle.dataset.id);
      drag = { kind: 'resize', a, p, snap: snapshot(), moved: false };
      e.preventDefault();
    } else if (target) {
      const a = getAnn(target.dataset.id);
      if (st.sel !== a.id) select(a.id);
      drag = { kind: 'move', a, p, sx: x, sy: y, ox: a.x, oy: a.y, orig: a.pts ? a.pts.map((q) => q.slice()) : null, snap: snapshot(), moved: false };
      e.preventDefault();
    } else select(null);
    return;
  }

  if (st.tool === 'text') {
    const snap = snapshot();
    const a = { id: ++st.uid, page: p.i, type: 'text', x, y, text: '', size: st.fontSize, color: $('#color').value };
    st.anns.push(a);
    st.sel = a.id;
    drawOverlay(p.i);
    startEdit(a, p, snap);
    e.preventDefault();
    return;
  }

  if (st.tool === 'hl' || st.tool === 'erase') {
    const d = document.createElement('div');
    d.className = 'ann ' + st.tool;
    d.style.cssText = `left:${x * st.scale}px;top:${y * st.scale}px;width:0;height:0;` +
      (st.tool === 'hl' ? `background:${$('#hlcolor').value}99;` : 'outline:1px dashed #888;');
    p.overlay.append(d);
    drag = { kind: 'rect', p, x0: x, y0: y, d, x, y, w: 0, h: 0 };
    e.preventDefault();
    return;
  }

  if (st.tool === 'ink') {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'inkbox');
    svg.setAttribute('width', p.w * st.scale);
    svg.setAttribute('height', p.h * st.scale);
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('stroke', $('#color').value);
    pl.setAttribute('stroke-width', st.inkWidth * st.scale);
    svg.append(pl);
    p.overlay.append(svg);
    drag = { kind: 'ink', p, pts: [[x, y]], pl };
    e.preventDefault();
  }
}

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const [x, y] = toPt(e, drag.p);
  const s = st.scale;
  if (drag.kind === 'move') {
    const dx = x - drag.sx, dy = y - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 1) return;
    drag.moved = true;
    if (drag.orig) drag.a.pts = drag.orig.map((q) => [q[0] + dx, q[1] + dy]);
    else { drag.a.x = drag.ox + dx; drag.a.y = drag.oy + dy; }
    drawOverlay(drag.p.i);
  } else if (drag.kind === 'resize') {
    const a = drag.a;
    drag.moved = true;
    a.w = Math.max(6, x - a.x);
    a.h = a.type === 'img' ? Math.max(6, a.w * (a.ratio || a.h / a.w)) : Math.max(6, y - a.y);
    drawOverlay(drag.p.i);
  } else if (drag.kind === 'rect') {
    drag.x = Math.min(x, drag.x0); drag.y = Math.min(y, drag.y0);
    drag.w = Math.abs(x - drag.x0); drag.h = Math.abs(y - drag.y0);
    Object.assign(drag.d.style, { left: drag.x * s + 'px', top: drag.y * s + 'px', width: drag.w * s + 'px', height: drag.h * s + 'px' });
  } else if (drag.kind === 'ink') {
    drag.pts.push([x, y]);
    drag.pl.setAttribute('points', drag.pts.map((q) => q[0] * s + ',' + q[1] * s).join(' '));
  }
});

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if ((d.kind === 'move' || d.kind === 'resize') && d.moved) pushUndo(d.snap);
  else if (d.kind === 'rect') {
    if (d.w > 3 && d.h > 3) {
      pushUndo();
      const a = { id: ++st.uid, page: d.p.i, type: st.tool, x: d.x, y: d.y, w: d.w, h: d.h, color: $('#hlcolor').value };
      st.anns.push(a);
    }
    drawOverlay(d.p.i);
  } else if (d.kind === 'ink') {
    if (d.pts.length > 1) {
      pushUndo();
      st.anns.push({ id: ++st.uid, page: d.p.i, type: 'ink', pts: d.pts, width: st.inkWidth, color: $('#color').value });
    }
    drawOverlay(d.p.i);
  }
  updateUI();
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

function onDbl(e, p) {
  if (st.tool !== 'select') return;
  const t = e.target.closest('.ann.txt');
  if (!t) return;
  const a = getAnn(t.dataset.id);
  if (a) startEdit(a, p, snapshot());
}

function startEdit(a, p, snap) {
  const el = p.overlay.querySelector(`.ann.txt[data-id="${a.id}"]`);
  if (!el) return;
  editing = a.id;
  try { el.contentEditable = 'plaintext-only'; } catch (e) { /* fallback abaixo */ }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.style.pointerEvents = 'auto';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const finish = () => {
    el.removeEventListener('blur', finish);
    editing = null;
    const t = el.innerText.replace(/ /g, ' ').replace(/\n+$/, '');
    if (!t.trim()) {
      st.anns = st.anns.filter((x) => x.id !== a.id);
      st.sel = null;
    } else if (t !== a.text) {
      a.text = t;
      pushUndo(snap);
    }
    drawOverlay(p.i);
    updateUI();
  };
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') el.blur(); });
}

/* ---------- barra de ferramentas ---------- */
function setTool(t) {
  st.tool = t;
  document.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tool === t)));
  updateUI();
}
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

$('#file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', (e) => openFile(e.dataTransfer.files[0]));

$('#undo').addEventListener('click', undo);
function undo() {
  if (!st.undo.length) return;
  st.anns = JSON.parse(st.undo.pop());
  if (!getAnn(st.sel)) st.sel = null;
  redrawAll();
}
$('#del').addEventListener('click', delSel);
function delSel() {
  if (st.sel === null) return;
  pushUndo();
  st.anns = st.anns.filter((a) => a.id !== st.sel);
  st.sel = null;
  redrawAll();
}
document.addEventListener('keydown', (e) => {
  if (editing || (document.activeElement && document.activeElement.isContentEditable)) return;
  if (e.target.closest && e.target.closest('input,textarea,select,dialog')) return; // digitando num campo do formulário ou numa janela
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (st.sel !== null) { e.preventDefault(); delSel(); } }
  else if (e.key === 'Escape') select(null);
});

function zoom(f) {
  st.scale = Math.max(0.5, Math.min(3, +(st.scale + f).toFixed(2)));
  layoutPages();
}
$('#zin').addEventListener('click', () => zoom(0.2));
$('#zout').addEventListener('click', () => zoom(-0.2));

function resizeSel(d) {
  const a = getAnn(st.sel);
  if (a && a.type === 'text') { pushUndo(); a.size = Math.max(6, Math.min(72, a.size + d * 2)); }
  else if (a && a.type === 'ink') { pushUndo(); a.width = Math.max(1, Math.min(20, a.width + d)); }
  else { st.fontSize = Math.max(6, Math.min(72, st.fontSize + d * 2)); st.inkWidth = Math.max(1, Math.min(20, st.inkWidth + d)); toast('Tamanho padrão: texto ' + st.fontSize + ', traço ' + st.inkWidth); }
  redrawAll();
}
$('#bigger').addEventListener('click', () => resizeSel(1));
$('#smaller').addEventListener('click', () => resizeSel(-1));
$('#color').addEventListener('input', (e) => {
  const a = getAnn(st.sel);
  if (a && (a.type === 'text' || a.type === 'ink')) { a.color = e.target.value; st.dirty = true; redrawAll(); }
});
$('#hlcolor').addEventListener('input', (e) => {
  const a = getAnn(st.sel);
  if (a && a.type === 'hl') { a.color = e.target.value; st.dirty = true; redrawAll(); }
});

/* ---------- imagem ---------- */
function imgToPng(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * k));
      c.height = Math.max(1, Math.round(im.naturalHeight * k));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL('image/png'), ratio: c.height / c.width });
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
    im.src = url;
  });
}
// imagem (ou assinatura) na página que está no meio da tela, já selecionada para mover
function inserirImagem(dataUrl, ratio, largura, emX = 0.1, emY = 0.1) {
  const p = currentPage();
  const w = p.w * largura;
  pushUndo();
  const a = { id: ++st.uid, page: p.i, type: 'img', x: p.w * emX, y: p.h * emY, w, h: w * ratio, ratio, dataUrl };
  st.anns.push(a);
  setTool('select');
  select(a.id);
  return a;
}
function currentPage() {
  const mid = innerHeight / 2;
  return st.pages.find((p) => { const r = p.div.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }) || st.pages[0];
}
$('#imgfile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !st.doc) return;
  if (!f.type.startsWith('image/')) return toast('Escolha um arquivo de imagem.', true);
  if (f.size > 25 * 1024 * 1024) return toast('Imagem muito grande (máx. 25 MB).', true);
  try {
    const { dataUrl, ratio } = await imgToPng(f);
    inserirImagem(dataUrl, ratio, 0.35);
    toast('Imagem inserida: arraste para mover e use o ponto azul para redimensionar.');
  } catch (err) {
    console.error(err);
    toast('Não consegui ler essa imagem.', true);
  }
});

/* ---------- páginas: girar, excluir e reordenar ---------- */
// rascunho da nova ordem; só vale ao tocar em Aplicar. i = página original, rot = giro a somar, del = excluir
let rasc = [];
const miniaturas = new Map();
$('#paginas').addEventListener('click', () => {
  rasc = st.pages.map((p) => ({ i: p.i, rot: 0, del: false }));
  miniaturas.clear();
  desenharPaginas();
  $('#dlg-pag').showModal();
});
function miniatura(i) {
  if (miniaturas.has(i)) return miniaturas.get(i);
  const p = st.pages[i], c = document.createElement('canvas');
  const vp = p.page.getViewport({ scale: 104 / Math.max(p.w, p.h) });
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  p.page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.catch(() => {});
  miniaturas.set(i, c);
  return c;
}
function desenharPaginas() {
  $('#pag-grade').replaceChildren(...rasc.map((d, k) => {
    const card = document.createElement('div');
    card.className = 'pg' + (d.del ? ' del' : '');
    card.dataset.k = k;
    card.innerHTML = `<div class="th"></div><b></b><div class="pg-bt">
      <button type="button" data-a="esq" aria-label="Girar para a esquerda">↺</button>
      <button type="button" data-a="dir" aria-label="Girar para a direita">↻</button>
      <button type="button" data-a="ant" aria-label="Mover para antes"${k ? '' : ' disabled'}>◀</button>
      <button type="button" data-a="dep" aria-label="Mover para depois"${k < rasc.length - 1 ? '' : ' disabled'}>▶</button>
      <button type="button" data-a="del" aria-pressed="${d.del}">${d.del ? 'Manter' : 'Excluir'}</button></div>`;
    const c = miniatura(d.i);
    c.style.transform = `rotate(${d.rot}deg)`;
    card.querySelector('.th').append(c);
    card.querySelector('b').textContent = `${k + 1}` + (d.i !== k ? ` (era ${d.i + 1})` : '');
    return card;
  }));
}
$('#pag-grade').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const k = Number(b.closest('.pg').dataset.k), d = rasc[k], a = b.dataset.a;
  if (a === 'esq' || a === 'dir') d.rot = (d.rot + (a === 'dir' ? 90 : 270)) % 360;
  else if (a === 'del') d.del = !d.del;
  else { const j = k + (a === 'ant' ? -1 : 1); [rasc[k], rasc[j]] = [rasc[j], rasc[k]]; }
  desenharPaginas();
  $(`#pag-grade .pg[data-k="${a === 'ant' ? k - 1 : a === 'dep' ? k + 1 : k}"] [data-a="${a}"]`)?.focus();
});
$('#pag-ok').addEventListener('click', aplicarPaginas);
async function aplicarPaginas() {
  const manter = rasc.filter((d) => !d.del);
  if (!rasc.some((d, k) => d.del || d.rot || d.i !== k)) return $('#dlg-pag').close();
  if (!manter.length) return toast('Deixe pelo menos uma página.', true);
  const comEdicao = new Set(st.anns.map((a) => a.page));
  const girada = manter.find((d) => d.rot && comEdicao.has(d.i));
  if (girada) return toast(`A página ${girada.i + 1} já tem edições: gire as páginas antes de escrever nelas.`, true);
  if (rasc.some((d) => d.del && comEdicao.has(d.i)) && !confirm('As edições feitas nas páginas excluídas serão perdidas. Continuar?')) return;
  $('#dlg-pag').close();
  try {
    setBusy(true, 'Organizando páginas…');
    const doc = await PDFLib.PDFDocument.load(await bytesAtuais());
    const pgs = doc.getPages();
    manter.forEach((d) => { if (d.rot) pgs[d.i].setRotation(PDFLib.degrees((pgs[d.i].getRotation().angle + d.rot) % 360)); });
    // tira todas e põe de volta só as mantidas, na nova ordem (preserva os campos de formulário, ao contrário de copiar para outro PDF)
    for (let k = pgs.length - 1; k >= 0; k--) doc.removePage(k);
    manter.forEach((d, k) => doc.insertPage(k, pgs[d.i]));
    const bytes = await doc.save();
    const novo = new Map(manter.map((d, k) => [d.i, k]));
    st.anns = st.anns.filter((a) => novo.has(a.page)).map((a) => ({ ...a, page: novo.get(a.page) }));
    st.undo = []; st.sel = null; st.dirty = true;
    await carregar(bytes, true);
    toast('Páginas organizadas. Toque em Salvar PDF para baixar.');
  } catch (err) {
    console.error(err);
    toast('Não consegui organizar as páginas.', true);
  } finally {
    setBusy(false);
  }
}

/* ---------- assinatura desenhada ---------- */
// guardada só neste aparelho (localStorage), até 4, para reutilizar
const ASS_KEY = 'editor-pdf-assinaturas';
const lerAss = () => { try { return JSON.parse(localStorage.getItem(ASS_KEY)) || []; } catch (e) { return []; } };
function gravarAss(l) {
  try { localStorage.setItem(ASS_KEY, JSON.stringify(l.slice(0, 4))); }
  catch (e) { toast('Não consegui guardar a assinatura neste aparelho.', true); }
}
const tela = $('#ass-tela'), pincel = tela.getContext('2d');
let rabiscou = false, tracando = null;
function limparTela() { pincel.clearRect(0, 0, tela.width, tela.height); rabiscou = false; }
function pontoTela(e) { const r = tela.getBoundingClientRect(); return [(e.clientX - r.left) * (tela.width / r.width), (e.clientY - r.top) * (tela.height / r.height)]; }
tela.addEventListener('pointerdown', (e) => {
  tela.setPointerCapture(e.pointerId);
  tracando = pontoTela(e);
  Object.assign(pincel, { lineWidth: 7, lineCap: 'round', lineJoin: 'round', strokeStyle: $('#color').value });
});
tela.addEventListener('pointermove', (e) => {
  if (!tracando) return;
  const q = pontoTela(e);
  pincel.beginPath(); pincel.moveTo(...tracando); pincel.lineTo(...q); pincel.stroke();
  tracando = q; rabiscou = true;
});
['pointerup', 'pointercancel'].forEach((ev) => tela.addEventListener(ev, () => (tracando = null)));
$('#ass-limpar').addEventListener('click', limparTela);

// recorta a sobra transparente em volta do traço
function recortar() {
  const { width: W, height: H } = tela, px = pincel.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const m = 6, w = x1 - x0 + 1 + 2 * m, h = y1 - y0 + 1 + 2 * m, c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(tela, x0 - m, y0 - m, w, h, 0, 0, w, h);
  return { url: c.toDataURL('image/png'), ratio: h / w };
}
function usarAss(s) {
  $('#dlg-ass').close();
  inserirImagem(s.url, s.ratio, 0.3, 0.55, 0.78);
  toast('Assinatura inserida: arraste até o lugar certo e use o ponto azul para o tamanho.');
}
function desenharSalvas() {
  const l = lerAss();
  $('#ass-salvas-tit').classList.toggle('hide', !l.length);
  $('#ass-salvas').replaceChildren(...l.map((s, k) => {
    const d = document.createElement('div');
    d.className = 's';
    d.innerHTML = '<button type="button" class="usa"><img alt="Assinatura guardada"></button><button type="button" class="x" aria-label="Apagar esta assinatura">✕</button>';
    d.querySelector('img').src = s.url;
    d.querySelector('.usa').onclick = () => usarAss(s);
    d.querySelector('.x').onclick = () => { l.splice(k, 1); gravarAss(l); desenharSalvas(); };
    return d;
  }));
}
$('#assinar').addEventListener('click', () => { limparTela(); desenharSalvas(); $('#dlg-ass').showModal(); });
$('#ass-usar').addEventListener('click', () => {
  if (!rabiscou) return toast('Desenhe a assinatura no quadro branco.', true);
  const s = recortar();
  if ($('#ass-guardar').checked) gravarAss([s, ...lerAss()]);
  usarAss(s);
});

/* ---------- salvar PDF ---------- */
$('#save').addEventListener('click', savePdf);
async function savePdf() {
  if (!st.doc) return;
  try {
    setBusy(true, 'Gerando PDF…');
    const { PDFDocument, StandardFonts, rgb, LineCapStyle, BlendMode, degrees } = PDFLib;
    const doc = await PDFDocument.load(await bytesAtuais());
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pgs = doc.getPages();
    const safe = (line) => [...line].map((ch) => { try { font.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
    const col = (hex) => { const [r, g, b] = hexToRgb01(hex); return rgb(r, g, b); };

    for (const a of st.anns) {
      const pg = pgs[a.page];
      // ponto da tela (topo-esquerda, página já girada) → ponto do PDF. Em página girada, o desenho gira junto (ang).
      const vp = st.pages[a.page].vp;
      const P = (x, y) => { const [px, py] = vp.convertToPdfPoint(x, y); return { x: px, y: py }; };
      const o = P(0, 0), e = P(1, 0);
      const rotate = degrees(Math.round((Math.atan2(e.y - o.y, e.x - o.x) * 180) / Math.PI));

      if (a.type === 'hl' || a.type === 'erase') {
        pg.drawRectangle({
          ...P(a.x, a.y + a.h), width: a.w, height: a.h, rotate,
          color: a.type === 'erase' ? rgb(1, 1, 1) : col(a.color),
          opacity: a.type === 'erase' ? 1 : 0.4,
          blendMode: a.type === 'hl' && BlendMode ? BlendMode.Multiply : undefined,
        });
      } else if (a.type === 'text') {
        a.text.split('\n').forEach((line, i) => {
          pg.drawText(safe(line), { ...P(a.x, a.y + i * a.size * 1.2 + a.size * 0.85), rotate, size: a.size, font, color: col(a.color) });
        });
      } else if (a.type === 'ink') {
        for (let i = 1; i < a.pts.length; i++) {
          pg.drawLine({
            start: P(a.pts[i - 1][0], a.pts[i - 1][1]), end: P(a.pts[i][0], a.pts[i][1]),
            thickness: a.width, color: col(a.color), lineCap: LineCapStyle.Round,
          });
        }
      } else if (a.type === 'img') {
        const img = await doc.embedPng(a.dataUrl);
        pg.drawImage(img, { ...P(a.x, a.y + a.h), width: a.w, height: a.h, rotate });
      }
    }
    const out = await doc.save();
    download(new Blob([out], { type: 'application/pdf' }), st.name + '-editado.pdf');
    st.dirty = false;
    toast('PDF salvo.');
  } catch (err) {
    console.error(err);
    toast('Não consegui gerar o PDF editado.', true);
  } finally {
    setBusy(false);
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------- PDF -> Word ---------- */
$('#toword').addEventListener('click', toWord);

const hexCor = (c) => Array.from(c || [0, 0, 0]).slice(0, 3).map((v) => (v | 0).toString(16).padStart(2, '0')).join('').toUpperCase();

// "ABCDEF+Arial-BoldMT" -> "Arial"; nomes internos sem família -> null (fica a fonte padrão)
function familia(nome) {
  if (!nome) return null;
  const base = nome.replace(/^[A-Z]{6}\+/, '').split(/[,-]/)[0].replace(/(PSMT|PS|MT)$/, '');
  if (/arial|helvetica/i.test(base)) return 'Arial';
  if (/times/i.test(base)) return 'Times New Roman';
  if (/courier/i.test(base)) return 'Courier New';
  if (/^g_|^f\d|^[A-Z]\d*$/.test(base) || base.length < 3) return null;
  return base.replace(/([a-z])([A-Z])/g, '$1 $2');
}

// Lê o conteúdo da página em coordenadas da tela (pontos, y para baixo): textos com estilo,
// retas (bordas de tabela), fundos coloridos, imagens e o resto do desenho vetorial.
async function lerPagina(page) {
  const O = pdfjsLib.OPS;
  const U = pdfjsLib.Util;
  const vp = page.getViewport({ scale: 1 });
  const [tc, ol] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const retas = [];
  const fundos = [];
  const caminhos = [];
  const imagens = [];
  let letras = '';
  const coresLetras = [];
  const clipLetras = [];
  let clip = null; // área visível (recorte do PDF), em coordenadas da página
  let ctm = vp.transform.slice();
  let fill = [0, 0, 0];
  let stroke = [0, 0, 0];
  let lw = 1;
  const pilha = [];
  let cam = null;

  const lerCaminho = (ops, c) => {
    const segs = [];
    const rets = [];
    let curva = false;
    let k = 0, x = 0, y = 0, x0 = 0, y0 = 0;
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    const P = (px, py) => {
      const q = U.applyTransform([px, py], ctm);
      bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]);
      return q;
    };
    for (const op of ops) {
      if (op === O.moveTo) { [x, y] = P(c[k], c[k + 1]); x0 = x; y0 = y; k += 2; }
      else if (op === O.lineTo) { const [nx, ny] = P(c[k], c[k + 1]); segs.push([x, y, nx, ny]); x = nx; y = ny; k += 2; }
      else if (op === O.curveTo) { P(c[k], c[k + 1]); P(c[k + 2], c[k + 3]); [x, y] = P(c[k + 4], c[k + 5]); curva = true; k += 6; }
      else if (op === O.curveTo2 || op === O.curveTo3) { P(c[k], c[k + 1]); [x, y] = P(c[k + 2], c[k + 3]); curva = true; k += 4; }
      else if (op === O.closePath) { if (x !== x0 || y !== y0) segs.push([x, y, x0, y0]); x = x0; y = y0; }
      else if (op === O.rectangle) {
        const a = P(c[k], c[k + 1]);
        const b = P(c[k] + c[k + 2], c[k + 1] + c[k + 3]);
        rets.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
        x = x0 = a[0]; y = y0 = a[1]; k += 4;
      }
    }
    return { segs, rets, curva, bb };
  };
  const hv = (s) => Math.abs(s[1] - s[3]) < 0.5 || Math.abs(s[0] - s[2]) < 0.5;
  const reta = (s, cor) => {
    if (Math.abs(s[1] - s[3]) < 0.5) retas.push({ h: true, p: (s[1] + s[3]) / 2, a: Math.min(s[0], s[2]), b: Math.max(s[0], s[2]), cor });
    else retas.push({ h: false, p: (s[0] + s[2]) / 2, a: Math.min(s[1], s[3]), b: Math.max(s[1], s[3]), cor });
  };
  const tracar = () => {
    const grossa = lw * Math.hypot(ctm[0], ctm[1]) > 4;
    const cor = hexCor(stroke);
    // contorno de uma forma escura preenchida (ex.: parede de planta) é desenho, não borda de tabela
    const solido = ([a, b, c, d]) => fundos.some((f) => f.escuro && Math.abs(f.x1 - a) < 1 && Math.abs(f.y1 - b) < 1 && Math.abs(f.x2 - c) < 1 && Math.abs(f.y2 - d) < 1);
    const rets = cam.rets.filter((r) => {
      if (!solido(r)) return true;
      caminhos.push({ x1: r[0], y1: r[1], x2: r[2], y2: r[3], t: 2 });
      return false;
    });
    const segs = cam.segs.concat(rets.flatMap(([a, b, c, d]) => [[a, b, c, b], [a, d, c, d], [a, b, a, d], [c, b, c, d]]));
    for (const s of segs) {
      const linha = hv(s);
      if (linha && !grossa) reta(s, cor);
      caminhos.push({ x1: s[0], y1: s[1], x2: s[2], y2: s[3], t: linha && !grossa ? 0 : 1 });
    }
    if (cam.curva) caminhos.push({ x1: cam.bb[0], y1: cam.bb[1], x2: cam.bb[2], y2: cam.bb[3], t: 3 });
  };
  const preencher = () => {
    const cor = hexCor(fill);
    const rets = cam.rets.slice();
    // polígono de até 4 lados retos também é um retângulo
    if (!cam.curva && cam.segs.length && cam.segs.length <= 5 && cam.segs.every(hv)) rets.push(cam.bb);
    else if (cam.curva || cam.segs.length) {
      if (cor !== 'FFFFFF') caminhos.push({ x1: cam.bb[0], y1: cam.bb[1], x2: cam.bb[2], y2: cam.bb[3], t: 3 });
    }
    for (const [x1, y1, x2, y2] of rets) {
      if (y2 - y1 <= 2.5 && x2 - x1 > 2.5) reta([x1, (y1 + y2) / 2, x2, (y1 + y2) / 2], cor);
      else if (x2 - x1 <= 2.5 && y2 - y1 > 2.5) reta([(x1 + x2) / 2, y1, (x1 + x2) / 2, y2], cor);
      else if (cor !== 'FFFFFF') {
        const f = Array.from(fill);
        fundos.push({ x1, y1, x2, y2, cor, escuro: f[0] * 0.3 + f[1] * 0.59 + f[2] * 0.11 < 110 });
        caminhos.push({ x1, y1, x2, y2, t: 2 });
      }
    }
  };

  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    const a = ol.argsArray[i];
    switch (fn) {
      case O.save: pilha.push([ctm, fill, stroke, lw, clip]); break;
      case O.restore: if (pilha.length) [ctm, fill, stroke, lw, clip] = pilha.pop(); break;
      case O.transform: ctm = U.transform(ctm, a); break;
      case O.paintFormXObjectBegin:
        pilha.push([ctm, fill, stroke, lw, clip]);
        if (a[0]) ctm = U.transform(ctm, a[0]);
        break;
      case O.paintFormXObjectEnd: if (pilha.length) [ctm, fill, stroke, lw, clip] = pilha.pop(); break;
      case O.setFillRGBColor: fill = a; break;
      case O.setStrokeRGBColor: stroke = a; break;
      case O.setLineWidth: lw = a[0]; break;
      case O.constructPath: cam = lerCaminho(a[0], a[1]); break;
      case O.stroke: case O.closeStroke:
        if (cam) tracar();
        cam = null;
        break;
      case O.fill: case O.eoFill:
        if (cam) preencher();
        cam = null;
        break;
      case O.fillStroke: case O.eoFillStroke: case O.closeFillStroke: case O.closeEOFillStroke:
        if (cam) { preencher(); tracar(); }
        cam = null;
        break;
      case O.clip: case O.eoClip:
        if (cam) clip = clip ? [Math.max(clip[0], cam.bb[0]), Math.max(clip[1], cam.bb[1]), Math.min(clip[2], cam.bb[2]), Math.min(clip[3], cam.bb[3])] : cam.bb;
        break;
      case O.endPath: cam = null; break;
      case O.paintImageXObject: imagens.push({ id: a[0], m: ctm }); break;
      case O.paintInlineImageXObject: imagens.push({ dados: a[0], m: ctm }); break;
      case O.showText:
        for (const g of a[0]) {
          if (!g || typeof g !== 'object' || !g.unicode) continue;
          for (const ch of g.unicode.replace(/\s/g, '')) { letras += ch; coresLetras.push(fill); clipLetras.push(clip); }
        }
        break;
    }
  }

  // estilo de cada pedaço de texto: fonte pelo nome; cor achada na sequência de letras desenhadas
  const fontes = {};
  const fonte = (id) => {
    if (!(id in fontes)) {
      let f = null;
      try { f = page.commonObjs.get(id); } catch (e) { /* fonte ainda não carregada */ }
      const nome = (f && f.name) || '';
      fontes[id] = {
        bold: !!(f && (f.bold || f.black)) || /bold|black|heavy|semibold|demi/i.test(nome),
        italic: !!(f && f.italic) || /italic|oblique/i.test(nome),
        fonte: familia(nome),
      };
    }
    return fontes[id];
  };
  const itens = [];
  let k = 0;
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const m = U.transform(vp.transform, it.transform);
    const size = Math.hypot(m[2], m[3]) || it.height || 10;
    const s = it.str.replace(/\s/g, '');
    let cor = null;
    let pos = letras.startsWith(s, k) ? k : letras.indexOf(s, k);
    if (pos >= 0 && pos - k > 400) pos = -1;
    if (pos >= 0) {
      cor = hexCor(coresLetras[pos]);
      const cl = clipLetras[pos];
      // texto escondido pelo recorte do PDF (ex.: continuação cortada de uma caixa) não entra
      if (cl && (m[4] + Math.min(it.width, size) / 2 < cl[0] - 1 || m[4] > cl[2] + 1 || m[5] - size * 0.3 < cl[1] - 1 || m[5] - size * 0.3 > cl[3] + 1)) { k = pos + s.length; continue; }
      k = pos + s.length;
    }
    itens.push({ str: it.str, x: m[4], y: m[5], w: it.width, size, cor: cor === '000000' ? null : cor, ...fonte(it.fontName) });
  }
  // texto branco só aparece sobre fundo colorido; no papel branco ele é invisível e não entra
  const visiveis = itens.filter((it) => {
    if (it.cor !== 'FFFFFF') return true;
    const x = it.x + Math.min(it.w, it.size) / 2;
    const y = it.y - it.size * 0.3;
    return fundos.some((f) => x >= f.x1 && x <= f.x2 && y >= f.y1 && y <= f.y2);
  });

  // posição de cada imagem: o quadrado unitário da imagem levado para a página
  for (const im of imagens) {
    const cs = [[0, 0], [1, 0], [0, 1], [1, 1]].map((p) => U.applyTransform(p, im.m));
    const x1 = Math.min(...cs.map((p) => p[0]));
    const y1 = Math.min(...cs.map((p) => p[1]));
    im.caixa = { x: x1, y: y1, w: Math.max(...cs.map((p) => p[0])) - x1, h: Math.max(...cs.map((p) => p[1])) - y1 };
  }
  return {
    w: vp.width, h: vp.height, itens: visiveis, retas, fundos, caminhos,
    imagens: imagens.filter((im) => im.caixa.w >= 4 && im.caixa.h >= 4),
  };
}

// Desenha a imagem do PDF num canvas, já na posição em que aparece (girada/espelhada como no PDF)
async function desenharImagem(page, im) {
  let obj = im.dados;
  if (!obj) {
    try { obj = (im.id.startsWith('g_') ? page.commonObjs : page.objs).get(im.id); } catch (e) { return null; }
  }
  if (!obj || !obj.width || !obj.height) return null;
  let src = obj.bitmap;
  if (!src) {
    if (!obj.data) return null;
    const { width: W, height: H, data, kind } = obj;
    const out = new ImageData(W, H);
    const d = out.data;
    if (kind === 3) d.set(data.subarray(0, d.length));
    else if (kind === 2) for (let p = 0, q = 0; q < d.length; p += 3, q += 4) { d[q] = data[p]; d[q + 1] = data[p + 1]; d[q + 2] = data[p + 2]; d[q + 3] = 255; }
    else if (kind === 1) {
      const linha = (W + 7) >> 3;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = data[y * linha + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
        const q = (y * W + x) * 4;
        d[q] = d[q + 1] = d[q + 2] = v; d[q + 3] = 255;
      }
    } else return null;
    src = document.createElement('canvas');
    src.width = W; src.height = H;
    src.getContext('2d').putImageData(out, 0, 0);
  }
  const { x, y, w, h } = im.caixa;
  const s = Math.min(Math.max(obj.width / w, obj.height / h, 1), 3, 2000 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  const U = pdfjsLib.Util;
  // pixel da imagem -> quadrado unitário -> página -> canvas
  const t = U.transform(U.transform([s, 0, 0, s, -x * s, -y * s], im.m), [1 / obj.width, 0, 0, -1 / obj.height, 0, 1]);
  ctx.setTransform(...t);
  ctx.drawImage(src, 0, 0);
  return c;
}

// Renderiza a página uma vez e recorta as regiões de desenho
async function recortes(page, regs) {
  const vp1 = page.getViewport({ scale: 1 });
  const esc = Math.min(2, 2600 / Math.max(vp1.width, vp1.height));
  const vp = page.getViewport({ scale: esc });
  const full = document.createElement('canvas');
  full.width = Math.round(vp.width);
  full.height = Math.round(vp.height);
  const fctx = full.getContext('2d');
  fctx.fillStyle = '#fff';
  fctx.fillRect(0, 0, full.width, full.height);
  await page.render({ canvasContext: fctx, viewport: vp }).promise;
  const out = regs.map((g) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((g.x2 - g.x1) * esc));
    c.height = Math.max(1, Math.round((g.y2 - g.y1) * esc));
    c.getContext('2d').drawImage(full, -g.x1 * esc, -g.y1 * esc);
    return [g, c];
  });
  full.width = 0;
  return out;
}
async function toWord() {
  if (!st.doc) return;
  try {
    setBusy(true, 'Convertendo para Word…');
    const prog = $('#prog');
    const zip = new JSZip();
    const midias = [];
    // guarda a imagem no .docx e devolve o id que o documento usa para apontar para ela
    const guardar = async (canvas, nitido = false) => {
      const png = nitido || canvas.width * canvas.height < 400000;
      const blob = await new Promise((res) => canvas.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.85));
      const n = midias.length + 1;
      const m = { rid: 'rIdImg' + n, arquivo: `imagem${n}.${png ? 'png' : 'jpeg'}` };
      zip.file('word/media/' + m.arquivo, blob);
      midias.push(m);
      return m.rid;
    };
    const pages = [];
    let chars = 0;
    let nTabelas = 0;
    for (let i = 0; i < st.pages.length; i++) {
      const page = st.pages[i].page;
      const lido = await lerPagina(page);
      const { w: W, h: H } = lido;

      // a imagem só é extraída depois, se não ficar dentro de um desenho (que já vira imagem inteiro)
      const imagens = lido.imagens.map((im) => ({ ...im.caixa, orig: im }));

      const r = PdfWord.tabelasDaPagina({ retas: lido.retas.length > 4000 ? [] : lido.retas, fundos: lido.fundos, itens: lido.itens, imagens });
      const dentroDe = (t, x, y) => x >= t.x1 - 2 && x <= t.x2 + 2 && y >= t.y1 - 2 && y <= t.y2 + 2;
      // tabela com muitos traços dentro das células (ex.: formas de dobra do aço) não cabe numa tabela
      // do Word: a área inteira vira imagem para o desenho não se perder
      const tabelasDesenho = r.tabelas.filter((t) => {
        const naBorda = (q) => t.cels.some((c) => (q.h
          ? (Math.abs(q.p - c.y1) < 3 || Math.abs(q.p - c.y2) < 3) && q.a < c.x2 && q.b > c.x1
          : (Math.abs(q.p - c.x1) < 3 || Math.abs(q.p - c.x2) < 3) && q.a < c.y2 && q.b > c.y1));
        const dentro = lido.retas.filter((q) => (q.h ? dentroDe(t, (q.a + q.b) / 2, q.p) : dentroDe(t, q.p, (q.a + q.b) / 2)));
        const tracos = dentro.filter((q) => !naBorda(q)).length +
          lido.caminhos.filter((c) => (c.t === 1 || c.t === 3) && dentroDe(t, (c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2)).length;
        // grade quase toda vazia (malha de elevação, gráfico) também é desenho
        const comTexto = t.cels.filter((c) => c.items.length || c.imgs.length).length;
        return (tracos >= 12 && tracos >= dentro.length * 0.2) || (t.cels.length >= 20 && comTexto < t.cels.length * 0.15);
      });
      r.tabelas = r.tabelas.filter((t) => !tabelasDesenho.includes(t));
      nTabelas += r.tabelas.length;

      // desenhos vetoriais (fora das tabelas) entram como imagem, com os textos que estão neles
      const naTabela = (x, y) => r.tabelas.concat(tabelasDesenho).some((t) => dentroDe(t, x, y));
      const caminhos = lido.caminhos.filter((c) => !naTabela((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2));
      const regs = PdfWord.regioesDeDesenho(caminhos, W, H).concat(tabelasDesenho.map((t) => ({ x1: t.x1 - 1, y1: t.y1 - 1, x2: t.x2 + 1, y2: t.y2 + 1 })));
      // rótulos colados no desenho (cotas, nomes de eixos) vão junto na imagem
      for (let passo = 0; passo < 2; passo++) {
        for (const g of regs) {
          for (const it of r.itens) {
            const x1 = it.x, x2 = it.x + it.w, y1 = it.y - it.size, y2 = it.y + it.size * 0.25;
            const d = 15;
            if (x2 > g.x1 - d && x1 < g.x2 + d && y2 > g.y1 - d && y1 < g.y2 + d && x2 - x1 < (g.x2 - g.x1) * 0.8) {
              g.x1 = Math.max(0, Math.min(g.x1, x1 - 2)); g.x2 = Math.min(W, Math.max(g.x2, x2 + 2));
              g.y1 = Math.max(0, Math.min(g.y1, y1 - 2)); g.y2 = Math.min(H, Math.max(g.y2, y2 + 2));
            }
          }
        }
      }
      // regiões que passaram a se sobrepor viram uma imagem só
      for (let a = 0; a < regs.length; a++) {
        for (let b = a + 1; b < regs.length; b++) {
          const p = regs[a], q = regs[b];
          if (p.x1 < q.x2 && q.x1 < p.x2 && p.y1 < q.y2 && q.y1 < p.y2) {
            regs[a] = { x1: Math.min(p.x1, q.x1), y1: Math.min(p.y1, q.y1), x2: Math.max(p.x2, q.x2), y2: Math.max(p.y2, q.y2) };
            regs.splice(b, 1);
            b = a;
          }
        }
      }
      const noDesenho = (x, y) => regs.some((g) => x >= g.x1 && x <= g.x2 && y >= g.y1 && y <= g.y2);
      let itens = r.itens.filter((it) => !noDesenho(it.x + it.w / 2, it.y - it.size * 0.3));
      const imgs = r.imagens.filter((im) => !noDesenho(im.x + im.w / 2, im.y + im.h / 2));
      const usadas = imgs.concat(r.tabelas.flatMap((t) => t.linhas.flatMap((l) => l.partes.flatMap((p) => p.linhas.filter((x) => x.img).map((x) => x.img)))));
      for (const im of usadas) {
        const c = await desenharImagem(page, im.orig);
        if (c) im.rid = await guardar(c);
      }
      if (regs.length) {
        for (const [g, c] of await recortes(page, regs)) imgs.push({ x: g.x1, y: g.y1, w: g.x2 - g.x1, h: g.y2 - g.y1, rid: await guardar(c, true) });
      }

      // texto alinhado em colunas, sem linhas desenhadas, também vira tabela (sem bordas)
      const sb = PdfWord.tabelasSemBorda(PdfWord.montarLinhas(itens));
      nTabelas += sb.tabelas.length;
      chars += lido.itens.reduce((n, it) => n + it.str.trim().length, 0);
      pages.push({ w: W, h: H, linhas: sb.linhas, tabelas: r.tabelas.concat(sb.tabelas), imagens: imgs });
      prog.value = Math.round(((i + 1) / st.pages.length) * 100);
    }
    if (chars < 20 && !midias.length) {
      return toast('Este PDF parece ser uma imagem escaneada, sem texto selecionável. Seria preciso OCR.', true);
    }
    zip.file('[Content_Types].xml', PdfWord.CONTENT_TYPES);
    zip.file('_rels/.rels', PdfWord.ROOT_RELS);
    zip.file('word/document.xml', PdfWord.documentXml(pages));
    zip.file('word/styles.xml', PdfWord.STYLES);
    zip.file('word/_rels/document.xml.rels', PdfWord.relsXml(midias));
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    download(blob, st.name + '.docx');
    const partes = [nTabelas && `${nTabelas} tabela${nTabelas > 1 ? 's' : ''}`, midias.length && `${midias.length} ${midias.length > 1 ? 'imagens' : 'imagem'}`].filter(Boolean);
    toast('Word gerado' + (partes.length ? ` com ${partes.join(' e ')}.` : '.') + (chars < 20 ? ' O texto de páginas escaneadas não é editável (precisaria de OCR).' : ''));
  } catch (err) {
    console.error(err);
    toast('Não consegui converter este PDF.', true);
  } finally {
    setBusy(false);
  }
}

// dentro de outro app (iframe): trocar de página sem empilhar no histórico, para o Voltar do celular fechar as ferramentas
if (window !== window.top) document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (a && a.origin === location.origin && !a.target && !a.hasAttribute('download')) { e.preventDefault(); location.replace(a.href); }
});

// o app que abriu as ferramentas (ex.: WIGO) pergunta antes de fechar se há edição não salva
window.temAlteracoes = () => st.dirty;
window.addEventListener('beforeunload', (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('../sw.js').catch((e) => console.warn('SW não registrado', e));
}
updateUI();
