// Contas de geodésia para medir áreas com o GPS (SIRGAS 2000 = elipsoide GRS80). Sem tela: dá para testar no Node.
// Ponto: { la, lo (graus), s (erro provável de cada eixo, em metros: 1 desvio-padrão), t ('v' vértice com média, 't' trilha, 'm' tocado no mapa) }
'use strict';

const Geo = (() => {
  const a = 6378137, fl = 1 / 298.257222101, e2 = fl * (2 - fl), ep2 = e2 / (1 - e2);
  const RAD = Math.PI / 180;
  const raios = (la) => { const s = Math.sin(la * RAD), w = 1 - e2 * s * s; return { N: a / Math.sqrt(w), M: a * (1 - e2) / (w * Math.sqrt(w)) }; };

  // plano local de áreas iguais: x = Δλ·N·cosφ, y = arco de meridiano. A área medida nele é a área real sobre o
  // elipsoide (a do terreno, sem a deformação da projeção UTM), com erro desprezível para áreas de alguns quilômetros.
  function plano(pts) {
    const la0 = pts.reduce((s, p) => s + p.la, 0) / pts.length, lo0 = pts.reduce((s, p) => s + p.lo, 0) / pts.length;
    return pts.map((p) => [(p.lo - lo0) * RAD * raios(p.la).N * Math.cos(p.la * RAD), (p.la - la0) * RAD * raios((p.la + la0) / 2).M]);
  }

  const areaPlana = (xy) => {
    let s = 0;
    for (let i = 0, n = xy.length; i < n; i++) { const p = xy[i], q = xy[(i + 1) % n]; s += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(s) / 2;
  };

  // distância entre dois pontos próximos (até alguns km), com os raios do elipsoide na latitude média
  function distancia(p, q) {
    const { N, M } = raios((p.la + q.la) / 2);
    const dx = (q.lo - p.lo) * RAD * N * Math.cos((p.la + q.la) / 2 * RAD), dy = (q.la - p.la) * RAD * M;
    return Math.hypot(dx, dy);
  }
  const perimetro = (pts, fechada = true) => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += distancia(pts[i - 1], pts[i]);
    return fechada && pts.length > 2 ? s + distancia(pts[pts.length - 1], pts[0]) : s;
  };

  // Margem de erro da área (95%). Mover o ponto i altera a área em ½·(p[i+1] − p[i−1]) girado de 90°.
  // O erro do GPS muda devagar: pontos a menos de CORREL metros um do outro (trilha) erram juntos e somam o efeito;
  // vértices distantes erram de forma independente.
  const CORREL = 25;
  function margem(pts) {
    const n = pts.length;
    if (n < 3) return 0;
    const xy = plano(pts);
    let soma = 0, gx = 0, gy = 0, sg = 0, ate = CORREL, andado = 0;
    for (let i = 0; i < n; i++) {
      if (i && andado >= ate) { soma += sg * sg * (gx * gx + gy * gy); gx = gy = sg = 0; ate = andado + CORREL; }
      const ant = xy[(i - 1 + n) % n], prox = xy[(i + 1) % n];
      gx += (prox[1] - ant[1]) / 2; gy += (ant[0] - prox[0]) / 2;
      sg = Math.max(sg, pts[i].s || 0);
      if (i < n - 1) andado += Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
    }
    soma += sg * sg * (gx * gx + gy * gy);
    return 2 * Math.sqrt(soma);
  }

  function medir(pts) {
    const area = pts.length > 2 ? areaPlana(plano(pts)) : 0;
    return { area, margem: margem(pts), perimetro: perimetro(pts, pts.length > 2), utm: pts.length > 2 ? areaUtm(pts) : 0 };
  }

  // ---- UTM (fórmulas de Snyder) ----
  const fusoDe = (lo) => Math.min(60, Math.floor((lo + 180) / 6) + 1);
  function geoUtm(la, lo, fuso = fusoDe(lo)) {
    const k0 = 0.9996, f = la * RAD, l0 = (fuso * 6 - 183) * RAD;
    const s = Math.sin(f), c = Math.cos(f), t = Math.tan(f);
    const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = c * (lo * RAD - l0);
    const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * f - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * f)
      + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * f) - (35 * e2 ** 3 / 3072) * Math.sin(6 * f));
    const E = 500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
    let Nn = k0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    if (la < 0) Nn += 10000000;
    return { E, N: Nn, fuso, sul: la < 0 };
  }
  // área como o CAD mede, com as coordenadas UTM (difere da real pelo fator de escala da projeção, até ~0,1%)
  function areaUtm(pts) {
    const fuso = fusoDe(pts.reduce((s, p) => s + p.lo, 0) / pts.length);
    const u = pts.map((p) => geoUtm(p.la, p.lo, fuso)), E0 = u[0].E, N0 = u[0].N;
    return areaPlana(u.map((q) => [q.E - E0, q.N - N0]));
  }

  // ---- média das leituras paradas num vértice ----
  // usa a melhor metade das leituras (menor imprecisão) e a mediana de cada coordenada, que ignora saltos.
  // A precisão informada pelo celular é o raio de 68%; 1 desvio-padrão por eixo ≈ raio / 1,5.
  // Parado, o erro do GPS muda devagar: a média melhora pouco (≈ 15%), não divide pela raiz do número de leituras.
  const mediana = (v) => { const o = [...v].sort((x, y) => x - y), m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
  function mediaVertice(leituras) {
    if (!leituras.length) return null;
    const boas = [...leituras].sort((x, y) => x.acc - y.acc).slice(0, Math.max(1, Math.ceil(leituras.length / 2)));
    const acc = mediana(boas.map((l) => l.acc));
    return { la: mediana(boas.map((l) => l.la)), lo: mediana(boas.map((l) => l.lo)), s: acc / 1.5 * (leituras.length >= 5 ? 0.85 : 1), t: 'v', n: leituras.length };
  }

  // ---- formatação brasileira ----
  const num = (x, c = 0) => x.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
  const fmtArea = (m2) => (m2 >= 10000 ? num(m2, 0) + ' m² (' + num(m2 / 10000, m2 >= 1e6 ? 1 : 2) + ' ha)' : num(m2, m2 < 100 ? 1 : 0) + ' m²');
  const fmtDist = (m) => (m >= 1000 ? num(m / 1000, 2) + ' km' : num(m, m < 100 ? 1 : 0) + ' m');

  return { raios, plano, areaPlana, distancia, perimetro, margem, medir, fusoDe, geoUtm, areaUtm, mediaVertice, mediana, num, fmtArea, fmtDist };
})();

if (typeof module !== 'undefined') module.exports = Geo;
