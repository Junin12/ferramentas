// Visualizador de DWG/DXF: desenho em canvas com zoom/arrasto, camadas, folhas de impressão e medição.
'use strict';

const tela = F.$('#tela'), ctx = tela.getContext('2d');
let d = null;            // espaço do modelo achatado (Cad.achatar)
let folhas = [];         // folhas de impressão: [{nome, d, janelas}]
let folha = -1;          // -1 = modelo; senão, índice em folhas
let nomeArquivo = '';
let vis = [];            // camada do modelo visível?
let grade = null;        // índice dos pontos de "grudar"
let contornos = null;    // caixas das polilinhas fechadas (para o modo Contorno)
const V = { s: 1, tx: 0, ty: 0 }; // tela = (x*s + tx, -y*s + ty), em px CSS
let W = 0, H = 0, dpr = 1;
let modo = 'mover';
let pts = [];            // pontos da medição (coordenadas relativas à origem)
let escolhido = -1;      // polilinha escolhida no modo Contorno
let fator = 1;           // metros por unidade do desenho
const alvo = new URLSearchParams(location.search).get('exportar'); // aberto pelo hub já para converter

// ---------- abrir ----------
let leitor = null;
F.entrada(F.$('#drop'), F.$('#arq'), ([f]) => abrir(f));
// planta DWG/DXF mandada pelo Wigo (projetos da pasta do Drive)
if (new URLSearchParams(location.search).get('doc') === 'wigo') F.doWigo('dwg').then((f) => { if (f) abrir(f); }).catch(() => {});

async function abrir(f) {
  if (!/\.(dwg|dxf)$/i.test(f.name)) { F.toast(`“${f.name}” não é DWG nem DXF.`, true); return; }
  carregando('Abrindo ' + f.name + '…');
  F.$('#carregando-aviso').textContent = f.size > 40 * 1024 * 1024
    ? `Arquivo grande (${F.tamanho(f.size)}): pode levar alguns minutos ou não abrir no celular. Dica: converta para DXF no computador com o ODA File Converter (veja abaixo do botão de abrir) — DXF abre bem mais rápido.` : '';
  let buf;
  try { buf = await f.arrayBuffer(); } catch (e) { carregando(null); F.toast('Não consegui ler o arquivo.', true); return; }
  if (leitor) leitor.terminate();
  leitor = new Worker('leitor.js');
  leitor.onmessage = ({ data }) => {
    if (data.msg) return carregando(data.msg);
    carregando(null);
    if (data.erro) { F.toast(data.erro, true); return; }
    // o leitor continua vivo guardando o desenho para exportar em DXF
    leitor.onmessage = null;
    mostrar(data.pronto, data.folhas || [], f.name);
  };
  leitor.onerror = (e) => { carregando(null); F.toast('Falha ao ler: ' + (e.message || 'erro desconhecido'), true); leitor = null; };
  leitor.postMessage({ nome: f.name, buf }, [buf]);
}

// pede algo ao leitor (que guarda o desenho inteiro) e espera a resposta
function pedirAoLeitor(msg) {
  return new Promise((ok, erro) => {
    if (!leitor) { erro(new Error('Abra o arquivo de novo para exportar.')); return; }
    leitor.onmessage = ({ data }) => { leitor.onmessage = null; data.erro ? erro(new Error(data.erro)) : ok(data); };
    leitor.postMessage(msg);
  });
}

F.$('#cancelar').addEventListener('click', () => {
  if (leitor) { leitor.terminate(); leitor = null; }
  carregando(null);
});

function carregando(msg) {
  F.$('#carregando').classList.toggle('hide', !msg);
  if (msg) F.$('#carregando-msg').textContent = msg;
}

function mostrar(r, fs, nome) {
  d = r; folhas = fs; folha = -1; nomeArquivo = nome;
  vis = d.camadas.map((c) => c.ligada);
  montarGrupos(d);
  grade = montarGrade();
  contornos = null;
  pts = []; escolhido = -1;
  F.$('#titulo').textContent = nome;
  F.$('#trocar').classList.remove('hide');
  document.body.classList.add('aberto');
  // unidade: a do arquivo; sem ela, coordenadas UTM (centenas de milhares) são metros; senão, a última escolhida
  let u = Cad.UNIDADES[d.unidades];
  if (!u && Math.max(Math.abs(d.origem[0]), Math.abs(d.origem[1])) > 1e5) u = 1;
  if (!u) { try { u = +localStorage.getItem('dwg-unid') || 1; } catch (e) { u = 1; } }
  F.$('#unid').value = String([1, 0.01, 0.001].reduce((a, b) => (Math.abs(Math.log(b / u)) < Math.abs(Math.log(a / u)) ? b : a)));
  fator = +F.$('#unid').value;
  // seletor de folhas (só aparece se o arquivo tiver folhas com conteúdo)
  const sel = F.$('#folha');
  sel.replaceChildren(new Option('Modelo', '-1'), ...folhas.map((f, i) => new Option(f.nome, String(i))));
  sel.value = '-1';
  sel.classList.toggle('hide', !folhas.length);
  definirModo('mover');
  listarCamadas();
  medidas();
  redimensionar();
  ajustar();
  if (d.cortado) F.toast('Desenho muito grande: parte dele ficou de fora.', true);
  // veio para gerar PDF/imagem e o arquivo tem folhas de impressão: já abre a primeira (o mais comum é imprimir a prancha)
  if (alvo && folhas.length && ['pdf', 'png', 'jpg', 'svg', 'html'].includes(alvo)) { sel.value = '0'; sel.dispatchEvent(new Event('change')); }
  if (alvo && typeof abrirExportar === 'function') abrirExportar(alvo);
}

F.$('#folha').addEventListener('change', (e) => {
  folha = +e.target.value;
  if (folha >= 0) montarGrupos(folhas[folha].d);
  // medir só no modelo (na folha, as medidas seriam do papel)
  document.querySelectorAll('[data-modo]').forEach((b) => { if (b.dataset.modo !== 'mover') b.disabled = folha >= 0; });
  definirModo('mover');
  ajustar();
});

// pontos de "grudar" agrupados em células quadradas (tamanho pela parte principal do desenho; vale para o desenho todo)
function montarGrade() {
  const S = d.snaps, n = S.length / 2;
  const [x1, y1, x2, y2] = d.caixa;
  const lado = Math.max(x2 - x1, y2 - y1) / 512 || 1;
  const celulas = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.floor(S[2 * i] / lado) * 4194304 + Math.floor(S[2 * i + 1] / lado);
    const l = celulas.get(k);
    if (l) l.push(i); else celulas.set(k, [i]);
  }
  return { lado, celulas };
}

function grudar(x, y, raioPx = 18) {
  const g = grade, r = raioPx / V.s, S = d.snaps;
  const i1 = Math.floor((x - r) / g.lado), i2 = Math.floor((x + r) / g.lado);
  const j1 = Math.floor((y - r) / g.lado), j2 = Math.floor((y + r) / g.lado);
  // muitas células = zoom bem afastado: não vale grudar
  if ((i2 - i1 + 1) * (j2 - j1 + 1) > 4000) return null;
  let melhor = null, md = r * r;
  for (let i = i1; i <= i2; i++) for (let j = j1; j <= j2; j++) {
    for (const p of g.celulas.get(i * 4194304 + j) || []) {
      const dx = S[2 * p] - x, dy = S[2 * p + 1] - y, dd = dx * dx + dy * dy;
      if (dd < md) { md = dd; melhor = [S[2 * p], S[2 * p + 1]]; }
    }
  }
  return melhor;
}

// ---------- desenho ----------
function redimensionar() {
  const r = tela.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
  if (W && H && d) { V.tx += (nw - W) / 2; V.ty += (nh - H) / 2; }
  W = nw; H = nh;
  tela.width = Math.round(W * dpr); tela.height = Math.round(H * dpr);
  pedirDesenho(true);
}

function ajustar() {
  let [x1, y1, x2, y2] = d.caixa;
  if (folha >= 0) {
    // folha: enquadra o papel inteiro
    const p = papelDaFolha(folhas[folha]), w = p.larg / p.fat / 2, h = p.alt / p.fat / 2;
    [x1, y1, x2, y2] = [p.cx - w, p.cy - h, p.cx + w, p.cy + h];
  }
  const topo = F.$('#painel').classList.contains('hide') ? 10 : 110, baixo = 80;
  const s = Math.min(W / (x2 - x1), (H - topo - baixo) / (y2 - y1)) * 0.98;
  V.s = s > 0 && isFinite(s) ? s : 1;
  V.tx = W / 2 - ((x1 + x2) / 2) * V.s;
  V.ty = topo + (H - topo - baixo) / 2 + ((y1 + y2) / 2) * V.s;
  pedirDesenho(true);
}

// o que está na tela agora, como cena (px CSS)
function cenaTela() {
  const itens = folha >= 0 ? itensDaFolha(folhas[folha], d, vis, V.s, V.tx, V.ty) : [{ D: d, vis, s: V.s, tx: V.tx, ty: V.ty, clip: null }];
  return { larg: W, alt: H, itens };
}

let foto = null, fotoV = null, tempoDesenho = 0, pedido = 0, completoTimer = 0;

function desenharTudo() {
  const t0 = performance.now();
  pintar(ctx, cenaTela(), { k: dpr, fundo: '#15181d', lw: 1 });
  tempoDesenho = performance.now() - t0;
  // guarda a imagem para o arrasto/zoom seguir rápido em desenhos pesados
  if (!foto) foto = document.createElement('canvas');
  foto.width = tela.width; foto.height = tela.height;
  foto.getContext('2d').drawImage(tela, 0, 0);
  fotoV = { ...V };
  desenharMedida();
}

// durante gestos em desenho pesado, mexe a última imagem e redesenha de verdade ao parar
function desenharRapido() {
  const r = V.s / fotoV.s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#15181d';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = r < 1;
  ctx.drawImage(foto, V.tx - fotoV.tx * r, V.ty - fotoV.ty * r, W * r, H * r);
  desenharMedida();
}

function pedirDesenho(completo) {
  if (!d) return;
  if (pedido) cancelAnimationFrame(pedido);
  pedido = requestAnimationFrame(() => {
    pedido = 0;
    if (completo || tempoDesenho < 30 || !foto) { desenharTudo(); return; }
    desenharRapido();
    clearTimeout(completoTimer);
    completoTimer = setTimeout(() => pedirDesenho(true), 180);
  });
}

// ---------- medição na tela ----------
const tx = (x) => x * V.s + V.tx, ty = (y) => -y * V.s + V.ty;
const num = (v, casas = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function desenharMedida() {
  if (folha >= 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let lista = pts;
  if (modo === 'cont' && escolhido >= 0) {
    const a = d.ini[escolhido], b = d.ini[escolhido + 1];
    lista = Array.from(d.pts.subarray(2 * a, 2 * b));
  }
  if (!lista.length) return;
  const fechado = modo === 'area' || modo === 'cont';
  ctx.beginPath();
  for (let i = 0; i < lista.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](tx(lista[i]), ty(lista[i + 1]));
  if (fechado && lista.length >= 6) {
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,214,10,.22)';
    ctx.fill();
  }
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = '#FFD60A';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (modo === 'cont') return;
  // pontos e medida de cada trecho
  ctx.font = '600 13px system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < lista.length; i += 2) {
    ctx.beginPath();
    ctx.arc(tx(lista[i]), ty(lista[i + 1]), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#FFD60A'; ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    if (modo === 'dist' && i >= 2) {
      const mx = (tx(lista[i]) + tx(lista[i - 2])) / 2, my = (ty(lista[i + 1]) + ty(lista[i - 1])) / 2;
      const s = num(Math.hypot(lista[i] - lista[i - 2], lista[i + 1] - lista[i - 1]) * fator) + ' m';
      const w = ctx.measureText(s).width + 10;
      ctx.fillStyle = '#000c'; ctx.fillRect(mx - w / 2, my - 10, w, 20);
      ctx.fillStyle = '#FFD60A'; ctx.fillText(s, mx, my);
    }
  }
}

// texto do painel de medida
function medidas() {
  const painel = F.$('#painel');
  const mostrar = modo !== 'mover';
  painel.classList.toggle('hide', !mostrar);
  if (!mostrar) return;
  let res = '', det = '';
  const n = pts.length / 2;
  const coord = (x, y) => `X ${num(x + d.origem[0], 3)} · Y ${num(y + d.origem[1], 3)}`;
  if (modo === 'dist') {
    if (!n) res = 'Toque no primeiro ponto.';
    else if (n === 1) { res = 'Toque no próximo ponto.'; det = coord(pts[0], pts[1]); }
    else {
      const tot = Cad.comprimento(pts, false) * fator;
      res = (n > 2 ? 'Total: ' : 'Distância: ') + `<b>${num(tot)} m</b>`;
      const dx = Math.abs(pts[2 * n - 2] - pts[2 * n - 4]) * fator, dy = Math.abs(pts[2 * n - 1] - pts[2 * n - 3]) * fator;
      det = (n > 2 ? `${n - 1} trechos · ` : '') + `ΔX ${num(dx)} m · ΔY ${num(dy)} m\n` + coord(pts[2 * n - 2], pts[2 * n - 1]);
    }
  } else if (modo === 'area') {
    if (n < 3) res = n ? `Toque em mais ${3 - n} ponto${3 - n > 1 ? 's' : ''} do contorno.` : 'Toque nos cantos da área, em ordem.';
    else {
      res = `Área: <b>${num(Cad.area(pts) * fator * fator)} m²</b>`;
      det = `Perímetro: ${num(Cad.comprimento(pts, true) * fator)} m · ${n} pontos`;
    }
  } else if (modo === 'cont') {
    if (escolhido < 0) res = 'Toque dentro de uma área fechada (polilinha, círculo ou hachura).';
    else {
      const a = d.ini[escolhido], b = d.ini[escolhido + 1], p = d.pts.subarray(2 * a, 2 * b);
      res = `Área: <b>${num(Cad.area(p) * fator * fator)} m²</b>`;
      det = `Perímetro: ${num(Cad.comprimento(p, true) * fator)} m · camada ${d.camadas[d.cam[escolhido]].nome}`;
    }
  }
  F.$('#res').innerHTML = res;
  F.$('#det').textContent = det;
  F.$('#desfazer').disabled = !(modo === 'dist' || modo === 'area') || !pts.length;
  F.$('#limpar').disabled = !pts.length && escolhido < 0;
}

// polilinha fechada (camada visível) de menor área que contém o ponto
function acharContorno(x, y) {
  const { pts: P, ini, tipo, cam } = d;
  if (!contornos) {
    contornos = [];
    for (let i = 0; i < cam.length; i++) {
      if (!(tipo[i] & 1)) continue;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let j = ini[i]; j < ini[i + 1]; j++) {
        const px = P[2 * j], py = P[2 * j + 1];
        if (px < x1) x1 = px; if (px > x2) x2 = px; if (py < y1) y1 = py; if (py > y2) y2 = py;
      }
      contornos.push([i, x1, y1, x2, y2]);
    }
  }
  let melhor = -1, ma = Infinity;
  for (const [i, x1, y1, x2, y2] of contornos) {
    if (x < x1 || x > x2 || y < y1 || y > y2 || !vis[cam[i]]) continue;
    if ((x2 - x1) * (y2 - y1) >= ma) continue;
    if (!Cad.dentro(x, y, P, ini[i], ini[i + 1])) continue;
    const a = Cad.area(P.subarray(2 * ini[i], 2 * ini[i + 1]));
    if (a > 0 && a < ma) { ma = a; melhor = i; }
  }
  return melhor;
}

function toque(sx, sy) {
  if (modo === 'mover' || folha >= 0) return;
  const x = (sx - V.tx) / V.s, y = -(sy - V.ty) / V.s;
  if (modo === 'cont') {
    escolhido = acharContorno(x, y);
    if (escolhido < 0) F.toast('Nenhuma área fechada aqui.');
  } else {
    const g = grudar(x, y);
    pts.push(...(g || [x, y]));
  }
  medidas();
  pedirDesenho(false);
}

// ---------- gestos: 1 dedo arrasta (ou marca ponto, se for um toque), 2 dedos dão zoom ----------
const dedos = new Map();
let inicio = null, pinca = null;
const pos = (e) => { const r = tela.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

tela.addEventListener('pointerdown', (e) => {
  try { tela.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro já solto */ }
  const p = pos(e);
  dedos.set(e.pointerId, p);
  if (dedos.size === 1) inicio = { x: p.x, y: p.y, t: performance.now(), tx: V.tx, ty: V.ty, mexeu: false };
  if (dedos.size === 2) {
    const [a, b] = [...dedos.values()];
    pinca = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, s: V.s, tx: V.tx, ty: V.ty };
    if (inicio) inicio.mexeu = true;
  }
});
tela.addEventListener('pointermove', (e) => {
  if (!dedos.has(e.pointerId)) return;
  dedos.set(e.pointerId, pos(e));
  if (dedos.size >= 2 && pinca) {
    const [a, b] = [...dedos.values()];
    const k = Math.hypot(a.x - b.x, a.y - b.y) / pinca.dist, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    V.s = pinca.s * k;
    V.tx = cx - (pinca.cx - pinca.tx) * k;
    V.ty = cy - (pinca.cy - pinca.ty) * k;
    pedirDesenho(false);
  } else if (dedos.size === 1 && inicio) {
    const p = pos(e), dx = p.x - inicio.x, dy = p.y - inicio.y;
    if (!inicio.mexeu && Math.hypot(dx, dy) > 8) inicio.mexeu = true;
    if (inicio.mexeu) { V.tx = inicio.tx + dx; V.ty = inicio.ty + dy; pedirDesenho(false); }
  }
});
function soltar(e) {
  if (!dedos.has(e.pointerId)) return;
  dedos.delete(e.pointerId);
  if (dedos.size < 2) pinca = null;
  if (dedos.size === 0) {
    if (inicio && !inicio.mexeu && e.type === 'pointerup' && performance.now() - inicio.t < 700) toque(inicio.x, inicio.y);
    inicio = null;
    pedirDesenho(true);
  } else if (dedos.size === 1) {
    // sobrou um dedo depois da pinça: continua arrastando a partir dele
    const [a] = [...dedos.values()];
    inicio = { x: a.x, y: a.y, t: 0, tx: V.tx, ty: V.ty, mexeu: true };
  }
}
tela.addEventListener('pointerup', soltar);
tela.addEventListener('pointercancel', soltar);
tela.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 33 : 1));
  const p = pos(e);
  V.tx = p.x - (p.x - V.tx) * k;
  V.ty = p.y - (p.y - V.ty) * k;
  V.s *= k;
  pedirDesenho(false);
}, { passive: false });

// ---------- botões ----------
function definirModo(m) {
  modo = m;
  document.querySelectorAll('[data-modo]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.modo === m)));
  tela.classList.toggle('medindo', modo !== 'mover');
  pts = []; escolhido = -1;
  medidas();
  pedirDesenho(false);
}
document.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => definirModo(b.dataset.modo)));
F.$('#desfazer').addEventListener('click', () => { pts.splice(-2, 2); medidas(); pedirDesenho(false); });
F.$('#limpar').addEventListener('click', () => { pts = []; escolhido = -1; medidas(); pedirDesenho(false); });
F.$('#unid').addEventListener('change', () => {
  fator = +F.$('#unid').value;
  try { localStorage.setItem('dwg-unid', String(fator)); } catch (e) { /* só não lembra */ }
  medidas();
  pedirDesenho(false);
});
F.$('#b-ajustar').addEventListener('click', ajustar);

function listarCamadas() {
  const ordem = d.camadas.map((c, i) => i).sort((a, b) => d.camadas[a].nome.localeCompare(d.camadas[b].nome, 'pt-BR', { numeric: true }));
  F.$('#lista-cam').replaceChildren(...ordem.map((i) => {
    const l = document.createElement('label');
    l.innerHTML = '<input type="checkbox"><i></i><span></span>';
    const cb = l.querySelector('input');
    cb.checked = vis[i];
    cb.addEventListener('change', () => { vis[i] = cb.checked; escolhido = -1; medidas(); pedirDesenho(true); });
    l.querySelector('i').style.background = hex(legivel(d.camadas[i].cor));
    l.querySelector('span').textContent = d.camadas[i].nome;
    return l;
  }));
}
const todas = (v) => { vis = vis.map(() => v); listarCamadas(); escolhido = -1; medidas(); pedirDesenho(true); };
F.$('#cam-todas').addEventListener('click', () => todas(true));
F.$('#cam-nenhuma').addEventListener('click', () => todas(false));
const painelCamadas = (abrir) => {
  F.$('#camadas').classList.toggle('hide', !abrir);
  F.$('#b-camadas').setAttribute('aria-pressed', String(abrir));
  if (abrir && typeof fecharExportar === 'function') fecharExportar();
};
F.$('#b-camadas').addEventListener('click', () => painelCamadas(F.$('#camadas').classList.contains('hide')));
F.$('#cam-fechar').addEventListener('click', () => painelCamadas(false));

// altura real do topo (o visualizador começa logo abaixo)
const ajustarTopo = () => document.documentElement.style.setProperty('--topo', F.$('.topo').offsetHeight + 'px');
new ResizeObserver(() => { ajustarTopo(); if (d) redimensionar(); }).observe(document.body);
ajustarTopo();
