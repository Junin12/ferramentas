// Normas em cards: seta das cotas, filtro pelos temas (etiqueta de cada card), busca sem acento,
// endereço próprio de cada card (#id), favoritos, enviar o card como imagem e as mini calculadoras (div.calc[data-calc]).
'use strict';
const NORMAS = (() => {
  const SETA = '<marker id="sa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" fill="#c2410c"/></marker>';
  document.body.insertAdjacentHTML('afterbegin', `<svg class="svgdefs" aria-hidden="true"><defs>${SETA}</defs></svg>`);

  const sem = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slug = (s) => sem(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const num = (v) => { const n = parseFloat(String(v).trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
  const fmt = (v, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const aviso = (msg, erro) => (window.F ? F.toast(msg, erro) : console.log(msg));

  // ---------- favoritos (neste aparelho) ----------
  const CHAVE = 'normas-fav';
  const lerFav = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || []; } catch (e) { return []; } };
  const gravarFav = (l) => { try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch (e) { aviso('Este aparelho não deixou guardar o favorito.', true); } };

  function botao(txt, rotulo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'acao-card';
    b.textContent = txt;
    b.title = rotulo;
    b.setAttribute('aria-label', rotulo);
    return b;
  }

  // pasta = endereço da página da norma a partir de /ferramentas/ (ex.: 'nbr12655/'); norma = nome curto (ex.: 'NBR 12655')
  function prepararCard(card, pasta, norma) {
    const h2 = card.querySelector('h2');
    if (!card.id) card.id = slug(h2.textContent);
    const chave = pasta + '#' + card.id;
    const sec = card.querySelector('header .sec');
    const lado = document.createElement('span');
    lado.className = 'lado';
    sec.replaceWith(lado);
    const fav = botao('☆', 'Favoritar este card');
    const env = botao('⤴', 'Enviar este card como imagem');
    lado.append(sec, fav, env);
    const marcar = () => {
      const on = lerFav().some((f) => f.u === chave);
      fav.textContent = on ? '★' : '☆';
      fav.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    fav.addEventListener('click', () => {
      let l = lerFav();
      if (l.some((f) => f.u === chave)) l = l.filter((f) => f.u !== chave);
      else l.push({ u: chave, t: norma + ' · ' + h2.textContent });
      gravarFav(l);
      marcar();
    });
    env.addEventListener('click', () => enviar(card, norma, env));
    marcar();
    card.querySelectorAll('.calc[data-calc]').forEach(montarCalc);
    card.querySelectorAll('.ri[data-i]').forEach((a) => {
      if (!a.querySelector('svg')) a.insertAdjacentHTML('afterbegin', `<svg class="ill" viewBox="0 0 40 40" aria-hidden="true">${ICONES[a.dataset.i] || ''}</svg>`);
    });
  }

  // ---------- card "Resumo": cada número leva um mini desenho (a.ri[data-i]) e abre o card dele ----------
  const LINHA = 'style="fill:var(--panel);stroke:var(--ink);stroke-width:2.5"';
  const ICONES = {
    cobr: '<rect class="cc" x="4" y="4" width="32" height="32" rx="2"/><path class="est" d="M11 11h18v18H11z"/><circle class="fe" cx="15" cy="25" r="3"/><circle class="fe" cx="25" cy="25" r="3"/><path class="dim" d="M5 33h5"/>',
    cp: '<path class="cc" d="M10 9v22a10 4 0 0 0 20 0V9z"/><ellipse class="cc2" cx="20" cy="9" rx="10" ry="4"/>',
    curva: '<path class="acs" d="M3 34C12 34 13 8 20 8s8 26 17 26z"/><path class="ln" d="M3 34h34"/><path class="dim" d="M12 34V24"/>',
    flecha: '<path class="lnb" d="M5 13Q20 26 35 13"/><path class="ink" d="M1 13h8l-4 6zM31 13h8l-4 6z"/><path class="dim" d="M20 6v13" marker-end="url(#sa)"/>',
    fissura: '<rect class="cc" x="4" y="8" width="32" height="24" rx="2"/><path class="fis" stroke-width="2" d="M14 32l3-7-3-5 4-6M24 32l2-5-2-4"/>',
    pilar: '<rect class="cc" x="12" y="3" width="16" height="34"/><path class="fio" d="M16 3v34M24 3v34"/><path class="tr" d="M12 12h16M12 21h16M12 30h16"/>',
    viga: '<rect class="cc" x="3" y="11" width="34" height="14"/><path class="fio" d="M3 21h34"/><path class="ink" d="M5 25h6l-3 6zM29 25h6l-3 6z"/>',
    laje: '<path class="cc" d="M2 12h36v8H2z"/><path class="lnb" d="M9 20v16M31 20v16"/>',
    gota: '<path class="ag" d="M20 3C14 13 9 19 9 25a11 11 0 0 0 22 0c0-6-5-12-11-22z"/>',
    tubo: '<circle cx="20" cy="20" r="14" class="ags" style="stroke:var(--agua);stroke-width:3"/><path class="ag" d="M7.4 26H32.6A14 14 0 0 1 7.4 26z"/>',
    vala: '<path class="te" d="M1 11h10v24h18V11h10v27H1z"/><path class="ln" d="M11 11v24h18V11"/>',
    escora: '<rect class="cc" x="3" y="5" width="34" height="6"/><path class="lnb" d="M10 11v25M30 11v25"/><path class="ln" d="M10 21l20 9M30 21l-20 9"/>',
    relogio: `<circle cx="20" cy="20" r="15" ${LINHA}/><path class="lnb" d="M20 10v10l7 5"/>`,
    termo: '<path class="ln" d="M17 24V7a3 3 0 0 1 6 0v17"/><path class="ac" d="M18.5 13h3v13h-3z"/><circle class="ac" cx="20" cy="29" r="6"/>',
    peso: '<circle cx="20" cy="9" r="4" style="fill:none;stroke:var(--ink);stroke-width:2.5"/><path class="ink" d="M9 35l4-21h14l4 21z"/>',
    cone: '<path class="cc" d="M11 33L15 8h10l4 25z"/><path class="lnb" d="M4 34h32"/>',
    golpe: '<path class="cc" d="M11 35L15 14h10l4 21z"/><path class="lnb" d="M20 2v26"/>',
    martelo: '<rect class="ink" x="10" y="3" width="16" height="11" rx="2"/><path class="lnb" d="M18 14v22"/><path class="dim" d="M32 5v14" marker-end="url(#sa)"/>',
    peneira: '<ellipse class="cc2" cx="20" cy="12" rx="16" ry="5"/><path class="tr" d="M6 12h28M13 8v8M20 7v10M27 8v8"/><g class="te2"><circle cx="13" cy="27" r="2.5"/><circle cx="21" cy="33" r="2.5"/><circle cx="27" cy="25" r="2.5"/></g>',
    brita: '<g class="cc2"><path d="M4 30l5-9 8 1 2 10-9 4z"/><path d="M20 22l7-8 8 4-1 9-9 2z"/><path d="M12 12l6-7 7 3-2 8-8 1z"/></g>',
    solo: '<rect class="te" x="2" y="23" width="36" height="14"/><rect class="ink" x="12" y="5" width="16" height="10" rx="1"/><path class="lnb" d="M20 15v6"/><path class="tr" d="M2 30h36"/>',
    pessoa: '<circle class="ink" cx="20" cy="7" r="4"/><path class="lnb" d="M20 13v12M11 18h18M20 25l-6 11M20 25l6 11"/>',
    altura: '<path class="ink" d="M3 10h16v3H3z"/><circle class="ink" cx="11" cy="5" r="3"/><path class="dim" d="M30 8v26" marker-start="url(#sa)" marker-end="url(#sa)"/><path class="ln" d="M2 37h36"/>',
    capacete: '<path class="wd" d="M7 26a13 13 0 0 1 26 0z"/><rect class="wd" x="3" y="25" width="34" height="5" rx="2.5"/><path class="ln" d="M20 13v7"/>',
    gas: '<rect class="ink" x="11" y="4" width="18" height="32" rx="4"/><rect class="gd" x="14" y="8" width="12" height="10" rx="1"/><circle class="rd" cx="20" cy="27" r="3.5"/>',
    cadeira: '<circle cx="17" cy="27" r="9" style="fill:none;stroke:var(--ink);stroke-width:2.5"/><circle class="ink" cx="17" cy="5" r="3"/><path class="lnb" d="M17 10v12h10l4 10"/>',
    rampa: '<path class="cc" d="M3 35L33 18v17z"/><path class="dim" d="M37 18v17" marker-start="url(#sa)" marker-end="url(#sa)"/>',
    porta: `<rect x="9" y="3" width="22" height="34" ${LINHA}/><path class="lnb" d="M24 20h4"/>`,
    casa: '<path class="cc" d="M5 18L20 5l15 13v18H5z"/><rect class="pan" x="16" y="24" width="8" height="12"/>',
    ruido: '<path class="ink" d="M4 15h7l9-8v26l-9-8H4z"/><path class="ln" d="M25 14a8 8 0 0 1 0 12M30 9a15 15 0 0 1 0 22"/>',
    escada: '<path class="lnb" d="M12 36L18 4M28 36L34 4M13.5 28H29.5M15.4 18H31.4M16.9 10H32.9"/>',
    cinto: '<path class="lnb" d="M20 37V20M20 20L9 4M20 20L31 4"/><circle class="ac" cx="20" cy="21" r="4"/><circle class="ink" cx="9" cy="4" r="2.5"/><circle class="ink" cx="31" cy="4" r="2.5"/>',
    vibrador: '<path class="lnb" d="M6 3c6 4 2 8 9 12"/><rect class="ink" x="15" y="13" width="7" height="24" rx="3.5"/><path class="tr" d="M26 20h8M26 26h8M26 32h8"/>',
    barra: '<path class="lnb" d="M4 31L36 9"/><path class="ln" d="M9 24l3 5M15 20l3 5M21 16l3 5M27 12l3 5"/>',
    dobra: '<circle class="tr" cx="17" cy="15" r="6"/><path class="lnb" d="M7 37V15a10 10 0 0 1 20 0v8"/>',
    caminhao: '<rect class="ink" x="2" y="13" width="22" height="15" rx="2"/><path class="ink" d="M24 17h7l6 7v4H24z"/><circle cx="9" cy="30" r="4" style="fill:var(--panel);stroke:var(--ink);stroke-width:2"/><circle cx="30" cy="30" r="4" style="fill:var(--panel);stroke:var(--ink);stroke-width:2"/>',
    pressao: `<circle cx="20" cy="22" r="14" ${LINHA}/><path class="lnb" d="M20 22l7-7"/><path class="ln" d="M20 2v6"/>`,
    doc: '<path d="M9 3h15l7 7v27H9z" style="fill:var(--panel);stroke:var(--ink);stroke-width:2"/><path class="ln" d="M13 16h14M13 22h14M13 28h9"/>',
    calendario: '<rect x="5" y="8" width="30" height="28" rx="3" style="fill:var(--panel);stroke:var(--ink);stroke-width:2"/><path class="ink" d="M5 11a3 3 0 0 1 3-3h24a3 3 0 0 1 3 3v5H5z"/><path class="lnb" d="M13 3v7M27 3v7"/>',
    parede: '<g class="cc2"><rect x="2" y="5" width="17" height="9"/><rect x="21" y="5" width="17" height="9"/><rect x="2" y="27" width="17" height="9"/><rect x="21" y="27" width="17" height="9"/></g><g class="cc"><rect x="11" y="16" width="18" height="9"/><rect x="2" y="16" width="7" height="9"/><rect x="31" y="16" width="7" height="9"/></g>',
    bloco: '<rect class="cc2" x="3" y="10" width="34" height="20" rx="1"/><rect class="pan" x="7" y="14" width="11" height="12"/><rect class="pan" x="22" y="14" width="11" height="12"/>',
    sapata: '<rect class="cc" x="16" y="3" width="8" height="19"/><path class="cc2" d="M5 26l11-4h8l11 4v6H5z"/><rect class="te" x="2" y="32" width="36" height="5"/>',
    estaca: '<rect class="te" x="2" y="10" width="36" height="27"/><rect class="cc" x="15" y="3" width="10" height="34"/>',
    escudo: '<path class="gd" d="M20 3l14 5v10c0 9-6 15-14 19C12 33 6 27 6 18V8z"/><path d="M13 19l5 5 9-10" style="fill:none;stroke:var(--panel);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round"/>',
    guardacorpo: '<path class="lnb" d="M3 7h34M3 19h34M6 7v29M20 7v29M34 7v29"/><rect class="wd" x="3" y="30" width="34" height="6"/>',
    ok: '<circle class="gd" cx="20" cy="20" r="16"/><path d="M12 20l6 6 10-11" style="fill:none;stroke:var(--panel);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round"/>',
    alerta: '<path class="wd" d="M20 3l18 32H2z" style="stroke-linejoin:round"/><path d="M20 14v10M20 29v.5" style="fill:none;stroke:var(--panel);stroke-width:3.5;stroke-linecap:round"/>',
    piso: '<rect class="wd" x="3" y="3" width="34" height="34" rx="3"/><g class="ink"><circle cx="11" cy="11" r="2.5"/><circle cx="20" cy="11" r="2.5"/><circle cx="29" cy="11" r="2.5"/><circle cx="11" cy="20" r="2.5"/><circle cx="20" cy="20" r="2.5"/><circle cx="29" cy="20" r="2.5"/><circle cx="11" cy="29" r="2.5"/><circle cx="20" cy="29" r="2.5"/><circle cx="29" cy="29" r="2.5"/></g>',
    sanitario: '<path class="lnb" d="M10 4h8v12"/><path d="M6 16h28c0 8-6 13-10 13h-8c-4 0-10-5-10-13z" style="fill:var(--panel);stroke:var(--ink);stroke-width:2.5"/><path class="lnb" d="M15 29l-1 7h12l-1-7"/>',
    regua: '<rect class="wd" x="2" y="13" width="36" height="14" rx="1"/><path class="ln" d="M8 13v6M14 13v8M20 13v6M26 13v8M32 13v6"/>',
    pv: '<rect class="cc2" x="13" y="3" width="14" height="26"/><path class="ink" d="M11 3h18v3H11z"/><path class="agl" d="M1 31h38" style="stroke-width:4"/>',
  };

  // ---------- mapa mental: centro → ramos (temas) → folhas (cards) ----------
  // dados = { centro: no, ramos: [{ ...no, folhas: [no] }] }; no = { t, href?, ir? } (ir = função no toque)
  const CORES = ['var(--steel)', 'var(--acc)', 'var(--agua)', 'var(--good)', 'var(--warn)', 'var(--terra2)', 'var(--bad)', '#8a6be0'];
  const NS = 'http://www.w3.org/2000/svg';

  function mapa(el, dados) {
    let largo = null, c = null, grupos = [];
    const lig = document.createElementNS(NS, 'svg');
    lig.setAttribute('class', 'mm-lig');
    lig.setAttribute('aria-hidden', 'true');
    const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
    const no = (cls, item) => {
      const a = document.createElement(item.href || item.ir ? 'a' : 'span');
      a.className = 'mm-no ' + cls;
      a.textContent = item.t;
      if (item.href || item.ir) a.href = item.href || '#';
      if (item.ir) a.addEventListener('click', (e) => { e.preventDefault(); item.ir(); });
      return a;
    };

    function montar() {
      largo = el.clientWidth >= 640;
      el.className = 'mm' + (largo ? '' : ' vert');
      const esq = div('mm-lado esq'), dir = div('mm-lado dir'), meio = div('mm-meio');
      c = no('mm-c', dados.centro);
      meio.append(c);
      // no computador os temas vão para os dois lados, com mais ou menos o mesmo número de folhas
      const pesos = dados.ramos.map((r) => r.folhas.length + 1);
      const total = pesos.reduce((s, p) => s + p, 0);
      let acum = 0;
      grupos = dados.ramos.map((r, i) => {
        const cor = r.cor || CORES[i % CORES.length];
        const g = div('mm-g');
        g.style.setProperty('--c', cor);
        const rn = no('mm-r', r), fs = div('mm-fs');
        r.folhas.forEach((f) => fs.append(no('mm-f', f)));
        g.append(rn, fs);
        const lado = largo && acum + pesos[i] / 2 > total / 2 ? esq : dir;
        acum += pesos[i];
        lado.append(g);
        return { rn, fs, cor, esq: lado === esq };
      });
      el.replaceChildren(lig, esq, meio, dir);
      ligar();
    }

    const curva = (x1, y1, x2, y2) => { const m = (x1 + x2) / 2; return `M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}`; };
    const cotovelo = (x, y1, x2, y2) => `M${x} ${y1}V${y2 - 8}Q${x} ${y2} ${x + 8} ${y2}H${x2}`;

    function ligar() {
      const b = el.getBoundingClientRect();
      const W = el.scrollWidth, H = el.scrollHeight;
      lig.setAttribute('width', W);
      lig.setAttribute('height', H);
      lig.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const r = (n) => { const q = n.getBoundingClientRect(); return { l: q.left - b.left, r: q.right - b.left, b: q.bottom - b.top, y: (q.top + q.bottom) / 2 - b.top }; };
      const C = r(c), linhas = [];
      const traco = (d, cor, w) => linhas.push(`<path d="${d}" style="fill:none;stroke:${cor};stroke-width:${w};stroke-linecap:round"/>`);
      // no celular o tronco é um só: fica cinza e os ramos ganham a cor
      grupos.forEach(({ rn, fs, cor, esq }) => {
        const R = r(rn);
        if (largo) traco(curva(esq ? C.l : C.r, C.y, esq ? R.r : R.l, R.y), cor, 2.5);
        else traco(cotovelo(C.l + 14, C.b, R.l, R.y), 'var(--muted)', 2);
        [...fs.children].forEach((f) => {
          const F = r(f);
          if (largo) traco(curva(esq ? R.l : R.r, R.y, esq ? F.r : F.l, F.y), cor, 1.5);
          else traco(cotovelo(R.l + 12, R.b, F.l, F.y), cor, 1.5);
        });
      });
      lig.innerHTML = linhas.join('');
    }

    new ResizeObserver(() => {
      if (!el.clientWidth) return;
      if ((el.clientWidth >= 640) !== largo) montar();
      else ligar();
    }).observe(el);
    montar();
  }

  // ---------- enviar o card como imagem (WhatsApp, e-mail…) ----------
  let h2c = null;
  const carregarH2C = () => h2c || (h2c = new Promise((ok, erro) => {
    if (window.html2canvas) return ok();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = ok;
    s.onerror = () => { h2c = null; erro(new Error('Sem internet para gerar a imagem. Tente de novo com sinal.')); };
    document.head.append(s);
  }));
  // o desenho usa as cores do tema (variáveis CSS); na cópia da imagem elas vão escritas em cada traço
  const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight'];

  async function enviar(card, norma, btn) {
    btn.disabled = true;
    try {
      aviso('Gerando a imagem…');
      await carregarH2C();
      const fundo = getComputedStyle(card).backgroundColor;
      const marca = 'cap' + Date.now();
      card.dataset.captura = marca;
      const orig = [...card.querySelectorAll('svg.ill *')];
      const foto = await html2canvas(card, {
        scale: 2, backgroundColor: fundo, logging: false,
        ignoreElements: (el) => el.classList && (el.classList.contains('acao-card') || el.classList.contains('calc')),
        onclone: (doc) => {
          const c = doc.querySelector(`[data-captura="${marca}"]`);
          const copia = [...c.querySelectorAll('svg.ill *')];
          orig.forEach((o, i) => { const cs = getComputedStyle(o); const d = copia[i]; if (d) PROPS.forEach((p) => d.style.setProperty(p, cs.getPropertyValue(p))); });
          c.querySelectorAll('svg.ill').forEach((s) => s.insertAdjacentHTML('afterbegin', `<defs>${SETA}</defs>`));
        },
      });
      delete card.dataset.captura;
      // rodapé com a origem
      const rod = 60, out = document.createElement('canvas');
      out.width = foto.width;
      out.height = foto.height + rod;
      const ctx = out.getContext('2d');
      ctx.fillStyle = fundo;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(foto, 0, 0);
      ctx.fillStyle = getComputedStyle(card.querySelector('.dica') || card).color;
      ctx.font = '600 24px system-ui, sans-serif';
      ctx.fillText(`${norma} · wiapps.com.br/ferramentas`, 28, foto.height + 38);
      const blob = await new Promise((ok) => out.toBlob(ok, 'image/png'));
      const nome = `${slug(norma)}-${card.id}.png`;
      const arq = new File([blob], nome, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [arq] })) {
        try { await navigator.share({ files: [arq], title: card.querySelector('h2').textContent }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      F.baixar(blob, nome);
      aviso('Imagem salva. Anexe no WhatsApp pela galeria ou pelos arquivos.');
    } catch (e) {
      console.error(e);
      aviso(e.message || 'Não consegui gerar a imagem.', true);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- mini calculadoras ----------
  const PSI6 = [[16, 1.02, 1.02], [14, 1.00, 1.00], [12, 0.99, 0.98], [10, 0.97, 0.96], [8, 0.95, 0.93], [7, 0.94, 0.91], [6, 0.92, 0.89]];
  const MASSA = { 5: 0.154, 6.3: 0.245, 8: 0.395, 10: 0.617, 12.5: 0.963, 16: 1.578, 20: 2.466, 25: 3.853, 32: 6.313 };
  const lista = (txt) => String(txt).split(/[\s;]+/).map(num).filter(Number.isFinite);

  const CALCS = {
    rampa: {
      tit: 'Calcular a rampa',
      campos: [['h', 'Desnível (m)', '0,40'], ['i', 'Inclinação (%)', '8,33']],
      calc: ({ h, i }) => {
        h = num(h); i = num(i);
        if (!(h > 0 && i > 0)) return 'Preencha o desnível e a inclinação.';
        const c = (h * 100) / i;
        const lim = i <= 5 ? 1.5 : i <= 6.25 ? 1.0 : i <= 8.33 ? 0.8 : 0;
        if (!lim) return `<span class="nok">Acima de 8,33% não atende.</span> O comprimento seria ${fmt(c)} m.`;
        const seg = Math.ceil(h / lim - 1e-9);
        return `Comprimento da rampa <b>${fmt(c)} m</b><br>${seg} segmento(s) de até ${fmt(lim)} m de desnível · ${seg - 1} patamar(es) no meio, com 1,20 m ou mais`;
      },
    },
    zlq: {
      tit: 'Calcular a zona livre de queda',
      campos: [['t', 'Talabarte (m)', '1,5'], ['a', 'Abertura do absorvedor (m)', '1,75'], ['p', 'Altura da pessoa (m)', '1,5'], ['m', 'Margem (m)', '1,0'], ['d', 'Altura livre abaixo da ancoragem (m)', '']],
      calc: ({ t, a, p, m, d }) => {
        const z = [t, a, p, m].map(num);
        if (z.some((v) => !(v >= 0))) return 'Preencha os comprimentos.';
        const zlq = z.reduce((s, v) => s + v, 0);
        const livre = num(d);
        let r = `Zona livre necessária <b>${fmt(zlq)} m</b> abaixo da ancoragem`;
        if (livre > 0) r += livre >= zlq ? `<br><span class="ok">✓ ${fmt(livre)} m disponíveis: atende</span>` : `<br><span class="nok">✗ faltam ${fmt(zlq - livre)} m: suba a ancoragem ou encurte o talabarte</span>`;
        return r;
      },
    },
    declividade: {
      tit: 'Declividade mínima',
      campos: [['q', 'Vazão inicial Qi (L/s)', '1,5']],
      calc: ({ q }) => {
        q = num(q);
        if (!(q > 0)) return 'Informe a vazão.';
        const qc = Math.max(q, 1.5), i = 0.0055 * Math.pow(qc, -0.47);
        return `I mín = <b>${fmt(i, 4)} m/m</b> (${fmt(i * 100, 2)}%) ≈ ${fmt(i * 1000, 1)} cm a cada 10 m` + (q < 1.5 ? '<br>Abaixo de 1,5 L/s vale a vazão mínima de 1,5 L/s.' : '');
      },
    },
    fcj: {
      tit: 'Calcular o fcj',
      campos: [['fck', 'fck (MPa)', '25'], ['c', 'Condição', 'A', [['A', 'A · sd 4,0'], ['B', 'B · sd 5,5'], ['C', 'C · sd 7,0']]]],
      calc: ({ fck, c }) => {
        fck = num(fck);
        if (!(fck > 0)) return 'Informe o fck.';
        const sd = { A: 4, B: 5.5, C: 7 }[c];
        const lim = { A: 80, B: 25, C: 15 }[c];
        return `fcj = <b>${fmt(fck + 1.65 * sd, 1)} MPa</b>` + (fck > lim ? `<br><span class="nok">Condição ${c} só vale até C${lim}.</span>` : '');
      },
    },
    fckest: {
      tit: 'Calcular o fck estimado',
      campos: [['v', 'Resultados dos exemplares (MPa), um por linha', '27,5\n28,4\n29,0\n30,1\n31,2\n32,0', 'txt'], ['tipo', 'Amostragem', 'parcial', [['parcial', 'parcial'], ['total', 'total (100%)']]], ['c', 'Condição', 'A', [['A', 'A'], ['B', 'B ou C']]], ['fck', 'fck do projeto (MPa)', '25']],
      calc: ({ v, tipo, c, fck }) => {
        const f = lista(v).sort((x, y) => x - y), n = f.length;
        let est;
        if (tipo === 'total') {
          if (!n) return 'Cole os resultados.';
          est = n <= 20 ? f[0] : f[Math.ceil(0.05 * n) - 1];
        } else if (n < 6) {
          return `${n} exemplar(es). A amostragem parcial pede no mínimo 6.`;
        } else if (n < 20) {
          const m = Math.floor(n / 2);
          const soma = f.slice(0, m - 1).reduce((s, x) => s + x, 0);
          const psi = PSI6.find((l) => n >= l[0])[c === 'A' ? 1 : 2];
          est = Math.max((2 * soma) / (m - 1) - f[m - 1], psi * f[0]);
        } else {
          const med = f.reduce((s, x) => s + x, 0) / n;
          const sd = Math.sqrt(f.reduce((s, x) => s + (x - med) ** 2, 0) / (n - 1));
          est = med - 1.65 * sd;
        }
        const alvo = num(fck);
        let r = `${n} exemplares · fck,est = <b>${fmt(est, 1)} MPa</b>`;
        if (alvo > 0) r += est >= alvo ? `<br><span class="ok">✓ lote aceito (≥ ${fmt(alvo, 0)} MPa)</span>` : `<br><span class="nok">✗ abaixo de ${fmt(alvo, 0)} MPa: ver card "Aceita ou não aceita"</span>`;
        return r;
      },
    },
    aco: {
      tit: 'Peso do aço',
      campos: [['b', 'Bitola (mm)', '10', Object.keys(MASSA).map(Number).sort((a, b) => a - b).map((k) => [String(k), fmt(k, k % 1 ? 1 : 0)])], ['n', 'Nº de barras', '10'], ['l', 'Comprimento de cada (m)', '12']],
      calc: ({ b, n, l }) => {
        const kgm = MASSA[b]; n = num(n); l = num(l);
        if (!(n > 0 && l > 0)) return 'Preencha barras e comprimento.';
        const area = (Math.PI * (b ** 2) / 4) / 100;
        return `<b>${fmt(kgm * n * l, 1)} kg</b> · ${fmt(kgm, 3)} kg/m · área ${fmt(area * n, 2)} cm² (${n} barras)`;
      },
    },
    laje: {
      tit: 'Carga da sua laje',
      campos: [['h', 'Laje (cm)', '10'], ['cp', 'Contrapiso + piso (cm)', '5'], ['fr', 'Forro/reboco (kN/m²)', '0,3'], ['u', 'Uso', '1.5', [['1.5', 'Residencial 1,5'], ['2', 'Área de serviço 2,0'], ['2.5', 'Escritório 2,5'], ['3', 'Garagem/escada 3,0'], ['4', 'Loja 4,0'], ['1', 'Cobertura 1,0']]]],
      calc: ({ h, cp, fr, u }) => {
        const pp = (num(h) / 100) * 25, rev = (num(cp) / 100) * 21, f = num(fr) || 0, q = num(u);
        if (![pp, rev].every(Number.isFinite)) return 'Preencha laje e contrapiso.';
        const tot = pp + rev + f + q;
        return `Total <b>${fmt(tot)} kN/m²</b> ≈ ${fmt(tot * 100, 0)} kg/m²<br>peso próprio ${fmt(pp)} + revestimento ${fmt(rev)} + forro ${fmt(f)} + uso ${fmt(q, 1)}`;
      },
    },
  };

  function montarCalc(div) {
    const def = CALCS[div.dataset.calc];
    if (!def) return;
    div.innerHTML = `<div class="tit">${def.tit}</div><div class="campos"></div><div class="res" aria-live="polite"></div>`;
    const campos = div.querySelector('.campos'), res = div.querySelector('.res');
    const els = {};
    def.campos.forEach(([nome, rot, val, ops]) => {
      const lab = document.createElement('label');
      lab.textContent = rot;
      let el;
      if (Array.isArray(ops)) {
        el = document.createElement('select');
        ops.forEach(([v, t]) => el.add(new Option(t, v, false, v === val)));
      } else if (ops === 'txt') {
        el = document.createElement('textarea');
        el.value = val;
        lab.style.gridColumn = '1 / -1';
      } else {
        el = document.createElement('input');
        el.inputMode = 'decimal';
        el.value = val;
      }
      els[nome] = el;
      lab.append(el);
      campos.append(lab);
    });
    const rodar = () => {
      const v = {};
      Object.entries(els).forEach(([k, el]) => (v[k] = el.value));
      try { res.innerHTML = def.calc(v); } catch (e) { res.textContent = 'Confira os valores.'; }
    };
    campos.addEventListener('input', rodar);
    rodar();
  }

  // ---------- página de uma norma: temas, busca e card do endereço ----------
  function iniciarPagina() {
    const grade = document.querySelector('.grade');
    const q = document.getElementById('q');
    if (!grade || !q) return;
    const pasta = location.pathname.replace(/index\.html$/, '').split('/').filter(Boolean).pop() + '/';
    const norma = document.querySelector('.topo h1').textContent.replace(/ em cards$/, '');
    const cards = [...grade.querySelectorAll('.cn')];
    cards.forEach((c) => {
      prepararCard(c, pasta, norma);
      const svg = c.querySelector('svg');
      c._t = sem(c.textContent + ' ' + (svg ? svg.getAttribute('aria-label') || '' : ''));
      c._tema = c.querySelector('.tag').textContent.trim();
    });

    // um botão por tema, na ordem em que aparecem (o card Resumo só aparece em "Todos")
    const temas = ['Todos', ...new Set(cards.filter((c) => !c.classList.contains('resumo')).map((c) => c._tema))];
    const chips = temas.map((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.setAttribute('aria-pressed', i ? 'false' : 'true');
      return b;
    });
    if (temas.length > 2) q.before(...chips);

    let tema = 'Todos';
    function filtrar() {
      const t = sem(q.value.trim());
      let n = 0;
      cards.forEach((c) => {
        const ok = (tema === 'Todos' || c._tema === tema) && (!t || c._t.includes(t));
        c.hidden = !ok;
        if (ok) n++;
      });
      document.getElementById('vazio').classList.toggle('hide', n > 0);
    }
    const escolherTema = (t) => {
      tema = t;
      chips.forEach((x) => x.setAttribute('aria-pressed', x.textContent === t ? 'true' : 'false'));
      filtrar();
    };
    chips.forEach((b) => b.addEventListener('click', () => escolherTema(b.textContent)));
    q.addEventListener('input', filtrar);

    // ---------- mapa mental da norma, montado com os cards da página ----------
    const btnMapa = document.createElement('button');
    btnMapa.type = 'button';
    btnMapa.className = 'btn-mapa';
    btnMapa.textContent = '🧠 Mapa mental';
    q.parentNode.prepend(btnMapa);
    let tela = null;
    const irPara = (card) => {
      fecharMapa();
      q.value = '';
      escolherTema('Todos');
      cards.forEach((c) => c.classList.toggle('alvo', c === card));
      history.replaceState(null, '', '#' + card.id);
      card.scrollIntoView({ block: 'start' });
    };
    function abrirMapa() {
      if (!tela) {
        tela = document.createElement('div');
        tela.className = 'mm-tela';
        tela.setAttribute('role', 'dialog');
        tela.setAttribute('aria-modal', 'true');
        tela.setAttribute('aria-label', 'Mapa mental da ' + norma);
        tela.innerHTML = '<div class="mm-topo"><b></b><span class="aviso">Toque num item para abrir o card</span><button type="button">✕ Fechar</button></div><div class="mm-corpo"><div></div></div>';
        tela.querySelector('b').textContent = '🧠 ' + norma;
        tela.querySelector('button').addEventListener('click', fecharMapa);
        document.body.append(tela);
        const ramos = new Map();
        cards.filter((c) => !c.classList.contains('resumo')).forEach((c) => {
          if (!ramos.has(c._tema)) ramos.set(c._tema, []);
          ramos.get(c._tema).push({ t: c.querySelector('h2').textContent, href: '#' + c.id, ir: () => irPara(c) });
        });
        const resumo = cards.find((c) => c.classList.contains('resumo'));
        mapa(tela.querySelector('.mm-corpo > div'), {
          centro: { t: norma, ir: resumo ? () => irPara(resumo) : fecharMapa },
          ramos: [...ramos].map(([t, folhas]) => ({ t, folhas, ir: () => { fecharMapa(); q.value = ''; escolherTema(t); scrollTo(0, 0); } })),
        });
      }
      tela.hidden = false;
      document.body.classList.add('mm-aberto');
      tela.querySelector('button').focus();
    }
    function fecharMapa() {
      if (!tela || tela.hidden) return;
      tela.hidden = true;
      document.body.classList.remove('mm-aberto');
      if (location.hash === '#mapa') history.replaceState(null, '', location.pathname + location.search);
    }
    btnMapa.addEventListener('click', abrirMapa);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMapa(); });

    // aberto por um link para um card (ex.: nbr12655/#formacao-de-lotes): destaca e rola até ele; #mapa abre o mapa mental
    if (location.hash === '#mapa') abrirMapa();
    const alvo = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (alvo && alvo.classList.contains('cn')) {
      alvo.classList.add('alvo');
      requestAnimationFrame(() => alvo.scrollIntoView({ block: 'start' }));
    }
  }
  // fórmulas largas rolam para o lado: com foco pelo teclado também (acessibilidade)
  document.querySelectorAll('.f').forEach((e) => { if (!e.hasAttribute('tabindex')) e.tabIndex = 0; });
  if (!document.body.hasAttribute('data-busca')) iniciarPagina();

  return { sem, slug, lerFav, prepararCard, mapa };
})();
