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

    // um botão por tema, na ordem em que aparecem
    const temas = ['Todos', ...new Set(cards.map((c) => c._tema))];
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
    chips.forEach((b) => b.addEventListener('click', () => {
      tema = b.textContent;
      chips.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      filtrar();
    }));
    q.addEventListener('input', filtrar);

    // aberto por um link para um card (ex.: nbr12655/#formacao-de-lotes): destaca e rola até ele
    const alvo = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (alvo && alvo.classList.contains('cn')) {
      alvo.classList.add('alvo');
      requestAnimationFrame(() => alvo.scrollIntoView({ block: 'start' }));
    }
  }
  // fórmulas largas rolam para o lado: com foco pelo teclado também (acessibilidade)
  document.querySelectorAll('.f').forEach((e) => { if (!e.hasAttribute('tabindex')) e.tabIndex = 0; });
  if (!document.body.hasAttribute('data-busca')) iniciarPagina();

  return { sem, slug, lerFav, prepararCard };
})();
