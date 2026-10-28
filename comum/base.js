// Funções comuns das ferramentas: aviso na tela, baixar arquivo, ler PDF, intervalos de páginas.
'use strict';

const F = (() => {
  const $ = (s) => document.querySelector(s);
  const MAX_PDF = 150 * 1024 * 1024;

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  let timer = 0;
  function toast(msg, isErr) {
    const el = $('#status');
    el.textContent = msg;
    el.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(timer);
    timer = setTimeout(() => (el.className = ''), isErr ? 6000 : 3500);
  }

  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // confere se as bibliotecas do cdnjs carregaram (sem internet na primeira visita, não carregam)
  function libs(...nomes) {
    if (nomes.every((n) => window[n])) return true;
    toast('Não consegui carregar as bibliotecas. Verifique a internet e recarregue.', true);
    return false;
  }

  const ehPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const nomeBase = (n) => n.replace(/\.[^.]+$/, '') || 'arquivo';
  const tamanho = (b) => (b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB');

  async function bytesPdf(file) {
    if (!ehPdf(file)) throw new Error(`“${file.name}” não é PDF.`);
    if (file.size > MAX_PDF) throw new Error(`“${file.name}” passa de 150 MB.`);
    return new Uint8Array(await file.arrayBuffer());
  }
  // abre com o pdf-lib; PDF com senha não dá para alterar
  async function abrirPdfLib(bytes, nome) {
    try { return await PDFLib.PDFDocument.load(bytes); }
    catch (e) {
      if (/encrypt/i.test(e.message)) throw new Error(`“${nome}” é protegido por senha.`);
      throw new Error(`Não consegui abrir “${nome}”. Ele pode estar corrompido.`);
    }
  }

  // "1-3, 5, 8-" → [[0,1,2],[4],[7,8,…]] (índices a partir de 0). Vazio = todas as páginas num intervalo só.
  function intervalos(txt, total) {
    const s = String(txt || '').replace(/\s+/g, '');
    if (!s) return [Array.from({ length: total }, (_, i) => i)];
    return s.split(/[,;]/).filter(Boolean).map((parte) => {
      const m = parte.match(/^(\d*)(?:[-–](\d*))?$/);
      if (!m || (!m[1] && !m[2])) throw new Error(`Não entendi “${parte}”. Use algo como 1-3, 5, 8-10.`);
      const ini = m[1] ? +m[1] : 1;
      const fim = m[2] !== undefined ? (m[2] ? +m[2] : total) : ini;
      if (ini < 1 || fim > total || ini > fim) throw new Error(`“${parte}” fora das páginas do arquivo (1 a ${total}).`);
      return Array.from({ length: fim - ini + 1 }, (_, i) => ini - 1 + i);
    });
  }
  const descreve = (idx) => (idx.length === 1 ? 'p' + (idx[0] + 1) : `p${idx[0] + 1}-${idx[idx.length - 1] + 1}`);

  // página do pdf.js num canvas com fundo branco; `dpi` 72 = tamanho real. Limita o lado maior para não estourar a memória do celular.
  async function canvasDaPagina(page, dpi, maxLado = 4000) {
    let vp = page.getViewport({ scale: dpi / 72 });
    const k = Math.min(1, maxLado / Math.max(vp.width, vp.height));
    if (k < 1) vp = page.getViewport({ scale: (dpi / 72) * k });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  }
  const jpeg = (canvas, q) => new Promise((ok, erro) => canvas.toBlob((b) => (b ? ok(b) : erro(new Error('falha ao gerar a imagem'))), 'image/jpeg', q));

  // área de soltar arquivos + botão de escolher
  function entrada(zona, input, aoEscolher) {
    input.addEventListener('change', () => { const fs = [...input.files]; input.value = ''; if (fs.length) aoEscolher(fs); });
    ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('over'); }));
    document.addEventListener('drop', (e) => { const fs = [...e.dataTransfer.files]; if (fs.length) aoEscolher(fs); });
  }

  // trava o botão principal enquanto trabalha e mostra o andamento nele
  async function trabalhando(botao, fn) {
    const txt = botao.textContent;
    botao.disabled = true;
    try { return await fn((msg) => (botao.textContent = msg)); }
    catch (e) { console.error(e); toast(e.message || 'Algo deu errado.', true); }
    finally { botao.textContent = txt; botao.disabled = false; }
  }

  // dentro de outro app (iframe): trocar de página sem empilhar no histórico, para o Voltar do celular fechar as ferramentas
  if (window !== window.top) document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a && a.origin === location.origin && !a.target && !a.hasAttribute('download')) { e.preventDefault(); location.replace(a.href); }
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('../sw.js').catch((e) => console.warn('SW não registrado', e));
  }

  return { $, toast, baixar, libs, ehPdf, nomeBase, tamanho, bytesPdf, abrirPdfLib, intervalos, descreve, canvasDaPagina, jpeg, entrada, trabalhando };
})();
