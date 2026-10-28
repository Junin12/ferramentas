// Medir área no mapa: GPS do celular marcando vértices (com média parado) ou gravando a trilha, ou toques no mapa.
// As áreas ficam no localStorage; a conta da área e da margem de erro está em geo.js.
'use strict';

const $ = F.$;
const CHAVE = 'mapa-areas', CHAVE_ATUAL = 'mapa-atual', CHAVE_CONF = 'mapa-config';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const TILES = {
  sat: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}',
  nomes: ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  ruas: ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}',
};
// zoom máximo das imagens da Esri que existe na maior parte do Brasil; acima disso a imagem é ampliada
const ZMAX_IMG = 18;
const ATRIB_SAT = 'Imagens © Esri, Maxar, Earthstar Geographics';

let areas = [], atual = null, historico = [];
let modo = 'v';
const conf = { intervalo: 5, tempo: 20, limite: 15, camada: 'sat' };
let fix = null, watchId = null, seguir = true, centrouUmaVez = false;
let trilha = null, coleta = null, trava = null;

// ---------- guardar no aparelho ----------
function lerJson(chave, padrao) { try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch (e) { return padrao; } }
function gravar() {
  atual.mod = Date.now();
  if (!areas.includes(atual)) { if (!atual.pts.length) return; areas.unshift(atual); }
  try {
    localStorage.setItem(CHAVE, JSON.stringify(areas));
    localStorage.setItem(CHAVE_ATUAL, JSON.stringify(atual.id));
  } catch (e) { F.toast('Não consegui guardar no aparelho (memória cheia?). Exporte a área para não perder.', true); }
}
function novaArea() {
  const d = new Date();
  atual = { id: d.getTime().toString(36), nome: 'Área ' + d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), criada: d.getTime(), pts: [] };
  historico = [];
  pararTrilha();
  redesenhar();
}
function abrirArea(a) {
  pararTrilha();
  atual = a; historico = [];
  try { localStorage.setItem(CHAVE_ATUAL, JSON.stringify(a.id)); } catch (e) { /* segue */ }
  redesenhar();
  verTudo();
}

// alteração dos pontos: guarda o estado anterior para o desfazer
function alterar(fn) {
  historico.push(JSON.stringify(atual.pts));
  if (historico.length > 60) historico.shift();
  fn(atual.pts);
  gravar();
  redesenhar();
}
const arred = (p) => ({ ...p, la: Math.round(p.la * 1e8) / 1e8, lo: Math.round(p.lo * 1e8) / 1e8, s: Math.round(p.s * 100) / 100 });

// ---------- mapa ----------
if (!F.libs('L')) throw new Error('Leaflet não carregou');
const mapa = L.map('mapa', { zoomControl: false, maxZoom: 21, tap: false }).setView([-15.8, -47.9], 4);
L.control.scale({ imperial: false, position: 'topright' }).addTo(mapa);
const opTile = { maxNativeZoom: ZMAX_IMG, maxZoom: 21, crossOrigin: true };
const fundos = {
  sat: L.layerGroup([L.tileLayer(TILES.sat, { ...opTile, attribution: ATRIB_SAT }), L.tileLayer(TILES.nomes, { ...opTile, opacity: 0.9 })]),
  ruas: L.tileLayer(TILES.ruas, { ...opTile, maxNativeZoom: 19, attribution: 'Mapa © Esri, HERE, Garmin, OpenStreetMap' }),
};
mapa.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

const camPoligono = L.layerGroup().addTo(mapa), camPontos = L.layerGroup().addTo(mapa), camEu = L.layerGroup().addTo(mapa);
const euCirculo = L.circle([0, 0], { radius: 1, color: '#1a73e8', weight: 1, fillOpacity: 0.15, interactive: false });
const euPonto = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="eu"></div>', iconSize: [18, 18] }), interactive: false, keyboard: false });

function usarFundo(c) {
  conf.camada = c;
  Object.values(fundos).forEach((f) => mapa.removeLayer(f));
  fundos[c].addTo(mapa);
}

const iconeVertice = (i, t) => L.divIcon({ className: '', html: `<div class="vt ${t}">${t === 't' ? '' : i + 1}</div>`, iconSize: t === 't' ? [12, 12] : [22, 22] });

function redesenhar() {
  camPoligono.clearLayers();
  camPontos.clearLayers();
  const pts = atual.pts, ll = pts.map((p) => [p.la, p.lo]), editar = modo === 'm';
  document.body.classList.toggle('edit', editar);
  if (pts.length >= 3) L.polygon(ll, { color: '#FFD60A', weight: 3, fillColor: '#FFD60A', fillOpacity: 0.18, interactive: false }).addTo(camPoligono);
  else if (pts.length === 2) L.polyline(ll, { color: '#FFD60A', weight: 3, interactive: false }).addTo(camPoligono);

  // trilha com muitos pontos: só a linha (os marcadores aparecem ao editar)
  const mostrarTodos = editar || pts.length <= 150;
  pts.forEach((p, i) => {
    if (p.t === 't' && !mostrarTodos) return;
    const m = L.marker([p.la, p.lo], { icon: iconeVertice(i, p.t), draggable: editar, keyboard: false, title: `P${i + 1}`, zIndexOffset: p.t === 't' ? 0 : 100 }).addTo(camPontos);
    if (editar) {
      m.on('dragend', () => { const q = m.getLatLng(); alterar((v) => { v[i] = arred({ ...v[i], la: q.lat, lo: q.lng, t: 'm', s: Math.max(v[i].s, sMapa()) }); }); });
      m.on('click', () => popupPonto(m, i));
    } else {
      m.bindTooltip(`P${i + 1} · precisão ±${Geo.num(p.s * 1.5, 1)} m`, { direction: 'top', offset: [0, -10] });
    }
  });
  // ao editar: alças no meio de cada lado para inserir um ponto
  if (editar && pts.length >= 2 && pts.length <= 300) {
    const n = pts.length, lados = n >= 3 ? n : 1;
    for (let i = 0; i < lados; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      // lado curto na tela (trilha, zoom longe): sem alça, para não cobrir os pontos
      if (mapa.latLngToLayerPoint([a.la, a.lo]).distanceTo(mapa.latLngToLayerPoint([b.la, b.lo])) < 60) continue;
      const meio = L.marker([(a.la + b.la) / 2, (a.lo + b.lo) / 2], { icon: L.divIcon({ className: '', html: '<div class="vt m" style="opacity:.55;transform:scale(.7)">+</div>', iconSize: [22, 22] }), draggable: true, keyboard: false, title: 'Arraste para criar um ponto' }).addTo(camPontos);
      const inserir = () => { const q = meio.getLatLng(); alterar((v) => v.splice(i + 1, 0, arred({ la: q.lat, lo: q.lng, s: sMapa(), t: 'm' }))); };
      meio.on('dragend', inserir);
      meio.on('click', inserir);
    }
  }
  // comprimento dos lados (só com poucos vértices, senão polui)
  if (pts.length >= 2 && pts.length <= 30 && !pts.some((p) => p.t === 't')) {
    const n = pts.length;
    for (let i = 0; i < (n >= 3 ? n : 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      L.tooltip({ permanent: true, direction: 'center', className: 'rotulo', interactive: false })
        .setLatLng([(a.la + b.la) / 2, (a.lo + b.lo) / 2]).setContent(Geo.fmtDist(Geo.distancia(a, b))).addTo(camPoligono);
    }
  }
  atualizarPlaca();
  atualizarBotoes();
}

function popupPonto(m, i) {
  const div = document.createElement('div');
  div.innerHTML = `<b>P${i + 1}</b><br><small></small><br><button type="button" class="mini perigo" style="margin-top:6px">Apagar ponto</button>`;
  const p = atual.pts[i];
  div.querySelector('small').textContent = `${p.la.toFixed(7)}, ${p.lo.toFixed(7)} · ±${Geo.num(p.s * 1.5, 1)} m`;
  div.querySelector('button').onclick = () => { mapa.closePopup(); alterar((v) => v.splice(i, 1)); };
  m.bindPopup(div).openPopup();
}

// ponto tocado no mapa: a imagem de satélite costuma estar deslocada alguns metros; e o dedo erra conforme o zoom
const sMapa = () => Math.max(2.5, 40075016 * Math.cos(mapa.getCenter().lat * Math.PI / 180) / 2 ** (mapa.getZoom() + 8) * 4);

mapa.on('click', (e) => {
  if (modo !== 'm') return;
  alterar((v) => v.push(arred({ la: e.latlng.lat, lo: e.latlng.lng, s: sMapa(), t: 'm' })));
});
mapa.on('dragstart', () => { if (seguir) definirSeguir(false); });
// as alças do meio dos lados dependem do zoom
mapa.on('zoomend', () => { if (modo === 'm') redesenhar(); });

function verTudo() {
  if (atual.pts.length >= 2) mapa.fitBounds(L.latLngBounds(atual.pts.map((p) => [p.la, p.lo])), { padding: [60, 60], maxZoom: 19 });
  else if (atual.pts.length === 1) mapa.setView([atual.pts[0].la, atual.pts[0].lo], 18);
  else if (fix) mapa.setView([fix.la, fix.lo], 18);
}

// ---------- placa com a medida ----------
function atualizarPlaca() {
  const pts = atual.pts;
  $('#medida').hidden = !pts.length;
  if (!pts.length) return;
  const m = Geo.medir(pts);
  if (pts.length < 3) {
    $('#m-area').textContent = pts.length === 1 ? '1 ponto' : Geo.fmtDist(m.perimetro);
    $('#m-margem').textContent = 'Marque pelo menos 3 pontos para formar a área';
    $('#m-perim').textContent = '';
    return;
  }
  $('#m-area').textContent = Geo.fmtArea(m.area);
  const rel = m.area ? m.margem / m.area * 100 : 0;
  $('#m-margem').textContent = `± ${Geo.num(m.margem, 0)} m² (${Geo.num(rel, rel < 10 ? 1 : 0)}%) de margem`;
  $('#m-perim').textContent = `Perímetro ${Geo.fmtDist(m.perimetro)} · ${pts.length} pontos`;
}

// ---------- GPS ----------
function ligarGps() {
  if (watchId !== null) return true;
  if (!navigator.geolocation) { F.toast('Este navegador não dá acesso ao GPS.', true); return false; }
  textoGps('Procurando satélites…', '');
  watchId = navigator.geolocation.watchPosition(novaPosicao, erroGps, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  manterTela(true);
  return true;
}
function textoGps(txt, cls) { $('#gps-txt').textContent = txt; $('#gps').className = 'gps ' + cls; }

function novaPosicao(p) {
  const c = p.coords;
  fix = { la: c.latitude, lo: c.longitude, acc: c.accuracy, quando: Date.now() };
  const cls = fix.acc <= 5 ? 'bom' : fix.acc <= 12 ? 'medio' : 'ruim';
  textoGps(`GPS ±${Geo.num(fix.acc, fix.acc < 10 ? 1 : 0)} m` + (fix.acc > conf.limite ? ' · sinal fraco' : ''), cls);
  euPonto.setLatLng([fix.la, fix.lo]);
  euCirculo.setLatLng([fix.la, fix.lo]).setRadius(fix.acc);
  if (!camEu.hasLayer(euPonto)) { camEu.addLayer(euCirculo); camEu.addLayer(euPonto); }
  if (!centrouUmaVez) { centrouUmaVez = true; if (!atual.pts.length) mapa.setView([fix.la, fix.lo], 18); }
  else if (seguir) mapa.panTo([fix.la, fix.lo], { animate: true });
  if (fix.acc <= conf.limite) {
    if (coleta) coleta.leituras.push(fix);
    if (trilha) trilha.buf.push(fix);
  }
  if (coleta) atualizarColeta();
}
function erroGps(e) {
  if (e.code === 1) {
    pararGps();
    textoGps('Sem permissão para o GPS', 'ruim');
    F.toast('Permita o acesso à localização (precisa) para este site nas configurações do navegador.', true);
  } else textoGps(e.code === 3 ? 'Sem sinal do GPS… vá para céu aberto' : 'GPS indisponível no momento', 'ruim');
}
function pararGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  manterTela(false);
}

// tela acesa enquanto o GPS trabalha: com a tela apagada o navegador para de receber a posição
async function manterTela(ligar) {
  try {
    if (ligar && !trava && navigator.wakeLock && document.visibilityState === 'visible') {
      trava = await navigator.wakeLock.request('screen');
      trava.addEventListener('release', () => { trava = null; });
    } else if (!ligar && trava) { await trava.release(); trava = null; }
  } catch (e) { /* sem suporte ou negado: segue */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && watchId !== null) manterTela(true); });

function definirSeguir(v) {
  seguir = v;
  $('#b-seguir').setAttribute('aria-pressed', String(v));
  if (v && fix) mapa.setView([fix.la, fix.lo], Math.max(mapa.getZoom(), 17));
}

// ---------- vértice: parado, média das leituras ----------
function iniciarColeta() {
  if (!ligarGps()) return;
  coleta = { leituras: [], ini: Date.now(), dur: conf.tempo * 1000, timer: setInterval(atualizarColeta, 250) };
  $('#c-tit').textContent = `Fique parado no vértice P${atual.pts.length + 1}…`;
  $('#coleta').hidden = false;
  atualizarColeta();
}
function atualizarColeta() {
  if (!coleta) return;
  const t = Date.now() - coleta.ini, n = coleta.leituras.length;
  $('#c-prog').value = Math.min(1, t / coleta.dur);
  $('#c-usar').disabled = !n;
  if (!n) {
    $('#c-info').textContent = fix && Date.now() - fix.quando < 15000 ? `Sinal fraco (±${Geo.num(fix.acc, 0)} m). Aguardando leitura melhor que ±${conf.limite} m…` : 'Aguardando o GPS…';
    return;
  }
  const v = Geo.mediaVertice(coleta.leituras);
  $('#c-info').textContent = `${n} leitura${n > 1 ? 's' : ''} · precisão ±${Geo.num(v.s * 1.5, 1)} m · ${Math.max(0, Math.ceil((coleta.dur - t) / 1000))} s`;
  if (t >= coleta.dur && n >= 3) concluirColeta();
}
function concluirColeta() {
  const v = Geo.mediaVertice(coleta.leituras);
  fecharColeta();
  if (!v) return;
  alterar((pts) => pts.push(arred(v)));
  if (navigator.vibrate) navigator.vibrate(120);
  F.toast(`Vértice P${atual.pts.length} marcado (±${Geo.num(v.s * 1.5, 1)} m). Vá para o próximo.`);
}
function fecharColeta() {
  if (coleta) clearInterval(coleta.timer);
  coleta = null;
  $('#coleta').hidden = true;
}
$('#c-usar').onclick = concluirColeta;
$('#c-cancelar').onclick = fecharColeta;

// ---------- trilha: um ponto a cada X segundos andando ----------
function iniciarTrilha() {
  if (!ligarGps()) return;
  trilha = { buf: [], timer: setInterval(pontoTrilha, conf.intervalo * 1000) };
  definirSeguir(true);
  atualizarBotoes();
  F.toast(`Gravando: um ponto a cada ${conf.intervalo} s. Ande pela divisa da área.`);
}
function pararTrilha() {
  if (!trilha) return;
  clearInterval(trilha.timer);
  trilha = null;
  atualizarBotoes();
}
function pontoTrilha() {
  // média curta das leituras desde o último ponto (suaviza os saltos do GPS)
  const buf = trilha.buf.splice(0);
  if (!buf.length) { if (fix && fix.acc > conf.limite) F.toast(`Sinal fraco (±${Geo.num(fix.acc, 0)} m): ponto não gravado.`, true); return; }
  const p = Geo.mediaVertice(buf);
  p.t = 't';
  const ult = atual.pts[atual.pts.length - 1];
  // parado: não repete o ponto
  if (ult && Geo.distancia(ult, p) < Math.max(1, p.s)) return;
  alterar((pts) => pts.push(arred(p)));
}

// ---------- barra de baixo ----------
const DICAS = {
  v: 'Pare em cada canto da área e toque em “Marcar vértice”. O app faz a média das leituras do GPS.',
  t: 'Ande pela divisa: um ponto é gravado a cada intervalo. Ideal para cercas e divisas curvas.',
  m: 'Toque no mapa para pôr pontos. Arraste os pontos para ajustar; toque num ponto para apagar.',
};
function atualizarBotoes() {
  const b = $('#b-acao');
  $('#dica').textContent = DICAS[modo];
  b.disabled = false;
  if (modo === 'v') b.textContent = `Marcar vértice P${atual.pts.length + 1}`;
  else if (modo === 't') b.textContent = trilha ? '⏸ Pausar trilha' : atual.pts.some((p) => p.t === 't') ? '▶ Continuar trilha' : '▶ Iniciar trilha';
  else { b.textContent = 'Ver a área inteira'; }
  $('#b-desfazer').disabled = !historico.length;
}
document.querySelectorAll('input[name="modo"]').forEach((r) => r.addEventListener('change', () => {
  modo = r.value;
  if (modo !== 't') pararTrilha();
  if (modo === 'm') definirSeguir(false);
  fecharColeta();
  redesenhar();
}));
$('#b-acao').onclick = () => {
  if (modo === 'v') iniciarColeta();
  else if (modo === 't') (trilha ? pararTrilha() : iniciarTrilha());
  else verTudo();
};
$('#b-desfazer').onclick = () => {
  if (!historico.length) return;
  atual.pts = JSON.parse(historico.pop());
  gravar();
  redesenhar();
};
$('#b-seguir').onclick = () => { if (!fix) { ligarGps(); definirSeguir(true); return; } definirSeguir(!seguir); };
$('#b-ver').onclick = verTudo;
$('#b-camada').onclick = () => { usarFundo(conf.camada === 'sat' ? 'ruas' : 'sat'); salvarConf(); };

// ---------- folhas: menu e lista ----------
function abrirFolha(id) { $(id).hidden = false; }
document.querySelectorAll('.folha').forEach((f) => {
  f.addEventListener('click', (e) => { if (e.target === f || e.target.closest('[data-fechar]')) f.hidden = true; });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.folha').forEach((f) => (f.hidden = true)); });

$('#b-menu').onclick = () => {
  $('#nome').value = atual.nome;
  const m = Geo.medir(atual.pts);
  $('#resumo').textContent = atual.pts.length >= 3
    ? `${Geo.fmtArea(m.area)} ± ${Geo.num(m.margem, 0)} m² · perímetro ${Geo.fmtDist(m.perimetro)} · ${atual.pts.length} pontos. No plano UTM (como o CAD mede): ${Geo.num(m.utm, 1)} m².`
    : 'Marque pelo menos 3 pontos para exportar a área.';
  document.querySelectorAll('#exportar button').forEach((b) => (b.disabled = atual.pts.length < 3));
  abrirFolha('#menu');
};
$('#nome').addEventListener('input', () => { atual.nome = $('#nome').value.trim() || 'Área sem nome'; if (atual.pts.length) gravar(); });
$('#b-nova').onclick = $('#b-nova2').onclick = () => { document.querySelectorAll('.folha').forEach((f) => (f.hidden = true)); novaArea(); F.toast('Nova área. Marque o primeiro ponto.'); };
$('#b-apagar').onclick = () => {
  if (atual.pts.length && !confirm(`Apagar “${atual.nome}”? Não dá para desfazer.`)) return;
  areas = areas.filter((a) => a !== atual);
  try { localStorage.setItem(CHAVE, JSON.stringify(areas)); } catch (e) { /* segue */ }
  $('#menu').hidden = true;
  novaArea();
};

$('#b-areas').onclick = () => {
  const ul = $('#lista-areas');
  ul.replaceChildren();
  if (!areas.length) { const li = document.createElement('li'); li.className = 'info'; li.textContent = 'Nenhuma área guardada ainda.'; ul.append(li); }
  for (const a of areas) {
    const li = document.createElement('li');
    li.className = 'item' + (a === atual ? ' atual' : '');
    li.tabIndex = 0;
    li.innerHTML = '<span class="nm"><b></b><small></small></span>';
    li.querySelector('b').textContent = a.nome;
    const m = Geo.medir(a.pts);
    li.querySelector('small').textContent = (a.pts.length >= 3 ? Geo.fmtArea(m.area) : `${a.pts.length} ponto(s)`) + ' · ' + new Date(a.mod || a.criada).toLocaleDateString('pt-BR');
    const abrir = () => { $('#areas').hidden = true; abrirArea(a); };
    li.onclick = abrir;
    li.onkeydown = (e) => { if (e.key === 'Enter') abrir(); };
    ul.append(li);
  }
  abrirFolha('#areas');
};

// ---------- opções ----------
function salvarConf() { try { localStorage.setItem(CHAVE_CONF, JSON.stringify(conf)); } catch (e) { /* segue */ } }
for (const [id, k] of [['#op-intervalo', 'intervalo'], ['#op-tempo', 'tempo'], ['#op-limite', 'limite']]) {
  $(id).addEventListener('change', () => {
    conf[k] = +$(id).value;
    salvarConf();
    if (k === 'intervalo' && trilha) { pararTrilha(); iniciarTrilha(); }
  });
}

// mapa sem internet: baixa as imagens da região visível (o service worker guarda), até o zoom máximo
$('#b-offline').onclick = () => F.trabalhando($('#b-offline'), async (prog) => {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) throw new Error('Abra o site pelo endereço https e recarregue a página uma vez antes de guardar o mapa.');
  const b = atual.pts.length >= 2 ? L.latLngBounds(atual.pts.map((p) => [p.la, p.lo])).pad(0.5) : mapa.getBounds();
  const urls = [];
  const z0 = Math.max(10, Math.min(mapa.getZoom(), 16) - 2);
  for (let z = z0; z <= ZMAX_IMG; z++) {
    const p1 = mapa.project(b.getNorthWest(), z).divideBy(256).floor(), p2 = mapa.project(b.getSouthEast(), z).divideBy(256).floor();
    for (let x = p1.x; x <= p2.x; x++) for (let y = p1.y; y <= p2.y; y++) {
      for (const t of [TILES.sat, TILES.nomes]) urls.push(t.replace('{z}', z).replace('{y}', y).replace('{x}', x));
    }
    if (urls.length > 3000) { urls.length = Math.min(urls.length, 3000); break; }
  }
  let feitos = 0, falhas = 0;
  const fila = [...urls];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (fila.length) {
      const u = fila.shift();
      try { const r = await fetch(u, { mode: 'cors' }); if (!r.ok) falhas++; } catch (e) { falhas++; }
      prog(`Guardando o mapa… ${Math.round(++feitos / urls.length * 100)}%`);
    }
  }));
  F.toast(falhas > urls.length / 4 ? 'Parte do mapa não baixou. Verifique a internet e tente de novo.' : `Mapa da região guardado (${urls.length / 2} quadros). Sem internet ele continua aparecendo.`, falhas > urls.length / 4);
});

// ---------- início ----------
Object.assign(conf, lerJson(CHAVE_CONF, {}));
$('#op-intervalo').value = conf.intervalo; $('#op-tempo').value = conf.tempo; $('#op-limite').value = conf.limite;
usarFundo(conf.camada in fundos ? conf.camada : 'sat');
areas = lerJson(CHAVE, []).filter((a) => a && Array.isArray(a.pts));
const ultima = areas.find((a) => a.id === lerJson(CHAVE_ATUAL, null)) || null;
if (ultima) abrirArea(ultima); else novaArea();
if (!ultima || !ultima.pts.length) {
  // já tem permissão? então mostra onde a pessoa está sem precisar tocar em nada
  if (navigator.permissions) navigator.permissions.query({ name: 'geolocation' }).then((r) => { if (r.state === 'granted') ligarGps(); }).catch(() => {});
}
definirSeguir(!ultima || !ultima.pts.length);
// sair no meio da trilha ou da coleta
window.addEventListener('beforeunload', (e) => { if (trilha || coleta) { e.preventDefault(); e.returnValue = ''; } });
