// Calculadora de obra: monta a tela de cada calculadora (calcs.js) e cuida do histórico, PDF, WhatsApp e do envio ao Arquivo da obra (Wigo).
'use strict';

const $ = F.$;
const CHAVE_HIST = 'obra-historico', CHAVE_OBRAS = 'obra-obras', CHAVE_FILA = 'ferr-arquivo-fila';
const OBRAS_PADRAO = ['Estação de Tratamento', 'Alto Recalque', 'Baixo Recalque / Captação'];
const lerLS = (k, p) => { try { return JSON.parse(localStorage.getItem(k)) ?? p; } catch (e) { return p; } };
const gravarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { F.toast('Não consegui guardar no aparelho (memória cheia?).', true); return false; } };
const el = (tag, at = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(at)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f);
  return e;
};
const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const agoraHM = () => new Date().toTimeString().slice(0, 5);
const lerNum = (s) => { const t = String(s ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); if (!t) return undefined; const n = Number(t); return Number.isFinite(n) ? n : undefined; };
const fmtIn = (n) => (n == null || !Number.isFinite(n) ? '' : String(Math.round(n * 1e6) / 1e6).replace('.', ','));
const valF = (x, v) => (typeof x === 'function' ? x(v) : x);
const obras = () => lerLS(CHAVE_OBRAS, OBRAS_PADRAO);

// ---------- rotas: #  (início)  ·  #<calc>  ·  #<calc>/<id do histórico> ----------
let calc = null, v = {}, histId = null, res = null, campos = [];
window.addEventListener('hashchange', rota);
function rota() {
  const [id, h] = location.hash.slice(1).split('/');
  // #abrir: o Wigo (Arquivo da obra) mandou um cálculo para abrir de novo aqui
  if (id === 'abrir') {
    const x = lerLS('obra-abrir', null);
    try { localStorage.removeItem('obra-abrir'); } catch (e) { /* segue */ }
    if (x?.calc && x.v && x.id) {
      const hist = lerLS(CHAVE_HIST, []).filter((y) => y.id !== x.id);
      hist.unshift({ id: x.id, calc: x.calc, quando: new Date().toISOString(), v: x.v, destaque: x.destaque || '', titulo: x.titulo || '', obra: x.v.obra || '', arquivado: true });
      gravarLS(CHAVE_HIST, hist.slice(0, 300));
      return location.replace(`#${x.calc}/${x.id}`);
    }
    return location.replace('#');
  }
  calc = CALCS.find((c) => c.id === id) || null;
  window.scrollTo(0, 0);
  if (!calc) return inicio();
  const item = h && lerLS(CHAVE_HIST, []).find((x) => x.id === h);
  abrirCalc(item);
}

// ---------- início ----------
function inicio() {
  document.title = 'Calculadora de obra';
  $('#titulo').textContent = 'Calculadora de obra';
  $('#voltar').href = '../?g=obra'; $('#voltar').textContent = '‹ Obra';
  $('#barra').hidden = true;
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'sub', text: 'Escolha o cálculo. Os resultados ficam guardados neste celular e podem ir para o Arquivo da obra no Wigo.' }));
  for (const g of [...new Set(CALCS.map((c) => c.grupo))]) {
    main.append(el('h2', { class: 'grupo-tit', text: g }),
      el('div', { class: 'calcs' }, ...CALCS.filter((c) => c.grupo === g).map((c) => el('a', { class: 'calc', href: '#' + c.id, html: (Des.capas[c.id] || (() => ''))() }, el('b', { text: c.nome }), el('small', { text: c.desc })))));
  }
  const hist = lerLS(CHAVE_HIST, []).slice(0, 8);
  if (hist.length) main.append(el('h2', { class: 'grupo-tit', text: 'Últimos cálculos' }), listaHist(hist, true));
}
function listaHist(hist, comNome) {
  return el('ul', { class: 'lista hist' }, ...hist.map((h) => {
    const c = CALCS.find((x) => x.id === h.calc);
    const li = el('li', { class: 'item', tabindex: 0 }, el('span', { class: 'nm' }, el('b', { text: (comNome ? c?.nome + ': ' : '') + h.destaque }),
      el('small', { text: [new Date(h.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }), h.titulo, h.obra, h.arquivado ? '✓ no Arquivo da obra' : ''].filter(Boolean).join(' · ') })));
    const abrir = () => { location.hash = `${h.calc}/${h.id}`; };
    li.onclick = abrir; li.onkeydown = (e) => { if (e.key === 'Enter') abrir(); };
    return li;
  }));
}

// ---------- tela da calculadora ----------
function valoresIniciais() {
  const x = {};
  for (const f of calc.campos) {
    if (f.padrao != null) x[f.k] = valF(f.padrao, x);
    if (f.t === 'data') x[f.k] = hojeISO();
    if (f.t === 'hora') x[f.k] = agoraHM();
    if (f.t === 'obra') x[f.k] = lerLS('obra-ultima', '') || '';
    if (f.t === 'lista') x[f.k] = f.min ? [Object.fromEntries(f.campos.filter((s) => s.padrao != null).map((s) => [s.k, s.padrao]))] : [];
  }
  // padrões que dependem das escolhas (medidas do caminhão, massa do material…)
  for (const f of calc.campos) if (f.t === 'escolha' || f.t === 'sel') calc.ao?.(x, f.k);
  return x;
}
function abrirCalc(item) {
  document.title = calc.nome + ' · Calculadora de obra';
  $('#titulo').textContent = calc.nome;
  $('#voltar').href = '#'; $('#voltar').textContent = '‹ Calculadora';
  v = item ? JSON.parse(JSON.stringify(item.v)) : valoresIniciais();
  histId = item ? item.id : null;
  campos = [];
  const main = $('#main'), form = el('form', { class: 'card', novalidate: true, onsubmit: (e) => e.preventDefault() });
  main.replaceChildren(el('p', { class: 'sub', text: calc.desc }), form);
  let grupo = null;
  for (const f of calc.campos) {
    if (f.grupo && f.grupo !== grupo) { grupo = f.grupo; form.append(el('h2', { class: 'secao', text: grupo })); }
    const caixa = el('div', { class: 'campo-caixa' });
    form.append(caixa);
    campos.push({ f, caixa, montar: () => montarCampo(f, caixa) });
  }
  campos.forEach((c) => c.montar());
  main.append(el('section', { class: 'card', id: 'res', 'aria-live': 'polite' }));
  const hist = lerLS(CHAVE_HIST, []).filter((h) => h.calc === calc.id).slice(0, 15);
  if (hist.length) main.append(el('h2', { class: 'grupo-tit', text: 'Cálculos guardados' }), listaHist(hist, false));
  $('#barra').hidden = false;
  atualizar();
}

// cada campo é montado de novo quando muda algo que altera a forma dele (lista, pontos, opções)
function montarCampo(f, caixa) {
  const rot = valF(f.rot, v), un = valF(f.un, v);
  const ao = () => { calc.ao?.(v, f.k); sincronizar(f.k); atualizar(); };
  let corpo;
  if (f.t === 'escolha') {
    corpo = el('div', { class: 'escolhas' + (f.semDesenho ? ' sem-des' : ''), role: 'radiogroup', 'aria-label': rot },
      ...f.ops.map((o) => el('button', { type: 'button', class: 'op', role: 'radio', 'aria-checked': String(v[f.k] === o.id), 'data-id': o.id, html: f.semDesenho ? '' : o.des(),
        onclick: () => { v[f.k] = o.id; caixa.querySelectorAll('.op').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === o.id))); ao(); } },
      el('b', { text: o.nome }), o.sub ? el('small', { text: o.sub }) : null)));
    caixa.replaceChildren(el('div', { class: 'campo' }, el('span', { text: rot }), corpo));
    return;
  }
  if (f.t === 'pontos') {
    const n = +v.npontos || 5, p = (v.p ||= []), des = el('div', { html: Des.pontos(n) });
    const grade = el('div', { class: 'grade' }, ...Array.from({ length: n }, (_, i) => el('label', {}, `P${i + 1} (${un})`,
      el('input', { inputmode: 'decimal', autocomplete: 'off', value: fmtIn(p[i]), 'data-i': i, 'aria-label': `Medida no ponto ${i + 1} em ${un}`,
        onfocus: () => { des.innerHTML = Des.pontos(n, i); }, oninput: (e) => { p[i] = lerNum(e.target.value); atualizar(); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); caixa.querySelector(`[data-i="${i + 1}"]`)?.focus(); } } }))));
    caixa.replaceChildren(el('div', { class: 'pontos campo' }, el('span', { text: v.modo === 'vazio' ? 'Meça da borda da caçamba até o material em cada ponto (cm):' : 'Meça do fundo da caçamba até o topo do material em cada ponto (cm):' }), des, grade));
    caixa.dataset.n = n + v.modo;
    return;
  }
  if (f.t === 'lista') {
    const linhas = (v[f.k] ||= []);
    const lin = (r, i) => el('div', { class: 'lin', style: `--n:${f.campos.length}` }, ...f.campos.map((s) => el('label', {}, s.rot + (s.un ? ` (${s.un})` : ''),
      s.t === 'sel' ? el('select', { onchange: (e) => { r[s.k] = e.target.value; atualizar(); } }, ...s.ops.map(([val, t]) => el('option', { value: val, text: t, selected: String(r[s.k] ?? s.padrao) === val })))
        : el('input', { inputmode: 'decimal', autocomplete: 'off', value: fmtIn(r[s.k]), oninput: (e) => { r[s.k] = lerNum(e.target.value); atualizar(); } }))),
      el('button', { type: 'button', class: 'mini', 'aria-label': 'Remover linha', text: '✕', disabled: f.min && linhas.length <= f.min, onclick: () => { linhas.splice(i, 1); montarCampo(f, caixa); atualizar(); } }));
    caixa.replaceChildren(el('div', { class: 'campo' }, el('span', { text: rot }), ...linhas.map(lin),
      el('button', { type: 'button', text: f.novo || '+ Linha', onclick: () => { linhas.push(Object.fromEntries(f.campos.filter((s) => s.padrao != null).map((s) => [s.k, s.padrao]))); montarCampo(f, caixa); caixa.querySelector('.lin:last-of-type input')?.focus(); } })));
    return;
  }
  let inp;
  if (f.t === 'sel') {
    const ops = valF(f.ops, v);
    inp = el('select', { onchange: (e) => { v[f.k] = e.target.value; ao(); } }, ...ops.map(([val, t]) => el('option', { value: val, text: t, selected: String(v[f.k]) === val })));
    caixa.dataset.ops = JSON.stringify(ops);
  } else if (f.t === 'obra') {
    inp = el('select', { onchange: (e) => {
      if (e.target.value === '__nova') {
        const n = (prompt('Nome da obra / empreendimento:') || '').trim();
        if (n) { gravarLS(CHAVE_OBRAS, [...new Set([...obras(), n])]); v[f.k] = n; } montarCampo(f, caixa);
      } else v[f.k] = e.target.value;
      gravarLS('obra-ultima', v[f.k] || ''); atualizar();
    } }, el('option', { value: '', text: '— escolha —' }), ...obras().map((o) => el('option', { value: o, text: o, selected: v[f.k] === o })), el('option', { value: '__nova', text: '+ Outra obra…' }));
  } else if (f.t === 'data' || f.t === 'hora') {
    inp = el('input', { type: f.t === 'data' ? 'date' : 'time', value: v[f.k] || '', oninput: (e) => { v[f.k] = e.target.value; atualizar(); } });
  } else if (f.t === 'txt') {
    const lembrados = f.lembrar ? lerLS('obra-lembrar-' + f.k, []) : [];
    inp = el('input', { type: 'text', value: v[f.k] || '', maxlength: f.maxlen || 120, autocomplete: 'off', list: lembrados.length ? 'dl-' + f.k : null,
      oninput: (e) => { v[f.k] = f.maiusc ? e.target.value.toUpperCase() : e.target.value; if (f.maiusc) e.target.value = v[f.k]; atualizar(); },
      onchange: () => ao() });
    if (lembrados.length) caixa.append(el('datalist', { id: 'dl-' + f.k }, ...lembrados.map((x) => el('option', { value: x }))));
  } else {
    inp = el('input', { inputmode: 'decimal', autocomplete: 'off', value: fmtIn(v[f.k]), 'data-k': f.k, oninput: (e) => { v[f.k] = lerNum(e.target.value); atualizar(); }, onchange: () => ao() });
  }
  const dl = caixa.querySelector('datalist');
  caixa.replaceChildren(...(f.des ? [el('div', { class: 'des-campo', html: f.des() })] : []),
    el('label', { class: 'campo' }, el('span', { class: 'rot', text: rot }), el('span', { class: 'campo-in' }, inp, un ? el('span', { class: 'un', text: un }) : null),
      f.dica ? el('span', { class: 'dica', text: f.dica }) : null), ...(dl ? [dl] : []));
}

// valores mudados por calc.ao (ex.: medidas do caminhão) voltam para os campos
function sincronizar(origem) {
  for (const { f, caixa } of campos) {
    if (f.k === origem) continue;
    if (f.t === 'escolha') caixa.querySelectorAll('.op').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === v[f.k])));
    else if (f.t === 'num') { const i = caixa.querySelector('input'); if (i && document.activeElement !== i && lerNum(i.value) !== v[f.k]) i.value = fmtIn(v[f.k]); }
    else if (f.t === 'txt' || f.t === 'sel') { const i = caixa.querySelector('input,select'); if (i && document.activeElement !== i && i.value !== String(v[f.k] ?? '')) i.value = v[f.k] ?? ''; }
  }
}

function atualizar() {
  // visibilidade, rótulos e unidades que dependem de outros campos
  for (const c of campos) {
    const { f, caixa } = c;
    caixa.hidden = !!(f.mostrar && !f.mostrar(v));
    if (f.t === 'pontos' && caixa.dataset.n !== (+v.npontos || 5) + v.modo) c.montar();
    if (f.t === 'sel' && typeof f.ops === 'function' && caixa.dataset.ops !== JSON.stringify(f.ops(v))) { if (!f.ops(v).some(([x]) => x === v[f.k])) v[f.k] = f.ops(v)[0][0]; c.montar(); }
    if (typeof f.rot === 'function') { const r = caixa.querySelector('.rot'); if (r) r.textContent = f.rot(v); }
    if (typeof f.un === 'function') { const u = caixa.querySelector('.un'); if (u) u.textContent = f.un(v); }
  }
  // títulos de seção sem nenhum campo visível somem
  document.querySelectorAll('.secao').forEach((h) => { let x = h.nextElementSibling, vis = false; while (x && !x.classList.contains('secao')) { if (!x.hidden) vis = true; x = x.nextElementSibling; } h.hidden = !vis; });
  try { res = calc.calcular(v); } catch (e) { console.error(e); res = { erro: 'Confira os valores digitados.' }; }
  mostrarResultado();
}

function mostrarResultado() {
  const box = $('#res');
  $('#barra-dest').textContent = res.erro ? '—' : res.destaque;
  if (res.erro) { box.replaceChildren(el('h2', { text: 'Resultado' }), el('p', { class: 'erro', text: res.erro })); return; }
  const linhas = (rs) => el('table', { class: 'tab' }, el('tbody', {}, ...rs.map(([a, b]) => el('tr', {}, el('th', { text: a }), el('td', { text: b })))));
  box.replaceChildren(...[
    el('h2', { text: 'Resultado' }),
    el('div', {}, el('div', { class: 'dest', text: res.destaque }), res.sub ? el('div', { class: 'sub2', text: res.sub }) : null),
    res.situacao ? el('div', {}, el('span', { class: 'chip ' + res.situacao[1], text: res.situacao[0] })) : null,
    res.avisos?.length ? el('ul', { class: 'avisos' }, ...res.avisos.map((a) => el('li', { text: a }))) : null,
    linhas(res.resumo),
    res.tabela ? el('table', { class: 'tab grade' }, el('thead', {}, el('tr', {}, ...res.tabela.cab.map((c) => el('th', { text: c })))), el('tbody', {}, ...res.tabela.linhas.map((l) => el('tr', {}, ...l.map((c) => el('td', { text: c })))))) : null,
    el('div', { class: 'acoes' },
      res.semArquivo ? null : el('button', { type: 'button', class: 'pri', text: '🗂 Guardar no Arquivo da obra', onclick: (e) => guardarArquivo(e.target) }),
      el('button', { type: 'button', text: '📄 PDF', onclick: (e) => F.trabalhando(e.target, gerarPdf) }),
      el('button', { type: 'button', text: '💬 WhatsApp', onclick: whatsapp }),
      el('button', { type: 'button', text: histId ? '💾 Salvar alterações' : '💾 Salvar no celular', onclick: () => { salvar(); F.toast('Cálculo guardado neste celular.'); } }),
      el('button', { type: 'button', text: '＋ Novo cálculo', onclick: () => { if (location.hash === '#' + calc.id) rota(); else location.hash = calc.id; } }))].filter(Boolean));
}
$('#barra-ir').onclick = () => $('#res')?.scrollIntoView({ behavior: 'smooth' });

// ---------- histórico (neste celular) ----------
function salvar(extra = {}) {
  if (res.erro) return null;
  const hist = lerLS(CHAVE_HIST, []), i = hist.findIndex((h) => h.id === histId);
  const item = { ...(i >= 0 ? hist[i] : {}), id: histId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6), calc: calc.id, quando: new Date().toISOString(),
    v: JSON.parse(JSON.stringify(v)), destaque: res.destaque, titulo: res.arquivo?.titulo || '', obra: v.obra || '', ...extra };
  if (i >= 0) hist.splice(i, 1);
  hist.unshift(item);
  gravarLS(CHAVE_HIST, hist.slice(0, 300));
  if (!histId) { histId = item.id; history.replaceState(null, '', `#${calc.id}/${histId}`); }
  if (calc.id === 'cubicagem') lembrarCacamba(v);
  for (const f of calc.campos) if (f.lembrar && v[f.k]) gravarLS('obra-lembrar-' + f.k, [...new Set([v[f.k], ...lerLS('obra-lembrar-' + f.k, [])])].slice(0, 30));
  return item;
}

// ---------- Arquivo da obra (Wigo) ----------
// O registro vai para uma fila no aparelho (mesmo endereço do Wigo). Dentro do Wigo, ele pega na hora;
// fora dele, pega na próxima vez que o Wigo for aberto neste celular e envia para a planilha.
function guardarArquivo(btn) {
  if (res.erro) return;
  if (!v.obra && calc.campos.some((f) => f.t === 'obra') && !confirm('Nenhuma obra escolhida. Guardar assim mesmo?')) return;
  const item = salvar({ arquivado: true });
  const reg = { id: 'calc-' + item.id, tipo: res.arquivo.tipo, data: res.arquivo.data || hojeISO(), status: res.situacao ? (res.situacao[1] === 'ok' ? 'Conforme' : 'Divergente') : 'Arquivado',
    dados: { calc: calc.id, calcNome: calc.nome, titulo: res.arquivo.titulo, obra: v.obra || '', material: res.arquivo.material || '', destaque: res.destaque, sub: res.sub || '',
      valor: Math.round((res.arquivo.valor || 0) * 1000) / 1000, unidade: res.arquivo.unidade || '', situacao: res.situacao?.[0] || '', resumo: res.resumo, tabela: res.tabela || null, avisos: res.avisos || [], v, hora: v.hora || '' } };
  const fila = lerLS(CHAVE_FILA, []).filter((r) => r.id !== reg.id);
  fila.push(reg);
  if (!gravarLS(CHAVE_FILA, fila)) return;
  let noWigo = false;
  try { noWigo = window.parent !== window && typeof window.parent.wigoArquivo === 'function' && window.parent.wigoArquivo() > 0; } catch (e) { /* fora do Wigo */ }
  F.toast(noWigo ? 'Guardado no Arquivo da obra. O Wigo envia para a planilha na próxima sincronização.' : 'Guardado. Vai para o Arquivo da obra quando você abrir o Wigo neste celular.');
  btn.textContent = '✓ No Arquivo da obra';
}

// ---------- WhatsApp e PDF ----------
function whatsapp() {
  if (res.erro) return;
  salvar();
  const t = [`*${calc.nome}*`, res.arquivo?.titulo, `*${res.destaque}*${res.situacao ? ' · ' + res.situacao[0] : ''}`, '', ...res.resumo.map(([a, b]) => `• ${a}: ${b}`)].filter((x) => x != null).join('\n');
  window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank', 'noopener');
}

const LIB_PDF = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
const carregarPdfLib = () => (window.PDFLib ? Promise.resolve() : new Promise((ok, erro) => {
  const s = el('script', { src: LIB_PDF, crossorigin: 'anonymous' }); s.onload = ok; s.onerror = () => erro(new Error('Não consegui baixar o gerador de PDF. Verifique a internet.')); document.head.append(s);
}));
// Helvetica do PDF só tem os caracteres do Windows-1252
const ansi = (s) => String(s ?? '').replace(/[≈]/g, '~').replace(/[↔→]/g, '-').replace(/[−–—]/g, '-').replace(/[✓]/g, 'OK').replace(/[^\x20-\x7E\xA0-\xFF€•…“”‘’]/g, '?');

async function gerarPdf(prog) {
  if (res.erro) throw new Error(res.erro);
  salvar();
  prog('Gerando PDF…');
  await carregarPdfLib();
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`${calc.nome} - ${res.arquivo?.titulo || ''}`); doc.setProducer('WiApps Ferramentas');
  const fn = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 36, marrom = rgb(0.71, 0.4, 0.11), cinza = rgb(0.4, 0.4, 0.4);
  let pg = doc.addPage([W, H]), y = H;
  const nova = () => { pg = doc.addPage([W, H]); y = H - M; };
  const quebra = (t, f, tam, larg) => {
    const out = []; let lin = '';
    for (const p of ansi(t).split(' ')) { const tt = lin ? lin + ' ' + p : p; if (f.widthOfTextAtSize(tt, tam) > larg && lin) { out.push(lin); lin = p; } else lin = tt; }
    return lin ? [...out, lin] : out;
  };
  pg.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: marrom });
  pg.drawText(ansi(calc.nome), { x: M, y: H - 32, size: 18, font: fb, color: rgb(1, 1, 1) });
  pg.drawText(ansi([res.arquivo?.titulo, v.obra].filter(Boolean).join(' · ')), { x: M, y: H - 50, size: 10.5, font: fn, color: rgb(1, 1, 1) });
  pg.drawText(ansi('Gerado em ' + new Date().toLocaleString('pt-BR')), { x: M, y: H - 63, size: 8, font: fn, color: rgb(1, 1, 1) });
  y = H - 92;
  // desenhos do que foi escolhido
  const des = (res.desenhos || []).slice(0, 3);
  if (des.length) {
    const imgs = await Promise.all(des.map(async (s) => doc.embedPng(await (await Des.svgParaPng(s, 500)).arrayBuffer()).catch(() => null)));
    const larg = (W - 2 * M - (des.length - 1) * 10) / des.length; let x = M, alt = 0;
    for (const im of imgs) { if (!im) continue; const k = Math.min(larg / im.width, 110 / im.height); pg.drawImage(im, { x, y: y - im.height * k, width: im.width * k, height: im.height * k }); alt = Math.max(alt, im.height * k); x += larg + 10; }
    y -= alt + 18;
  }
  pg.drawText(ansi(res.destaque), { x: M, y: y - 18, size: 24, font: fb, color: marrom });
  if (res.situacao) { const t = ansi(res.situacao[0]), w = fb.widthOfTextAtSize(t, 12) + 16, cor = res.situacao[1] === 'ok' ? rgb(0.12, 0.49, 0.2) : rgb(0.7, 0.15, 0.12);
    pg.drawRectangle({ x: W - M - w, y: y - 20, width: w, height: 20, color: cor }); pg.drawText(t, { x: W - M - w + 8, y: y - 14, size: 12, font: fb, color: rgb(1, 1, 1) }); }
  y -= 26;
  if (res.sub) { pg.drawText(ansi(res.sub), { x: M, y: y - 10, size: 10, font: fn, color: cinza }); y -= 18; }
  y -= 8;
  // resumo em duas colunas
  const cA = 170;
  for (const [a, b] of res.resumo) {
    const la = quebra(a, fb, 9.5, cA - 8), lb = quebra(b, fn, 9.5, W - 2 * M - cA), h = Math.max(la.length, lb.length) * 12 + 6;
    if (y - h < M + 20) nova();
    la.forEach((t, i) => pg.drawText(t, { x: M, y: y - 11 - i * 12, size: 9.5, font: fb, color: rgb(0.25, 0.25, 0.25) }));
    lb.forEach((t, i) => pg.drawText(t, { x: M + cA, y: y - 11 - i * 12, size: 9.5, font: fn }));
    y -= h; pg.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });
  }
  if (res.tabela) {
    y -= 14; if (y < M + 60) nova();
    const n = res.tabela.cab.length, cw = (W - 2 * M) / n;
    pg.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 16, color: marrom });
    res.tabela.cab.forEach((c, i) => pg.drawText(ansi(c), { x: M + 4 + i * cw, y: y - 11.5, size: 8.5, font: fb, color: rgb(1, 1, 1) }));
    y -= 16;
    for (const l of res.tabela.linhas) { if (y < M + 20) nova(); l.forEach((c, i) => pg.drawText(ansi(c), { x: M + 4 + i * cw, y: y - 11.5, size: 9, font: fn })); y -= 15; }
  }
  if (res.avisos?.length) {
    y -= 10;
    for (const a of res.avisos) for (const t of quebra('• ' + a, fn, 8.5, W - 2 * M)) { if (y < M + 20) nova(); pg.drawText(t, { x: M, y: y - 10, size: 8.5, font: fn, color: rgb(0.6, 0.35, 0) }); y -= 11; }
  }
  doc.getPages().forEach((p, i, ps) => p.drawText(ansi(`wiapps.com.br/ferramentas · Calculadora de obra · página ${i + 1} de ${ps.length}`), { x: M, y: 18, size: 7.5, font: fn, color: cinza }));
  const nome = `${calc.nome}_${res.arquivo?.titulo || ''}_${(v.data || hojeISO())}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 80) + '.pdf';
  const blob = new Blob([await doc.save()], { type: 'application/pdf' }), file = new File([blob], nome, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer:coarse)').matches) { try { await navigator.share({ files: [file], title: calc.nome }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  F.baixar(blob, nome);
  F.toast('Pronto: ' + nome);
}

rota();
