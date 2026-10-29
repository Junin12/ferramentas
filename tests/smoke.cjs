// Teste rápido das Ferramentas antes de publicar: abre todas as páginas guardadas pelo sw.js e confere o que mais quebra.
// Uso: node tests/smoke.cjs   (precisa do pacote "playwright" com o Chromium; as bibliotecas vêm dos CDNs)
const { chromium, devices } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RAIZ = path.join(__dirname, "..");
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => {
  const f = path.join(RAIZ, decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!f.startsWith(RAIZ)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": TIPOS[path.extname(f)] || "application/octet-stream" }); r.end(b); });
});
const falhas = [], confere = (ok, msg) => { console.log(`${ok ? "ok  " : "FALHA"} ${msg}`); if (!ok) falhas.push(msg); };
// PDF mínimo de uma página (para o Medir na prancha)
const PDF = (() => { const o = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>", "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>"];
  let s = "%PDF-1.4\n", x = []; o.forEach((t, i) => { x.push(s.length); s += `${i + 1} 0 obj\n${t}\nendobj\n`; });
  const xr = s.length; s += `xref\n0 ${o.length + 1}\n0000000000 65535 f \n` + x.map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<</Size ${o.length + 1}/Root 1 0 R>>\nstartxref\n${xr}\n%%EOF`; return s; })();

(async () => {
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const sw = fs.readFileSync(path.join(RAIZ, "sw.js"), "utf8"), app = [...sw.match(/const APP = \[(.*?)\];/s)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  // todo arquivo da lista do sw.js existe (senão a instalação do cache falha inteira no celular)
  const faltam = app.filter(p => !fs.existsSync(path.join(RAIZ, p.endsWith("/") || p === "./" ? path.join(p, "index.html") : p)));
  confere(!faltam.length, "arquivos do sw.js existem" + (faltam.length ? `: faltam ${faltam.join(", ")}` : ""));
  const nav = await chromium.launch(), ctx = await nav.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
  const paginas = ["", ...app.filter(p => p.endsWith("/") && p !== "./")];
  const ruins = [];
  for (const p of paginas) {
    const pg = await ctx.newPage(), er = []; pg.on("pageerror", e => er.push(e.message));
    await pg.goto(base + p); await pg.waitForTimeout(400);
    const larg = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (er.length || larg) ruins.push(`${p || "início"}: ${er[0] || "rolagem para o lado"}`);
    await pg.close();
  }
  confere(!ruins.length, `${paginas.length} páginas abrem sem erro e sem rolagem para o lado` + (ruins.length ? `: ${ruins.slice(0, 4).join(" | ")}` : ""));
  // busca da tela inicial
  const h = await ctx.newPage(); await h.goto(base); await h.fill("#q", "cubicagem"); await h.waitForTimeout(300);
  const r1 = await h.$$eval("#grade .ferr b", bs => bs.map(b => b.textContent));
  await h.fill("#q", "jutnar pdf"); await h.waitForTimeout(300);
  const r2 = await h.$$eval("#grade .ferr b", bs => bs.map(b => b.textContent));
  confere(r1[0] === "Calculadora de obra" && r2[0] === "Juntar PDFs" && r2.some(t => /nas normas/.test(t)), `busca na tela inicial: ${r1[0]} · ${r2[0]}`);
  // Wigo → Medir na prancha: o PDF guardado no cache "ferr-wigo" abre sozinho
  await h.evaluate(async pdf => { const c = await caches.open("ferr-wigo"); await c.put("/ferr-wigo/entrada/pdf", new Response(new Blob([pdf], { type: "application/pdf" }), { headers: { "X-Nome": "prancha%20teste.pdf" } })); }, PDF);
  await h.goto(base + "medir-pdf/?de=wigo&doc=wigo"); await h.waitForTimeout(2500);
  confere(await h.evaluate(async () => !document.getElementById("area").classList.contains("hide") && !(await (await caches.open("ferr-wigo")).match("/ferr-wigo/entrada/pdf"))), "prancha mandada pelo Wigo abre no Medir na prancha");
  // Ferramentas → Wigo: botão aparece só dentro do Wigo e a saída vai para o cache
  await h.goto(base + "escanear/?de=wigo"); await h.waitForTimeout(300);
  const temBt = await h.evaluate(() => [...document.querySelectorAll("button")].some(b => /Guardar no Wigo/.test(b.textContent)));
  const n = await h.evaluate(async () => { await F.paraWigo([{ nome: "a.jpg", blob: new Blob(["x"], { type: "image/jpeg" }) }], "Documento: teste"); return (await (await caches.open("ferr-wigo")).keys()).filter(k => /\/saida\//.test(k.url)).length; });
  await h.goto(base + "escanear/"); await h.evaluate(() => sessionStorage.clear()); await h.goto(base + "escanear/"); await h.waitForTimeout(300);
  const semBt = await h.evaluate(() => ![...document.querySelectorAll("button")].some(b => /Guardar no Wigo/.test(b.textContent)));
  confere(temBt && semBt && n === 1, "Escanear: “Guardar no Wigo” só dentro do Wigo e o arquivo vai para o cache");
  await nav.close(); srv.close();
  if (falhas.length) { console.log(`\n${falhas.length} falha(s): não publique.`); process.exit(1); }
  console.log("\nTudo certo.");
})().catch(e => { console.error(e); process.exit(1); });
