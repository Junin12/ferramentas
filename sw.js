// Guarda as ferramentas no aparelho para abrir sem internet.
// Ao alterar qualquer arquivo, suba o número da versão para os aparelhos receberem a atualização.
const VERSAO = 'ferramentas-v23';
// bibliotecas do cdnjs e do jsdelivr (versão fixa no endereço; o leitor de DWG tem ~10 MB): cache próprio, que sobrevive às atualizações
const LIBS_CACHE = 'ferramentas-libs-1';
const APP = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'comum/base.css', 'comum/base.js',
  'pdf/', 'pdf/app.js', 'pdf/lib.js', 'juntar/', 'dividir/', 'imagem-para-pdf/', 'comprimir/', 'pdf-para-imagem/', 'whatsapp/', 'dwg/', 'dwg/app.js', 'dwg/lib.js', 'dwg/leitor.js', 'dwg/dxf.js', 'dwg/pintar.js', 'dwg/exportar.js',
  'area/', 'area/geo.js', 'area/app.js', 'area/exportar.js', 'obra/', 'obra/desenhos.js', 'obra/calcs.js', 'obra/app.js',
  'escanear/', 'assinar/', 'qr/', 'nivel/', 'coordenadas/', 'medir-pdf/', 'sinapi/', 'normas/', 'nbr6118/', 'comum/normas.css', 'comum/normas.js', 'nbr12655/', 'nbr14931/', 'nbr15696/', 'nbr6120/', 'nbr6122/', 'nbr16868/', 'nbr7480/',
  'nbr5738/', 'nbr16889/', 'nbr7211/', 'nbr7182/', 'nbr6484/', 'nbr12266/', 'nbr9649/', 'nbr12218/', 'nr18/', 'nr35/', 'nr33/', 'nr6/', 'nbr15575/', 'nbr9050/', 'gerar-qr/', 'prazos/', 'fotos/', 'antes-depois/', 'planilhas/'];
// imagens do mapa (satélite da Esri): guardadas ao serem vistas, para o mapa aparecer em campo sem internet
const MAPA_CACHE = 'ferramentas-mapa-1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO)
    .then((c) => c.addAll(APP.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('ferramentas-v') && k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// tenta a rede por até `ms`; se não vier, usa o que está guardado
const comPrazo = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    // arquivos das ferramentas: primeiro a rede (versão mais nova), sem sinal a cópia guardada
    e.respondWith((async () => {
      const c = await caches.open(VERSAO);
      const rede = fetch(req, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
      const r = await comPrazo(rede, 4000);
      if (r && r.ok) return r;
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) { e.waitUntil(rede); return hit; }
      return (await rede) || Response.error();
    })());
  } else if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.sheetjs.com' || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@'))) {
    e.respondWith((async () => {
      const L = await caches.open(LIBS_CACHE);
      const hit = await L.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') L.put(req, r.clone());
      return r;
    })());
  } else if (url.hostname === 'server.arcgisonline.com' && url.pathname.includes('/tile/')) {
    e.respondWith((async () => {
      const M = await caches.open(MAPA_CACHE);
      const hit = await M.match(req.url);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) M.put(req.url, r.clone());
      return r;
    })());
  }
});
