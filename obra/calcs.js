// Calculadoras da obra: cada uma é uma lista de campos (o app monta o formulário) e uma função calcular(v) com as fórmulas.
// Campos: t = num | txt | data | hora | sel | escolha (cartões com desenho) | obra | lista (linhas repetidas) | pontos (medidas da caçamba)
// calcular(v) devolve { destaque, resumo: [[rótulo, valor]], tabela?: {cab, linhas}, avisos?, situacao?: [texto, 'ok'|'bad'], arquivo: {tipo, titulo, material?} }
'use strict';

const N = (x, c = 2) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }) : '—');
const N0 = (x) => N(x, 0);
const m3 = (x) => N(x, 2) + ' m³';
const kg = (x) => (x >= 10000 ? N(x / 1000, 2) + ' t' : N(x, x < 100 ? 1 : 0) + ' kg');
const cm = (x) => N(x, x % 1 ? 1 : 0).replace(/,0$/, '');
const PI = Math.PI;

// ---------- tabelas de referência ----------
// massa unitária solta (t/m³): valores médios para conversão; o fornecedor pode usar outros (o campo é editável)
const MATERIAIS = [
  { id: 'areia', nome: 'Areia', sub: 'média / grossa', dens: 1.45 },
  { id: 'pedrisco', nome: 'Pedrisco', sub: 'brita 0 fina', dens: 1.40 },
  { id: 'brita0', nome: 'Brita 0', sub: '4,8 a 9,5 mm', dens: 1.40 },
  { id: 'brita1', nome: 'Brita 1', sub: '9,5 a 19 mm', dens: 1.42 },
  { id: 'brita2', nome: 'Brita 2', sub: '19 a 25 mm', dens: 1.42 },
  { id: 'brita3', nome: 'Brita 3', sub: '25 a 50 mm', dens: 1.45 },
  { id: 'rachao', nome: 'Rachão', sub: 'pedra de mão, 76 a 250 mm', dens: 1.55 },
  { id: 'po', nome: 'Pó de pedra', sub: 'até 4,8 mm', dens: 1.55 },
  { id: 'bica', nome: 'Bica corrida', sub: 'brita graduada', dens: 1.65 },
  { id: 'solo', nome: 'Solo / aterro', sub: 'terra solta', dens: 1.40 },
].map((m) => ({ ...m, des: () => Des.monte(m.id) }));
const matDe = (id) => MATERIAIS.find((m) => m.id === id);

// caminhões basculantes: medidas internas típicas da caçamba (m). Variam por fabricante: o app pede para medir.
const CAMINHOES = [
  { id: 'tresq', nome: '3/4 (pequeno)', sub: '≈ 3 a 4 m³ · 2 eixos', C: 3.0, L: 2.0, H: 0.60 },
  { id: 'toco', nome: 'Toco', sub: '≈ 5 a 6 m³ · 2 eixos', C: 4.0, L: 2.30, H: 0.60 },
  { id: 'truck', nome: 'Truck / traçado', sub: '≈ 10 a 12 m³ · 3 eixos', C: 5.0, L: 2.45, H: 0.90 },
  { id: 'bitruck', nome: 'Bitruck', sub: '≈ 14 a 16 m³ · 4 eixos', C: 6.0, L: 2.45, H: 1.00 },
  { id: 'carreta', nome: 'Carreta basculante', sub: '≈ 20 a 30 m³ · cavalo + reboque', C: 8.5, L: 2.45, H: 1.20 },
].map((c) => ({ ...c, des: () => Des.caminhao(c.id) }));
const FORMAS_CACAMBA = [
  { id: 'reta', nome: 'Caixa reta', sub: 'laterais retas, fundo plano (a mais comum)', des: () => Des.secao('reta') },
  { id: 'trapezio', nome: 'Laterais inclinadas', sub: 'mais larga em cima que no fundo', des: () => Des.secao('trapezio') },
  { id: 'arred', nome: 'Fundo arredondado', sub: 'tipo meia-cana (caçamba de rocha)', des: () => Des.secao('arred') },
];

// tijolos e blocos (cm): e = largura (espessura da parede de meia vez), h = altura, c = comprimento
const TIJOLOS = [
  { id: 'macico', nome: 'Tijolo maciço', e: 9, h: 5, c: 19, mat: 'macico', junta: 1, perda: 10 },
  { id: 'c6', nome: 'Cerâmico 6 furos', e: 9, h: 14, c: 19, mat: 'ceramica', furos: ['lado', 2, 3], junta: 1, perda: 5 },
  { id: 'c8', nome: 'Cerâmico 8 furos', e: 9, h: 19, c: 19, mat: 'ceramica', furos: ['lado', 2, 4], junta: 1, perda: 5 },
  { id: 'c9', nome: 'Cerâmico 9 furos (baiano)', e: 11.5, h: 14, c: 24, mat: 'ceramica', furos: ['lado', 3, 3], junta: 1, perda: 5 },
  { id: 'b9x19x29', nome: 'Bloco cerâmico vedação', e: 9, h: 19, c: 29, mat: 'ceramica', furos: ['lado', 3, 2], junta: 1, perda: 5 },
  { id: 'b14est', nome: 'Bloco cerâmico estrutural', e: 14, h: 19, c: 29, mat: 'ceramica', furos: ['topo', 2, 2], junta: 1, perda: 3 },
  { id: 'bc9', nome: 'Bloco de concreto', e: 9, h: 19, c: 39, mat: 'concreto', furos: ['topo', 1, 2], junta: 1, perda: 3 },
  { id: 'bc14', nome: 'Bloco de concreto', e: 14, h: 19, c: 39, mat: 'concreto', furos: ['topo', 1, 2], junta: 1, perda: 3 },
  { id: 'bc19', nome: 'Bloco de concreto', e: 19, h: 19, c: 39, mat: 'concreto', furos: ['topo', 1, 2], junta: 1, perda: 3 },
  { id: 'eco', nome: 'Tijolo ecológico', e: 12.5, h: 6.25, c: 25, mat: 'ecologico', furos: ['topo', 1, 2, true], junta: 0, perda: 5 },
  { id: 'celular', nome: 'Bloco de concreto celular', e: 10, h: 30, c: 60, mat: 'celular', junta: 0.3, perda: 3 },
].map((t) => ({ ...t, sub: `${cm(t.e)} × ${cm(t.h)} × ${cm(t.c)} cm`, des: () => Des.tijolo(t) }));

const BITOLAS = [[5, 0.154], [6.3, 0.245], [8, 0.395], [10, 0.617], [12.5, 0.963], [16, 1.578], [20, 2.466], [25, 3.853], [32, 6.313]];

// massa específica (kg/dm³) para o consumo de cimento do traço em massa
const DELTA = { c: 3.10, a: 2.63, p: 2.70 };
const TRACOS = [
  { id: 'magro', nome: 'Concreto magro', sub: '1 : 4 : 6 · a/c 0,90', a: 4, p: 6, x: 0.9 },
  { id: 'f15', nome: 'fck ≈ 15 MPa', sub: '1 : 3 : 4 · a/c 0,70', a: 3, p: 4, x: 0.7 },
  { id: 'f20', nome: 'fck ≈ 20 MPa', sub: '1 : 2,5 : 3,5 · a/c 0,60', a: 2.5, p: 3.5, x: 0.6 },
  { id: 'f25', nome: 'fck ≈ 25 MPa', sub: '1 : 2 : 3 · a/c 0,50', a: 2, p: 3, x: 0.5 },
  { id: 'outro', nome: 'Meu traço', sub: 'digite o traço em massa' },
];

// ---------- formas geométricas ----------
// área da seção da caçamba cheia até a altura h
function areaSecao(forma, L, h, Lb, fc, H) {
  if (h <= 0) return 0;
  if (forma === 'trapezio') { const w = Lb + (L - Lb) * Math.min(h, H) / H; return h <= H ? h * (Lb + w) / 2 : H * (Lb + L) / 2 + (h - H) * L; }
  if (forma === 'arred' && fc > 0) {
    const R = (L * L / 4 + fc * fc) / (2 * fc), seg = (y) => R * R * Math.acos((R - y) / R) - (R - y) * Math.sqrt(Math.max(0, 2 * R * y - y * y));
    return h <= fc ? seg(h) : seg(fc) + L * (h - fc);
  }
  return L * h;
}
const troncoPiramide = (h, A1, A2) => h / 3 * (A1 + A2 + Math.sqrt(A1 * A2));
const troncoCone = (h, R, r) => PI * h / 3 * (R * R + R * r + r * r);
const segCirculo = (R, y) => R * R * Math.acos((R - y) / R) - (R - y) * Math.sqrt(Math.max(0, 2 * R * y - y * y));

// latas de tinta: combinação de 18 L, 3,6 L e 0,9 L que cobre o necessário com menos sobra (e menos embalagens)
function latas(litros) {
  let melhor = null;
  for (let a = 0; a <= Math.ceil(litros / 18); a++) for (let b = 0; b <= 5; b++) for (let c = 0; c <= 4; c++) {
    const t = a * 18 + b * 3.6 + c * 0.9;
    if (t + 1e-9 < litros) continue;
    const custo = t * 100 + (a + b + c);
    if (!melhor || custo < melhor.custo) melhor = { a, b, c, t, custo };
  }
  return melhor;
}

const obraCampo = { k: 'obra', rot: 'Obra / empreendimento', t: 'obra', grupo: 'Onde' };

const CALCS = [
  // ===================== Recebimento =====================
  {
    id: 'cubicagem', nome: 'Cubicagem de caminhão', grupo: 'Recebimento de material', desc: 'Conferir o volume de areia, brita e rachão entregue',
    campos: [
      { k: 'material', rot: 'Material entregue', t: 'escolha', ops: MATERIAIS, padrao: 'areia', grupo: '1. Material' },
      { k: 'caminhao', rot: 'Tipo de caminhão', t: 'escolha', ops: CAMINHOES, padrao: 'truck', grupo: '2. Caminhão' },
      { k: 'forma', rot: 'Formato da caçamba', t: 'escolha', ops: FORMAS_CACAMBA, padrao: 'reta' },
      { k: 'placa', rot: 'Placa', t: 'txt', dica: 'Com a placa, o app lembra as medidas desta caçamba na próxima entrega', maxlen: 8, maiusc: true },
      { k: 'C', rot: 'Comprimento interno', t: 'num', un: 'm', grupo: '3. Medidas internas da caçamba', dica: 'Meça por dentro, de parede a parede' },
      { k: 'L', rot: 'Largura interna (em cima)', t: 'num', un: 'm' },
      { k: 'Lb', rot: 'Largura no fundo', t: 'num', un: 'm', mostrar: (v) => v.forma === 'trapezio' },
      { k: 'fc', rot: 'Profundidade da curva do fundo', t: 'num', un: 'm', mostrar: (v) => v.forma === 'arred', dica: 'Do ponto mais baixo do fundo até onde a lateral fica reta' },
      { k: 'H', rot: 'Altura da caçamba (até a borda)', t: 'num', un: 'm' },
      { k: 'modo', rot: 'Como vai medir', t: 'escolha', grupo: '4. Medição', ops: [
        { id: 'vazio', nome: 'Da borda até o material', sub: 'mais fácil: régua apoiada na borda (vazio)', des: () => Des.comoMedir('vazio') },
        { id: 'altura', nome: 'Do fundo até o topo do material', sub: 'vergalhão enfiado até o fundo', des: () => Des.comoMedir('altura') }], padrao: 'vazio' },
      { k: 'npontos', rot: 'Pontos de medida', t: 'escolha', ops: [
        { id: '5', nome: '5 pontos', sub: '4 cantos e o centro', des: () => Des.pontos(5) },
        { id: '9', nome: '9 pontos', sub: 'carreta, rachão ou carga irregular', des: () => Des.pontos(9) }], padrao: '5' },
      { k: 'p', rot: 'Medidas', t: 'pontos', un: 'cm' },
      { k: 'data', rot: 'Data', t: 'data', grupo: '5. Dados da entrega' },
      { k: 'hora', rot: 'Hora', t: 'hora' },
      { k: 'obra', rot: 'Obra / empreendimento', t: 'obra' },
      { k: 'fornecedor', rot: 'Fornecedor', t: 'txt', lembrar: true },
      { k: 'nf', rot: 'Nota fiscal nº', t: 'txt' },
      { k: 'motorista', rot: 'Motorista', t: 'txt' },
      { k: 'unNf', rot: 'Quantidade na nota em', t: 'sel', ops: [['m3', 'm³'], ['t', 'toneladas']], padrao: 'm3' },
      { k: 'qtdNf', rot: 'Quantidade na nota', t: 'num', un: (v) => (v.unNf === 't' ? 't' : 'm³') },
      { k: 'dens', rot: 'Massa unitária do material', t: 'num', un: 't/m³', dica: 'Média do material solto. Se o fornecedor informar outra, use a dele.' },
      { k: 'tol', rot: 'Tolerância aceita', t: 'num', un: '%', padrao: 3 },
    ],
    ao(v, k) {
      if (k === 'material' || !v.dens) v.dens = matDe(v.material).dens;
      if (k === 'material') v.npontos = v.material === 'rachao' ? '9' : v.npontos;
      if (k === 'caminhao') { const c = CAMINHOES.find((x) => x.id === v.caminhao); Object.assign(v, { C: c.C, L: c.L, H: c.H }); if (v.caminhao === 'carreta') v.npontos = '9'; }
      if (k === 'forma') { if (v.forma === 'trapezio' && !v.Lb) v.Lb = Math.round((v.L || 2.4) * 0.8 * 100) / 100; if (v.forma === 'arred' && !v.fc) v.fc = Math.round((v.L || 2.4) * 0.2 * 100) / 100; }
      if (k === 'placa') { const c = cacambas()[normPlaca(v.placa)]; if (c) Object.assign(v, c); }
    },
    calcular(v) {
      const mat = matDe(v.material), cam = CAMINHOES.find((x) => x.id === v.caminhao), n = +v.npontos || 5;
      const med = (v.p || []).slice(0, n).filter((x) => Number.isFinite(x));
      if (!(v.C > 0 && v.L > 0 && v.H > 0)) return { erro: 'Informe as medidas internas da caçamba.' };
      if (med.length < n) return { erro: `Faltam ${n - med.length} das ${n} medidas.` };
      const alt = med.map((x) => (v.modo === 'vazio' ? v.H - x / 100 : x / 100));
      const hm = alt.reduce((s, x) => s + x, 0) / alt.length;
      const area = areaSecao(v.forma, v.L, hm, v.Lb || v.L, v.fc || 0, v.H);
      const vol = v.C * area, peso = vol * (v.dens || mat.dens);
      const avisos = [];
      if (alt.some((x) => x < 0)) avisos.push('Alguma medida passou da altura da caçamba: confira os números.');
      if (alt.some((x) => x > v.H + 0.01)) avisos.push('Material acima da borda (coroado): o volume acima da borda é aproximado pela média das alturas.');
      if (Math.max(...alt) - Math.min(...alt) > 0.35 && n === 5) avisos.push('A carga está muito irregular: meça em 9 pontos para um resultado melhor.');
      const resumo = [['Material', `${mat.nome} (${mat.sub})`], ['Caminhão', `${cam.nome} · ${FORMAS_CACAMBA.find((f) => f.id === v.forma).nome.toLowerCase()}`],
        ['Caçamba (interna)', `${N(v.C)} × ${N(v.L)}${v.forma === 'trapezio' ? ` (fundo ${N(v.Lb)})` : ''} × ${N(v.H)} m`],
        [v.modo === 'vazio' ? 'Vazios medidos (borda → material)' : 'Alturas medidas', med.map((x) => cm(x)).join(' · ') + ' cm'],
        ['Altura média do material', N(hm, 3) + ' m'], ['Volume medido', m3(vol)], ['Peso estimado', `${N(peso, 2)} t (${N(v.dens, 2)} t/m³)`]];
      let situacao = null;
      if (v.qtdNf > 0) {
        const nfV = v.unNf === 't' ? v.qtdNf / v.dens : v.qtdNf, dif = vol - nfV, pct = dif / nfV * 100;
        resumo.push(['Na nota fiscal', v.unNf === 't' ? `${N(v.qtdNf)} t (≈ ${m3(nfV)})` : m3(nfV)], ['Diferença', `${dif >= 0 ? '+' : ''}${m3(dif)} (${pct >= 0 ? '+' : ''}${N(pct, 1)}%)`]);
        situacao = pct >= -(v.tol ?? 3) ? ['Conforme', 'ok'] : [`Faltou ${m3(-dif)}`, 'bad'];
        resumo.push(['Situação', situacao[0] + ` (tolerância ${N(v.tol ?? 3, 0)}%)`]);
      }
      for (const [k, r] of [['data', 'Data'], ['hora', 'Hora'], ['obra', 'Obra'], ['fornecedor', 'Fornecedor'], ['nf', 'Nota fiscal'], ['placa', 'Placa'], ['motorista', 'Motorista']]) if (v[k]) resumo.push([r, k === 'data' ? dataBR(v[k]) : String(v[k])]);
      return { destaque: m3(vol), sub: `${mat.nome} · ${N(peso, 1)} t estimadas`, resumo, avisos, situacao,
        desenhos: [mat.des(), cam.des(), Des.pontos(n)], tabela: { cab: ['Ponto', v.modo === 'vazio' ? 'Vazio (cm)' : 'Altura (cm)', 'Altura do material (m)'], linhas: med.map((x, i) => [`P${i + 1}`, cm(x), N(alt[i], 3)]) },
        arquivo: { tipo: 'receb', titulo: `${mat.nome}${v.fornecedor ? ' · ' + v.fornecedor : ''}`, material: mat.nome, data: v.data, valor: vol, unidade: 'm³' } };
    },
  },

  // ===================== Alvenaria e acabamento =====================
  {
    id: 'tijolos', nome: 'Tijolos e blocos', grupo: 'Alvenaria e acabamento', desc: 'Quantidade de tijolos ou blocos por parede, com argamassa',
    campos: [
      { k: 'tipo', rot: 'Tijolo ou bloco', t: 'escolha', ops: TIJOLOS, padrao: 'c8', grupo: 'Tijolo' },
      { k: 'assent', rot: 'Assentamento', t: 'sel', ops: [['pe', 'Em pé, de meia vez (parede com a largura do tijolo)'], ['deitado', 'Deitado (parede com a altura do tijolo)'], ['umavez', 'De uma vez (parede com o comprimento do tijolo)']], padrao: 'pe' },
      { k: 'comp', rot: 'Comprimento das paredes', t: 'num', un: 'm', grupo: 'Parede', dica: 'Some o comprimento de todas as paredes com a mesma altura' },
      { k: 'alt', rot: 'Altura da parede', t: 'num', un: 'm' },
      { k: 'vaos', rot: 'Portas e janelas (descontar)', t: 'lista', novo: '+ Porta ou janela', campos: [{ k: 'l', rot: 'Largura', un: 'm' }, { k: 'h', rot: 'Altura', un: 'm' }, { k: 'n', rot: 'Quant.', un: 'un', padrao: 1 }] },
      { k: 'junta', rot: 'Espessura da junta', t: 'num', un: 'cm' },
      { k: 'perda', rot: 'Perda / quebra', t: 'num', un: '%' },
      obraCampo,
    ],
    ao(v, k) { if (k === 'tipo' || v.junta == null) { const t = TIJOLOS.find((x) => x.id === v.tipo); v.junta = t.junta; v.perda = t.perda; } },
    calcular(v) {
      const t = TIJOLOS.find((x) => x.id === v.tipo);
      if (!(v.comp > 0 && v.alt > 0)) return { erro: 'Informe o comprimento e a altura da parede.' };
      const [a, b, esp] = v.assent === 'deitado' ? [t.c, t.e, t.h] : v.assent === 'umavez' ? [t.e, t.h, t.c] : [t.c, t.h, t.e];
      const j = v.junta || 0, bruta = v.comp * v.alt, vaos = (v.vaos || []).reduce((s, x) => s + (x.l || 0) * (x.h || 0) * (x.n ?? 1), 0), liq = Math.max(0, bruta - vaos);
      const porM2 = 1 / ((a + j) / 100 * (b + j) / 100), qtd = Math.ceil(liq * porM2 * (1 + (v.perda || 0) / 100));
      const arg = liq * esp / 100 * (1 - (a * b) / ((a + j) * (b + j))) * (1 + (v.perda || 0) / 100);
      return { destaque: `${N0(qtd)} peças`, sub: `${t.nome} ${t.sub}`,
        resumo: [['Tijolo / bloco', `${t.nome} · ${t.sub}`], ['Face na parede', `${cm(a)} × ${cm(b)} cm · parede de ${cm(esp)} cm (sem reboco)`], ['Área da parede', N(bruta) + ' m²'],
          ['Vãos descontados', N(vaos) + ' m²'], ['Área de alvenaria', N(liq) + ' m²'], ['Peças por m²', N(porM2, 1)], ['Perda', N(v.perda || 0, 0) + '%'], ['Quantidade', `${N0(qtd)} peças`],
          [t.id === 'celular' ? 'Argamassa colante (volume)' : 'Argamassa de assentamento', j ? m3(arg) + (t.id === 'celular' ? '' : ' (use a calculadora de argamassa para cimento, cal e areia)') : 'encaixe, sem argamassa'],
          ...(v.obra ? [['Obra', v.obra]] : [])],
        desenhos: [t.des()], arquivo: { tipo: 'calc', titulo: `Tijolos: ${t.nome} ${t.sub}`, valor: qtd, unidade: 'peças' } };
    },
  },
  {
    id: 'argamassa', nome: 'Argamassa', grupo: 'Alvenaria e acabamento', desc: 'Chapisco, reboco, contrapiso e assentamento: cimento, cal e areia',
    campos: [
      { k: 'tipo', rot: 'Serviço', t: 'escolha', grupo: 'Serviço', padrao: 'reboco', ops: [
        { id: 'chapisco', nome: 'Chapisco', sub: '0,5 cm · 1 : 3', des: () => Des.argamassa('chapisco') },
        { id: 'reboco', nome: 'Emboço / reboco', sub: '2 cm · 1 : 2 : 8', des: () => Des.argamassa('reboco') },
        { id: 'contrapiso', nome: 'Contrapiso', sub: '4 cm · 1 : 4', des: () => Des.argamassa('contrapiso') },
        { id: 'assent', nome: 'Assentamento', sub: 'volume da calculadora de tijolos · 1 : 2 : 8', des: () => Des.argamassa('assent') }] },
      { k: 'area', rot: 'Área', t: 'num', un: 'm²', mostrar: (v) => v.tipo !== 'assent', grupo: 'Quantidade' },
      { k: 'esp', rot: 'Espessura', t: 'num', un: 'cm', mostrar: (v) => v.tipo !== 'assent' },
      { k: 'vol', rot: 'Volume de argamassa', t: 'num', un: 'm³', mostrar: (v) => v.tipo === 'assent' },
      { k: 'tc', rot: 'Traço em volume: cimento', t: 'num', un: 'parte', grupo: 'Traço' },
      { k: 'tcal', rot: 'cal hidratada', t: 'num', un: 'partes' },
      { k: 'tar', rot: 'areia', t: 'num', un: 'partes' },
      { k: 'perda', rot: 'Perda', t: 'num', un: '%', padrao: 10 },
      obraCampo,
    ],
    ao(v, k) {
      if (k !== 'tipo' && v.tc != null) return;
      const p = { chapisco: [0.5, 1, 0, 3], reboco: [2, 1, 2, 8], contrapiso: [4, 1, 0, 4], assent: [null, 1, 2, 8] }[v.tipo];
      if (p[0] != null) v.esp = p[0];
      [v.tc, v.tcal, v.tar] = p.slice(1);
    },
    calcular(v) {
      const vol = (v.tipo === 'assent' ? v.vol : (v.area || 0) * (v.esp || 0) / 100) * (1 + (v.perda || 0) / 100);
      if (!(vol > 0)) return { erro: v.tipo === 'assent' ? 'Informe o volume de argamassa.' : 'Informe a área e a espessura.' };
      // materiais secos ocupam ~25% a mais que a argamassa pronta (vazios entre os grãos)
      const partes = (v.tc || 0) + (v.tcal || 0) + (v.tar || 0), seco = vol * 1.25;
      const cim = seco * (v.tc || 0) / partes * 1400, cal = seco * (v.tcal || 0) / partes * 600, areia = seco * (v.tar || 0) / partes;
      const nomes = { chapisco: 'Chapisco', reboco: 'Emboço / reboco', contrapiso: 'Contrapiso', assent: 'Argamassa de assentamento' };
      return { destaque: m3(vol), sub: `${nomes[v.tipo]} · traço ${N(v.tc, 0)} : ${N(v.tcal, 0)} : ${N(v.tar, 0)}`,
        resumo: [['Serviço', nomes[v.tipo]], ...(v.tipo !== 'assent' ? [['Área × espessura', `${N(v.area)} m² × ${cm(v.esp)} cm`]] : []), ['Volume (com perda)', m3(vol)],
          ['Traço (cimento : cal : areia)', `${N(v.tc, 0)} : ${N(v.tcal, 0)} : ${N(v.tar, 0)} em volume`], ['Cimento', `${kg(cim)} = ${N(cim / 50, 1)} sacos de 50 kg`],
          ...(cal ? [['Cal hidratada', `${kg(cal)} = ${N(cal / 20, 1)} sacos de 20 kg`]] : []), ['Areia', m3(areia)], ...(v.obra ? [['Obra', v.obra]] : [])],
        avisos: ['Estimativa pelo método do volume seco (fator 1,25). Argamassa industrializada: siga o consumo do fabricante.'],
        arquivo: { tipo: 'calc', titulo: `Argamassa: ${nomes[v.tipo]}`, valor: vol, unidade: 'm³' } };
    },
  },
  {
    id: 'revestimento', nome: 'Piso e azulejo', grupo: 'Alvenaria e acabamento', desc: 'Peças, caixas, argamassa colante e rejunte',
    campos: [
      { k: 'peca', rot: 'Tamanho da peça', t: 'escolha', grupo: 'Peça', padrao: '60x60', ops: [['20x20', 20, 20], ['30x30', 30, 30], ['45x45', 45, 45], ['60x60', 60, 60], ['30x60', 30, 60], ['20x120', 20, 120], ['90x90', 90, 90], ['outra', 0, 0]]
        .map(([id, a, b]) => ({ id, nome: id === 'outra' ? 'Outra medida' : `${a} × ${b} cm`, sub: id === 'outra' ? 'digite abaixo' : '', des: () => Des.revestimento(a || 40, b || 25) })) },
      { k: 'pc', rot: 'Comprimento da peça', t: 'num', un: 'cm', mostrar: (v) => v.peca === 'outra' },
      { k: 'pl', rot: 'Largura da peça', t: 'num', un: 'cm', mostrar: (v) => v.peca === 'outra' },
      { k: 'area', rot: 'Área a revestir', t: 'num', un: 'm²', grupo: 'Área' },
      { k: 'pag', rot: 'Paginação', t: 'sel', ops: [['reta', 'Reta'], ['diag', 'Diagonal (mais recortes)']], padrao: 'reta' },
      { k: 'perda', rot: 'Perda', t: 'num', un: '%', padrao: 10 },
      { k: 'cx', rot: 'm² por caixa', t: 'num', un: 'm²', dica: 'Está escrito na caixa' },
      { k: 'junta', rot: 'Junta', t: 'num', un: 'mm', padrao: 3, grupo: 'Rejunte e argamassa' },
      { k: 'esp', rot: 'Espessura da peça', t: 'num', un: 'mm', padrao: 8 },
      { k: 'colante', rot: 'Argamassa colante', t: 'num', un: 'kg/m²', dica: 'Até 30×30: ~5 kg/m² (colagem simples). Maiores: ~8 kg/m² (dupla colagem)' },
      obraCampo,
    ],
    ao(v, k) {
      const [a, b] = v.peca === 'outra' ? [v.pc || 0, v.pl || 0] : v.peca.split('x').map(Number);
      if (k === 'peca' || v.colante == null) v.colante = a * b > 900 ? 8 : 5;
      if (k === 'peca' || v.cx == null) v.cx = a && b ? Math.round(a * b / 10000 * Math.max(1, Math.floor(1.5 / (a * b / 10000))) * 100) / 100 : null;
      if (k === 'pag') v.perda = v.pag === 'diag' ? 15 : 10;
    },
    calcular(v) {
      const [a, b] = v.peca === 'outra' ? [v.pc, v.pl] : v.peca.split('x').map(Number);
      if (!(a > 0 && b > 0 && v.area > 0)) return { erro: 'Informe a peça e a área.' };
      const area = v.area * (1 + (v.perda || 0) / 100), pecas = Math.ceil(area / (a * b / 10000)), caixas = v.cx > 0 ? Math.ceil(area / v.cx) : null;
      // rejunte (kg/m²) = (C + L) × junta × espessura × 1,58 / (C × L), com as medidas em mm (fórmula dos fabricantes)
      const rej = (a * 10 + b * 10) * (v.junta || 0) * (v.esp || 0) * 1.58 / (a * 10 * b * 10) * v.area, col = (v.colante || 0) * v.area;
      return { destaque: caixas ? `${N0(caixas)} caixas` : `${N0(pecas)} peças`, sub: `${cm(a)} × ${cm(b)} cm · ${N(v.area)} m²`,
        resumo: [['Peça', `${cm(a)} × ${cm(b)} cm`], ['Área', `${N(v.area)} m² + ${N(v.perda, 0)}% de perda = ${N(area)} m²`], ['Peças', N0(pecas)], ...(caixas ? [['Caixas', `${N0(caixas)} (${N(v.cx)} m² cada)`]] : []),
          ['Argamassa colante', `${kg(col)} = ${N0(Math.ceil(col / 20))} sacos de 20 kg`], ['Rejunte', `${kg(rej)} (junta de ${N(v.junta, 0)} mm)`], ...(v.obra ? [['Obra', v.obra]] : [])],
        desenhos: [Des.revestimento(a, b)], arquivo: { tipo: 'calc', titulo: `Revestimento ${cm(a)}×${cm(b)} cm`, valor: v.area, unidade: 'm²' } };
    },
  },
  {
    id: 'pintura', nome: 'Pintura', grupo: 'Alvenaria e acabamento', desc: 'Litros de tinta e latas por área e demãos',
    campos: [
      { k: 'tipo', rot: 'Tinta', t: 'sel', grupo: 'Tinta', ops: [['acrilica', 'Acrílica (parede interna e externa)'], ['pva', 'Látex PVA (parede interna)'], ['esmalte', 'Esmalte sintético (madeira e metal)'], ['piso', 'Tinta para piso']], padrao: 'acrilica' },
      { k: 'area', rot: 'Área a pintar', t: 'num', un: 'm²', grupo: 'Área', dica: 'Paredes: perímetro × altura, menos portas e janelas' },
      { k: 'demaos', rot: 'Demãos', t: 'num', un: '', padrao: 2 },
      { k: 'rend', rot: 'Rendimento por demão', t: 'num', un: 'm²/L', dica: 'Veja na lata: área por demão ÷ litros' },
      obraCampo,
    ],
    ao(v, k) { if (k === 'tipo' || v.rend == null) v.rend = { acrilica: 10, pva: 9, esmalte: 12, piso: 8 }[v.tipo]; },
    calcular(v) {
      if (!(v.area > 0 && v.rend > 0)) return { erro: 'Informe a área.' };
      const L = v.area * (v.demaos || 1) / v.rend, c = latas(L);
      const comp = [c.a && `${c.a} lata${c.a > 1 ? 's' : ''} de 18 L`, c.b && `${c.b} galão${c.b > 1 ? 'ões' : ''} de 3,6 L`, c.c && `${c.c} quarto${c.c > 1 ? 's' : ''} de 0,9 L`].filter(Boolean).join(' + ');
      return { destaque: N(L, 1) + ' L', sub: comp, resumo: [['Área', N(v.area) + ' m²'], ['Demãos', N0(v.demaos)], ['Rendimento', `${N(v.rend, 1)} m²/L por demão`], ['Tinta', N(L, 1) + ' L'], ['Comprar', `${comp} (${N(c.t, 1)} L)`], ...(v.obra ? [['Obra', v.obra]] : [])],
        desenhos: [Des.pintura()], arquivo: { tipo: 'calc', titulo: 'Pintura', valor: L, unidade: 'L' } };
    },
  },
  {
    id: 'impermeabilizacao', nome: 'Impermeabilização', grupo: 'Alvenaria e acabamento', desc: 'Manta, argamassa polimérica, emulsão, membrana e cristalizante',
    campos: [
      { k: 'prod', rot: 'Sistema', t: 'escolha', grupo: 'Sistema', padrao: 'polimerica', ops: [
        { id: 'polimerica', nome: 'Argamassa polimérica', sub: 'reservatórios, baldrames, áreas molhadas' },
        { id: 'manta', nome: 'Manta asfáltica', sub: 'lajes, terraços, calhas' },
        { id: 'emulsao', nome: 'Emulsão asfáltica', sub: 'fundações, baldrames, muros de arrimo' },
        { id: 'acrilica', nome: 'Membrana acrílica', sub: 'lajes expostas, telhados' },
        { id: 'cristalizante', nome: 'Cristalizante', sub: 'concreto de reservatórios e caixas' }].map((o) => ({ ...o, des: () => Des.impermeabilizacao(o.id) })) },
      { k: 'area', rot: 'Área do piso / laje', t: 'num', un: 'm²', grupo: 'Área' },
      { k: 'per', rot: 'Perímetro (para o rodapé)', t: 'num', un: 'm' },
      { k: 'rod', rot: 'Altura do rodapé / subida na parede', t: 'num', un: 'm', padrao: 0.3 },
      { k: 'cons', rot: 'Consumo por demão', t: 'num', un: (v) => (v.prod === 'emulsao' ? 'L/m²' : 'kg/m²'), mostrar: (v) => v.prod !== 'manta', grupo: 'Consumo', dica: 'Confira na ficha técnica do produto' },
      { k: 'demaos', rot: 'Demãos', t: 'num', un: '', mostrar: (v) => v.prod !== 'manta' },
      { k: 'emb', rot: 'Embalagem', t: 'num', un: (v) => (v.prod === 'manta' ? 'm² por rolo' : v.prod === 'emulsao' ? 'L' : 'kg') },
      { k: 'sobrep', rot: 'Sobreposição e recortes', t: 'num', un: '%', mostrar: (v) => v.prod === 'manta', padrao: 15 },
      obraCampo,
    ],
    ao(v, k) {
      if (k !== 'prod' && v.emb != null) return;
      const p = { polimerica: [1, 3, 18], manta: [0, 0, 10], emulsao: [0.8, 3, 18], acrilica: [0.6, 4, 18], cristalizante: [0.8, 2, 18] }[v.prod];
      [v.cons, v.demaos, v.emb] = p;
    },
    calcular(v) {
      if (!(v.area > 0)) return { erro: 'Informe a área.' };
      const total = v.area + (v.per || 0) * (v.rod || 0), nomes = { polimerica: 'Argamassa polimérica', manta: 'Manta asfáltica', emulsao: 'Emulsão asfáltica', acrilica: 'Membrana acrílica', cristalizante: 'Cristalizante' };
      const resumo = [['Sistema', nomes[v.prod]], ['Área a impermeabilizar', `${N(total)} m² (piso ${N(v.area)} + rodapé ${N(total - v.area)})`]];
      let destaque, valor, un;
      if (v.prod === 'manta') {
        const m2 = total * (1 + (v.sobrep || 0) / 100), rolos = Math.ceil(m2 / (v.emb || 10)), primer = total * 0.3;
        resumo.push(['Manta', `${N(m2)} m² = ${N0(rolos)} rolos de ${N(v.emb, 0)} m²`], ['Primer asfáltico (≈ 0,3 L/m²)', N(primer, 1) + ' L']);
        destaque = `${N0(rolos)} rolos`; valor = m2; un = 'm²';
      } else {
        const q = total * (v.cons || 0) * (v.demaos || 1), u = v.prod === 'emulsao' ? 'L' : 'kg', emb = Math.ceil(q / (v.emb || 18));
        resumo.push(['Consumo', `${N(v.cons, 2)} ${u}/m² × ${N0(v.demaos)} demãos`], ['Produto', `${N(q, 1)} ${u} = ${N0(emb)} embalagens de ${N(v.emb, 0)} ${u}`]);
        destaque = `${N(q, 0)} ${u}`; valor = q; un = u;
      }
      if (v.obra) resumo.push(['Obra', v.obra]);
      return { destaque, sub: nomes[v.prod], resumo, desenhos: [Des.impermeabilizacao(v.prod)], arquivo: { tipo: 'calc', titulo: `Impermeabilização: ${nomes[v.prod]}`, valor, unidade: un } };
    },
  },

  // ===================== Concreto, aço e fôrma =====================
  {
    id: 'concreto', nome: 'Concreto', grupo: 'Concreto, aço e fôrma', desc: 'Volume por peça, caminhões betoneira e materiais do traço',
    campos: [
      { k: 'peca', rot: 'Peça', t: 'escolha', grupo: 'Peça', padrao: 'sapata', ops: [
        ['sapata', 'Sapata', 'base + tronco de pirâmide'], ['bloco', 'Bloco de coroamento', 'prisma'], ['pilar', 'Pilar', 'prisma'], ['viga', 'Viga / baldrame', 'prisma'],
        ['laje', 'Laje / piso', 'área × espessura'], ['parede', 'Parede de concreto', 'prisma'], ['estaca', 'Estaca', 'cilindro'], ['tubulao', 'Tubulão', 'fuste + base alargada'], ['anel', 'Anel / reservatório cilíndrico', 'cilindro oco']]
        .map(([id, nome, sub]) => ({ id, nome, sub, des: () => Des.peca(id) })) },
      { k: 'A', rot: (v) => (v.peca === 'sapata' ? 'Base: lado A' : 'Comprimento'), t: 'num', un: 'm', grupo: 'Medidas', mostrar: (v) => ['sapata', 'bloco', 'pilar', 'viga', 'laje', 'parede'].includes(v.peca) },
      { k: 'B', rot: (v) => (v.peca === 'sapata' ? 'Base: lado B' : 'Largura'), t: 'num', un: 'm', mostrar: (v) => ['sapata', 'bloco', 'pilar', 'viga', 'laje', 'parede'].includes(v.peca) },
      { k: 'h', rot: (v) => (v.peca === 'sapata' ? 'Altura da parte reta (rodapé)' : 'Altura'), t: 'num', un: 'm', mostrar: (v) => ['sapata', 'bloco', 'pilar', 'viga', 'parede', 'anel'].includes(v.peca) },
      { k: 'esp', rot: 'Espessura', t: 'num', un: 'cm', mostrar: (v) => v.peca === 'laje' },
      { k: 'ht', rot: 'Altura do tronco (parte inclinada)', t: 'num', un: 'm', mostrar: (v) => v.peca === 'sapata', padrao: 0 },
      { k: 'a', rot: 'Topo: lado a (colarinho do pilar)', t: 'num', un: 'm', mostrar: (v) => v.peca === 'sapata' && v.ht > 0 },
      { k: 'b', rot: 'Topo: lado b', t: 'num', un: 'm', mostrar: (v) => v.peca === 'sapata' && v.ht > 0 },
      { k: 'D', rot: (v) => (v.peca === 'tubulao' ? 'Diâmetro do fuste' : v.peca === 'anel' ? 'Diâmetro externo' : 'Diâmetro'), t: 'num', un: (v) => (v.peca === 'anel' ? 'm' : 'cm'), mostrar: (v) => ['estaca', 'tubulao', 'anel'].includes(v.peca) },
      { k: 'Di', rot: 'Diâmetro interno', t: 'num', un: 'm', mostrar: (v) => v.peca === 'anel' },
      { k: 'Lf', rot: (v) => (v.peca === 'tubulao' ? 'Comprimento do fuste' : 'Comprimento'), t: 'num', un: 'm', mostrar: (v) => ['estaca', 'tubulao'].includes(v.peca) },
      { k: 'Db', rot: 'Diâmetro da base', t: 'num', un: 'cm', mostrar: (v) => v.peca === 'tubulao' },
      { k: 'hb', rot: 'Altura da parte inclinada da base', t: 'num', un: 'm', mostrar: (v) => v.peca === 'tubulao' },
      { k: 'rod', rot: 'Rodapé da base', t: 'num', un: 'm', mostrar: (v) => v.peca === 'tubulao', padrao: 0.2 },
      { k: 'qtd', rot: 'Quantidade de peças iguais', t: 'num', un: 'un', padrao: 1, grupo: 'Quantidade' },
      { k: 'perda', rot: 'Perda', t: 'num', un: '%', padrao: 5 },
      { k: 'bet', rot: 'Capacidade do caminhão betoneira', t: 'num', un: 'm³', padrao: 8 },
      { k: 'fazer', rot: 'Fazer o concreto na obra (betoneira)?', t: 'sel', ops: [['nao', 'Não, concreto usinado'], ['sim', 'Sim: calcular cimento, areia e brita']], padrao: 'nao', grupo: 'Traço' },
      { k: 'traco', rot: 'Traço', t: 'escolha', ops: TRACOS.map((t) => ({ ...t, des: () => Des.monte(t.id === 'magro' ? 'brita1' : 'brita1') })), padrao: 'f20', mostrar: (v) => v.fazer === 'sim', semDesenho: true },
      { k: 'ta', rot: 'Areia (em massa)', t: 'num', un: 'kg/kg cim.', mostrar: (v) => v.fazer === 'sim' && v.traco === 'outro' },
      { k: 'tp', rot: 'Brita (em massa)', t: 'num', un: 'kg/kg cim.', mostrar: (v) => v.fazer === 'sim' && v.traco === 'outro' },
      { k: 'tx', rot: 'Água / cimento', t: 'num', un: '', mostrar: (v) => v.fazer === 'sim' && v.traco === 'outro' },
      obraCampo,
    ],
    calcular(v) {
      const p = v.peca, nomes = { sapata: 'Sapata', bloco: 'Bloco', pilar: 'Pilar', viga: 'Viga', laje: 'Laje', parede: 'Parede', estaca: 'Estaca', tubulao: 'Tubulão', anel: 'Anel' };
      let un = 0, desc = '';
      if (p === 'sapata') { un = (v.A || 0) * (v.B || 0) * (v.h || 0) + (v.ht > 0 ? troncoPiramide(v.ht, (v.A || 0) * (v.B || 0), (v.a || 0) * (v.b || 0)) : 0); desc = `${N(v.A)} × ${N(v.B)} m, h ${N(v.h)} m${v.ht > 0 ? ` + tronco ${N(v.ht)} m até ${N(v.a)} × ${N(v.b)} m` : ''}`; }
      else if (p === 'laje') { un = (v.A || 0) * (v.B || 0) * (v.esp || 0) / 100; desc = `${N(v.A)} × ${N(v.B)} m × ${cm(v.esp)} cm`; }
      else if (['bloco', 'pilar', 'viga', 'parede'].includes(p)) { un = (v.A || 0) * (v.B || 0) * (v.h || 0); desc = `${N(v.A)} × ${N(v.B)} × ${N(v.h)} m`; }
      else if (p === 'estaca') { un = PI * ((v.D || 0) / 200) ** 2 * (v.Lf || 0); desc = `Ø ${cm(v.D)} cm × ${N(v.Lf)} m`; }
      else if (p === 'tubulao') { const r = (v.D || 0) / 200, R = (v.Db || 0) / 200; un = PI * r * r * (v.Lf || 0) + troncoCone(v.hb || 0, R, r) + PI * R * R * (v.rod || 0); desc = `fuste Ø ${cm(v.D)} cm × ${N(v.Lf)} m, base Ø ${cm(v.Db)} cm`; }
      else if (p === 'anel') { un = PI / 4 * ((v.D || 0) ** 2 - (v.Di || 0) ** 2) * (v.h || 0); desc = `Ø ${N(v.D)} / ${N(v.Di)} m × ${N(v.h)} m`; }
      if (!(un > 0)) return { erro: 'Preencha as medidas da peça.' };
      const qtd = v.qtd || 1, vol = un * qtd * (1 + (v.perda || 0) / 100), cams = Math.ceil(vol / (v.bet || 8));
      const resumo = [['Peça', `${nomes[p]} · ${desc}`], ['Volume de uma peça', m3(un)], ['Quantidade', N0(qtd)], ['Volume total (com perda)', m3(vol)], ['Caminhões betoneira', `${cams} de ${N(v.bet || 8, 0)} m³ (último com ${m3(vol - (cams - 1) * (v.bet || 8))})`]];
      const avisos = [];
      if (v.fazer === 'sim') {
        const t = v.traco === 'outro' ? { a: v.ta, p: v.tp, x: v.tx, nome: 'Meu traço' } : TRACOS.find((x) => x.id === v.traco);
        if (t.a > 0 && t.p > 0 && t.x > 0) {
          // consumo de cimento: C = 1000 / (1/δc + a/δa + p/δp + a/c), em kg por m³ de concreto
          const C = 1000 / (1 / DELTA.c + t.a / DELTA.a + t.p / DELTA.p + t.x);
          resumo.push(['Traço em massa', `1 : ${N(t.a, 1)} : ${N(t.p, 1)} · a/c ${N(t.x, 2)} (${t.nome})`], ['Cimento', `${N0(C)} kg/m³ → ${kg(C * vol)} = ${N(C * vol / 50, 1)} sacos de 50 kg`],
            ['Areia', `${kg(C * t.a * vol)} ≈ ${m3(C * t.a * vol / 1450)}`], ['Brita', `${kg(C * t.p * vol)} ≈ ${m3(C * t.p * vol / 1420)}`], ['Água', `${N0(C * t.x * vol)} L`]);
          avisos.push('Traço de referência para estimar materiais. Para concreto estrutural, use o traço da dosagem e controle a resistência.');
        }
      }
      if (v.obra) resumo.push(['Obra', v.obra]);
      return { destaque: m3(vol), sub: `${qtd > 1 ? qtd + ' × ' : ''}${nomes[p]} · ${cams} caminhão${cams > 1 ? 'ões' : ''}`, resumo, avisos, desenhos: [Des.peca(p)],
        arquivo: { tipo: 'calc', titulo: `Concreto: ${qtd > 1 ? qtd + ' × ' : ''}${nomes[p]}`, valor: vol, unidade: 'm³' } };
    },
  },
  {
    id: 'aco', nome: 'Aço (vergalhões)', grupo: 'Concreto, aço e fôrma', desc: 'Peso por bitola, barras de 12 m e traspasse',
    campos: [
      { k: 'barras', rot: 'Peças de aço', t: 'lista', grupo: 'Peças', novo: '+ Peça', min: 1, campos: [
        { k: 'b', rot: 'Bitola', t: 'sel', ops: BITOLAS.map(([b]) => [String(b), `Ø ${String(b).replace('.', ',')} mm`]), padrao: '10' },
        { k: 'n', rot: 'Quant.', un: 'pç', padrao: 1 }, { k: 'L', rot: 'Comprimento de cada', un: 'm' }] },
      { k: 'barra', rot: 'Barra comercial', t: 'num', un: 'm', padrao: 12, grupo: 'Barras e emendas' },
      { k: 'trasp', rot: 'Traspasse (emenda)', t: 'num', un: 'Ø', padrao: 40, dica: 'Comprimento da emenda em diâmetros da barra (confira no projeto)' },
      { k: 'perda', rot: 'Perda de corte', t: 'num', un: '%', padrao: 5 },
      { k: 'vt', rot: 'Volume de concreto', t: 'num', un: 'm³', grupo: 'Estimativa pela taxa (opcional)' },
      { k: 'taxa', rot: 'Taxa de armadura', t: 'num', un: 'kg/m³', dica: 'Ex.: fundações 60 a 90, vigas e pilares 100 a 150, reservatórios 80 a 120' },
      obraCampo,
    ],
    desenhoCampo: (v) => Des.vergalhao(+((v.barras || [])[0]?.b || 10)),
    calcular(v) {
      const porB = new Map(), bar = v.barra || 12;
      for (const r of v.barras || []) {
        if (!(r.L > 0 && r.n > 0)) continue;
        const b = +r.b, lb = (v.trasp || 0) * b / 1000, emendas = r.L > bar ? Math.ceil((r.L - bar) / Math.max(0.1, bar - lb)) : 0;
        const Lt = r.L + emendas * lb, x = porB.get(b) || { m: 0, n: 0, barras: 0 };
        x.m += Lt * r.n; x.n += r.n;
        // peças até 12 m: quantas cabem numa barra; maiores: pelo comprimento total
        x.barras += r.L <= bar ? Math.ceil(r.n / Math.floor(bar / r.L)) : Math.ceil(Lt * r.n / bar);
        porB.set(b, x);
      }
      const est = v.vt > 0 && v.taxa > 0 ? v.vt * v.taxa : 0;
      if (!porB.size && !est) return { erro: 'Informe as peças (bitola, quantidade e comprimento) ou o volume e a taxa.' };
      const linhas = [...porB.entries()].sort((a, b) => a[0] - b[0]).map(([b, x]) => {
        const kgm = BITOLAS.find((y) => y[0] === b)[1], p = x.m * kgm * (1 + (v.perda || 0) / 100);
        return [`Ø ${String(b).replace('.', ',')}`, N0(x.n), N(x.m, 1) + ' m', N(kgm, 3), kg(p), N0(Math.ceil(x.barras * (1 + (v.perda || 0) / 100)))];
      });
      const total = [...porB.entries()].reduce((s, [b, x]) => s + x.m * BITOLAS.find((y) => y[0] === b)[1] * (1 + (v.perda || 0) / 100), 0);
      const resumo = porB.size ? [['Peso total (com perda)', kg(total)], ['Barras comerciais', `${linhas.reduce((s, l) => s + +l[5].replace(/\./g, ''), 0)} barras de ${N(bar, 0)} m`]] : [];
      if (est) resumo.push(['Estimativa pela taxa', `${N(v.vt)} m³ × ${N0(v.taxa)} kg/m³ = ${kg(est)}`]);
      if (v.obra) resumo.push(['Obra', v.obra]);
      return { destaque: kg(total || est), sub: porB.size ? `${porB.size} bitola${porB.size > 1 ? 's' : ''}` : 'pela taxa de armadura', resumo,
        tabela: porB.size ? { cab: ['Bitola', 'Peças', 'Comprimento', 'kg/m', 'Peso', 'Barras'], linhas } : null, desenhos: [Des.vergalhao(+((v.barras || [])[0]?.b || 10))],
        arquivo: { tipo: 'calc', titulo: 'Aço: vergalhões', valor: total || est, unidade: 'kg' } };
    },
  },
  {
    id: 'formas', nome: 'Fôrmas', grupo: 'Concreto, aço e fôrma', desc: 'Área de fôrma e chapas de compensado',
    campos: [
      { k: 'peca', rot: 'Peça', t: 'escolha', grupo: 'Peça', padrao: 'pilar', ops: [['pilar', 'Pilar', '4 faces'], ['viga', 'Viga', 'fundo + 2 laterais'], ['laje', 'Laje', 'fundo + bordas'], ['sapata', 'Sapata / bloco', 'faces laterais']].map(([id, nome, sub]) => ({ id, nome, sub, des: () => Des.forma(id) })) },
      { k: 'a', rot: (v) => (v.peca === 'viga' ? 'Largura da viga (base)' : v.peca === 'laje' ? 'Comprimento' : 'Lado a'), t: 'num', un: (v) => (v.peca === 'pilar' || v.peca === 'viga' ? 'cm' : 'm'), grupo: 'Medidas' },
      { k: 'b', rot: (v) => (v.peca === 'viga' ? 'Altura da viga' : v.peca === 'laje' ? 'Largura' : 'Lado b'), t: 'num', un: (v) => (v.peca === 'pilar' || v.peca === 'viga' ? 'cm' : 'm') },
      { k: 'h', rot: (v) => (v.peca === 'viga' ? 'Comprimento da viga' : v.peca === 'laje' ? 'Espessura' : 'Altura'), t: 'num', un: (v) => (v.peca === 'laje' ? 'cm' : 'm') },
      { k: 'qtd', rot: 'Quantidade de peças iguais', t: 'num', un: 'un', padrao: 1, grupo: 'Chapas' },
      { k: 'usos', rot: 'Reaproveitamento da chapa', t: 'num', un: 'usos', padrao: 3 },
      { k: 'chapa', rot: 'Chapa', t: 'sel', ops: [['2.42', 'Compensado 2,20 × 1,10 m (2,42 m²)'], ['2.98', 'Compensado 2,44 × 1,22 m (2,98 m²)']], padrao: '2.42' },
      { k: 'perda', rot: 'Perda de recorte', t: 'num', un: '%', padrao: 10 },
      obraCampo,
    ],
    calcular(v) {
      const p = v.peca, a = v.a || 0, b = v.b || 0, h = v.h || 0;
      const un = p === 'pilar' ? 2 * (a + b) / 100 * h : p === 'viga' ? (a + 2 * b) / 100 * h : p === 'laje' ? a * b + 2 * (a + b) * h / 100 : 2 * (a + b) * h;
      if (!(un > 0)) return { erro: 'Preencha as medidas.' };
      const area = un * (v.qtd || 1), comp = area * (1 + (v.perda || 0) / 100), chapas = Math.ceil(comp / +v.chapa / Math.max(1, v.usos || 1));
      return { destaque: N(area) + ' m²', sub: `${chapas} chapas`, resumo: [['Área de fôrma de uma peça', N(un) + ' m²'], ['Quantidade', N0(v.qtd || 1)], ['Área total', N(area) + ' m²'],
        ['Chapas a comprar', `${chapas} (${N(v.usos || 1, 0)} usos, ${N(v.perda, 0)}% de perda)`], ...(v.obra ? [['Obra', v.obra]] : [])], desenhos: [Des.forma(p)],
        arquivo: { tipo: 'calc', titulo: `Fôrma: ${p}`, valor: area, unidade: 'm²' } };
    },
  },

  // ===================== Terra e tubulação =====================
  {
    id: 'vala', nome: 'Vala para tubulação', grupo: 'Terra e tubulação', desc: 'Escavação, berço de areia, reaterro e bota-fora em viagens',
    campos: [
      { k: 'comp', rot: 'Comprimento da vala', t: 'num', un: 'm', grupo: 'Vala', des: () => Des.vala() },
      { k: 'b', rot: 'Largura do fundo', t: 'num', un: 'm' },
      { k: 'prof', rot: 'Profundidade média', t: 'num', un: 'm' },
      { k: 'tal', rot: 'Talude (horizontal por 1 de altura)', t: 'num', un: 'H:1V', padrao: 0, dica: '0 = parede vertical (com escoramento). Ex.: 0,5 = abre 50 cm para cada metro de altura' },
      { k: 'dn', rot: 'Diâmetro externo do tubo', t: 'num', un: 'mm', grupo: 'Tubo e areia' },
      { k: 'berco', rot: 'Berço de areia (abaixo do tubo)', t: 'num', un: 'cm', padrao: 10 },
      { k: 'env', rot: 'Envoltória (acima do tubo)', t: 'num', un: 'cm', padrao: 30 },
      { k: 'emp', rot: 'Empolamento do solo', t: 'num', un: '%', padrao: 25, grupo: 'Solo e caminhões', dica: 'Quanto o solo aumenta ao ser escavado (argila ~30%, areia ~15%)' },
      { k: 'contr', rot: 'Solo do corte para 1 m³ compactado', t: 'num', un: 'm³', padrao: 1.1 },
      { k: 'cap', rot: 'Capacidade do caminhão', t: 'num', un: 'm³', padrao: 12 },
      obraCampo,
    ],
    calcular(v) {
      const H = v.prof || 0, b = v.b || 0, t = v.tal || 0, L = v.comp || 0;
      if (!(H > 0 && b > 0 && L > 0)) return { erro: 'Informe o comprimento, a largura do fundo e a profundidade.' };
      const De = (v.dn || 0) / 1000, hA = Math.min(H, (v.berco || 0) / 100 + De + (v.env || 0) / 100);
      const secTotal = (b + t * H) * H, secAreiaBruta = (b + t * hA) * hA, tubo = PI * De * De / 4;
      const esc = secTotal * L, areia = Math.max(0, secAreiaBruta - tubo) * L, reat = Math.max(0, secTotal - secAreiaBruta) * L, tuboV = tubo * L;
      const solto = esc * (1 + (v.emp || 0) / 100), soloReat = reat * (v.contr || 1) * (1 + (v.emp || 0) / 100), bota = Math.max(0, solto - soloReat), cap = v.cap || 12;
      return { destaque: m3(esc), sub: `escavação · bota-fora ${m3(bota)}`,
        resumo: [['Vala', `${N(L)} m × fundo ${N(b)} m × ${N(H)} m${t ? `, talude ${N(t)}:1` : ''}`], ['Largura em cima', N(b + 2 * t * H) + ' m'], ['Escavação (no corte)', m3(esc)],
          ['Escavação solta (caminhão)', `${m3(solto)} = ${Math.ceil(solto / cap)} viagens`], ['Tubo', `Ø externo ${N0(v.dn || 0)} mm · ${m3(tuboV)}`],
          ['Areia (berço + envoltória)', `${m3(areia)} = ${Math.ceil(areia * 1.15 / cap)} viagens (com 15% de compactação)`], ['Reaterro compactado', m3(reat)],
          ['Solo do corte para o reaterro', `${m3(soloReat)} solto`], ['Bota-fora', `${m3(bota)} = ${Math.ceil(bota / cap)} viagens de ${N(cap, 0)} m³`], ...(v.obra ? [['Obra', v.obra]] : [])],
        desenhos: [Des.vala()], arquivo: { tipo: 'calc', titulo: `Vala: ${N(L, 0)} m${v.dn ? ` · tubo ${N0(v.dn)} mm` : ''}`, valor: esc, unidade: 'm³' } };
    },
  },
  {
    id: 'terra', nome: 'Corte, aterro e empolamento', grupo: 'Terra e tubulação', desc: 'Volume no corte, solto e compactado, em viagens de caminhão',
    campos: [
      { k: 'estado', rot: 'O volume que você tem é', t: 'escolha', grupo: 'Volume', padrao: 'corte', ops: [
        { id: 'corte', nome: 'No corte (no terreno)', sub: 'medido no projeto ou topografia', des: () => Des.solo('corte') },
        { id: 'solto', nome: 'Solto (no caminhão)', sub: 'aumenta com o empolamento', des: () => Des.solo('solto') },
        { id: 'compactado', nome: 'Compactado (aterro pronto)', sub: 'diminui com a compactação', des: () => Des.solo('compactado') }] },
      { k: 'vol', rot: 'Volume', t: 'num', un: 'm³', dica: 'Ou: área × altura média do corte/aterro' },
      { k: 'emp', rot: 'Empolamento', t: 'num', un: '%', padrao: 25, grupo: 'Solo' },
      { k: 'contr', rot: 'Solo do corte para 1 m³ compactado', t: 'num', un: 'm³', padrao: 1.1 },
      { k: 'cap', rot: 'Capacidade do caminhão', t: 'num', un: 'm³', padrao: 12 },
      obraCampo,
    ],
    calcular(v) {
      if (!(v.vol > 0)) return { erro: 'Informe o volume.' };
      const e = 1 + (v.emp || 0) / 100, c = v.contr || 1;
      const corte = v.estado === 'corte' ? v.vol : v.estado === 'solto' ? v.vol / e : v.vol * c, solto = corte * e, comp = corte / c;
      return { destaque: `${Math.ceil(solto / (v.cap || 12))} viagens`, sub: `${m3(solto)} solto`, resumo: [['No corte', m3(corte)], ['Solto (caminhão)', m3(solto)], ['Compactado', m3(comp)],
        ['Viagens', `${Math.ceil(solto / (v.cap || 12))} de ${N(v.cap || 12, 0)} m³`], ...(v.obra ? [['Obra', v.obra]] : [])], desenhos: [Des.solo(v.estado)],
        arquivo: { tipo: 'calc', titulo: 'Terraplenagem', valor: corte, unidade: 'm³ no corte' } };
    },
  },
  {
    id: 'conversao', nome: 'Toneladas ↔ m³', grupo: 'Terra e tubulação', desc: 'Converter peso e volume de areia, brita, rachão, solo, cimento…',
    campos: [
      { k: 'mat', rot: 'Material', t: 'escolha', grupo: 'Material', ops: [...MATERIAIS, { id: 'cimento', nome: 'Cimento', sub: 'a granel', dens: 1.4, des: () => Des.conversao('massa') },
        { id: 'concreto', nome: 'Concreto', sub: 'fresco', dens: 2.4, des: () => Des.peca('bloco') }, { id: 'agua', nome: 'Água', sub: '', dens: 1.0, des: () => Des.reservatorio('retangular') }], padrao: 'areia' },
      { k: 'dir', rot: 'Converter', t: 'sel', ops: [['t', 'toneladas → m³'], ['m3', 'm³ → toneladas']], padrao: 't', grupo: 'Quantidade' },
      { k: 'q', rot: 'Quantidade', t: 'num', un: (v) => (v.dir === 't' ? 't' : 'm³') },
      { k: 'dens', rot: 'Massa unitária', t: 'num', un: 't/m³' },
    ],
    ao(v, k) { if (k === 'mat' || v.dens == null) v.dens = (matDe(v.mat) || { cimento: { dens: 1.4 }, concreto: { dens: 2.4 }, agua: { dens: 1 } }[v.mat]).dens; },
    calcular(v) {
      if (!(v.q > 0 && v.dens > 0)) return { erro: 'Informe a quantidade.' };
      const r = v.dir === 't' ? v.q / v.dens : v.q * v.dens, txt = v.dir === 't' ? m3(r) : N(r, 2) + ' t';
      return { destaque: txt, sub: `${N(v.q, 2)} ${v.dir === 't' ? 't' : 'm³'} a ${N(v.dens, 2)} t/m³`, resumo: [['Resultado', txt], ['Massa unitária usada', N(v.dens, 2) + ' t/m³']], semArquivo: true };
    },
  },

  // ===================== Hidráulica e conversões =====================
  {
    id: 'reservatorio', nome: 'Tanques e reservatórios', grupo: 'Hidráulica e conversões', desc: 'Volume total, volume no nível e tempo para encher',
    campos: [
      { k: 'forma', rot: 'Formato', t: 'escolha', grupo: 'Formato', padrao: 'retangular', ops: [
        { id: 'retangular', nome: 'Retangular', sub: 'decantador, floculador, caixa', des: () => Des.reservatorio('retangular') },
        { id: 'vertical', nome: 'Cilíndrico em pé', sub: 'reservatório, taça', des: () => Des.reservatorio('vertical') },
        { id: 'horizontal', nome: 'Cilíndrico deitado', sub: 'tanque, tubo', des: () => Des.reservatorio('horizontal') }] },
      { k: 'C', rot: 'Comprimento', t: 'num', un: 'm', grupo: 'Medidas internas', mostrar: (v) => v.forma !== 'vertical' },
      { k: 'L', rot: 'Largura', t: 'num', un: 'm', mostrar: (v) => v.forma === 'retangular' },
      { k: 'D', rot: 'Diâmetro', t: 'num', un: 'm', mostrar: (v) => v.forma !== 'retangular' },
      { k: 'H', rot: 'Altura', t: 'num', un: 'm', mostrar: (v) => v.forma !== 'horizontal' },
      { k: 'nivel', rot: 'Nível da água (opcional)', t: 'num', un: 'm', dica: 'Do fundo até a lâmina de água' },
      { k: 'vazao', rot: 'Vazão de enchimento (opcional)', t: 'num', un: (v) => (v.unv === 'm3h' ? 'm³/h' : 'L/s'), grupo: 'Enchimento' },
      { k: 'unv', rot: 'Unidade da vazão', t: 'sel', ops: [['ls', 'L/s'], ['m3h', 'm³/h']], padrao: 'ls' },
      obraCampo,
    ],
    calcular(v) {
      let total = 0, noNivel = null;
      if (v.forma === 'retangular') { total = (v.C || 0) * (v.L || 0) * (v.H || 0); if (v.nivel > 0) noNivel = (v.C || 0) * (v.L || 0) * Math.min(v.nivel, v.H || v.nivel); }
      else if (v.forma === 'vertical') { const A = PI * (v.D || 0) ** 2 / 4; total = A * (v.H || 0); if (v.nivel > 0) noNivel = A * Math.min(v.nivel, v.H || v.nivel); }
      else { const R = (v.D || 0) / 2; total = PI * R * R * (v.C || 0); if (v.nivel > 0) noNivel = segCirculo(R, Math.min(v.nivel, 2 * R)) * (v.C || 0); }
      if (!(total > 0)) return { erro: 'Preencha as medidas.' };
      const resumo = [['Volume total', `${m3(total)} = ${N0(total * 1000)} L`]];
      if (noNivel != null) resumo.push(['Volume no nível', `${m3(noNivel)} (${N(noNivel / total * 100, 0)}%)`]);
      if (v.vazao > 0) {
        const q = v.unv === 'm3h' ? v.vazao : v.vazao * 3.6, falta = total - (noNivel ?? 0), hr = falta / q;
        resumo.push(['Tempo para encher' + (noNivel != null ? ' (do nível até cheio)' : ''), `${Math.floor(hr)} h ${Math.round((hr % 1) * 60)} min a ${N(q, 1)} m³/h`]);
      }
      if (v.obra) resumo.push(['Obra', v.obra]);
      return { destaque: m3(total), sub: `${N0(total * 1000)} litros`, resumo, desenhos: [Des.reservatorio(v.forma)], arquivo: { tipo: 'calc', titulo: `Reservatório ${v.forma}`, valor: total, unidade: 'm³' } };
    },
  },
  {
    id: 'conversoes', nome: 'Conversões rápidas', grupo: 'Hidráulica e conversões', desc: 'Vazão, pressão, polegada, volume, declividade e área',
    campos: [
      { k: 'tipo', rot: 'Converter', t: 'escolha', padrao: 'vazao', ops: [
        { id: 'vazao', nome: 'Vazão', sub: 'L/s, m³/h, m³/dia', des: () => Des.conversao('vazao') },
        { id: 'pressao', nome: 'Pressão', sub: 'mca, kgf/cm², bar, kPa, psi', des: () => Des.conversao('pressao') },
        { id: 'pol', nome: 'Polegada', sub: 'pol ↔ mm, cm', des: () => Des.conversao('polegada') },
        { id: 'vol', nome: 'Volume', sub: 'L, m³, galão', des: () => Des.conversao('volume') },
        { id: 'decl', nome: 'Declividade', sub: '%, graus, cm/m, 1:x', des: () => Des.conversao('declividade') },
        { id: 'area', nome: 'Área', sub: 'm², hectare, alqueire', des: () => Des.revestimento(40, 40) }] },
      { k: 'x', rot: 'Valor', t: 'num', un: '' },
      { k: 'u', rot: 'Unidade', t: 'sel', ops: (v) => ({ vazao: [['ls', 'L/s'], ['m3h', 'm³/h'], ['m3d', 'm³/dia'], ['lmin', 'L/min']],
        pressao: Object.entries(PRESSAO).map(([k, x]) => [k, x[1]]), pol: [['pol', 'polegada (″)'], ['mm', 'mm'], ['cm', 'cm']],
        vol: [['l', 'litro'], ['m3', 'm³'], ['gal', 'galão (EUA, 3,785 L)'], ['lata', 'lata de 18 L']],
        decl: [['pct', '%'], ['grau', 'graus'], ['cmm', 'cm/m'], ['razao', '1 : x (x horizontal)']], area: [['m2', 'm²'], ['ha', 'hectare'], ['alqsp', 'alqueire paulista (24.200 m²)'], ['alqmg', 'alqueire mineiro/goiano (48.400 m²)'], ['km2', 'km²']] }[v.tipo]) },
    ],
    ao(v, k) { if (k === 'tipo') v.u = { vazao: 'ls', pressao: 'mca', pol: 'pol', vol: 'l', decl: 'pct', area: 'm2' }[v.tipo]; },
    calcular(v) {
      if (!Number.isFinite(v.x)) return { erro: 'Digite o valor.' };
      let linhas;
      if (v.tipo === 'vazao') { const ls = { ls: 1, m3h: 1 / 3.6, m3d: 1 / 86.4, lmin: 1 / 60 }[v.u] * v.x; linhas = [['L/s', N(ls, 3)], ['L/min', N(ls * 60, 1)], ['m³/h', N(ls * 3.6, 2)], ['m³/dia', N(ls * 86.4, 1)]]; }
      else if (v.tipo === 'pressao') { const kpa = v.x * PRESSAO[v.u][0]; linhas = [[PRESSAO[v.u][1], N(v.x, 3)], ...Object.entries(PRESSAO).filter(([k]) => k !== v.u).map(([, [f, nome]]) => [nome, N(kpa / f, f < 1 ? 1 : 3)])]; }
      else if (v.tipo === 'pol') { const mm = v.x * { pol: 25.4, mm: 1, cm: 10 }[v.u]; linhas = [['mm', N(mm, 1)], ['polegadas', N(mm / 25.4, 3) + '″'], ['cm', N(mm / 10, 2)], ['DN mais próximo', 'DN ' + DN_REF.reduce((a, b) => (Math.abs(b - mm) < Math.abs(a - mm) ? b : a))]]; }
      else if (v.tipo === 'vol') { const l = v.x * { l: 1, m3: 1000, gal: 3.78541, lata: 18 }[v.u]; linhas = [['litros', N(l, 1)], ['m³', N(l / 1000, 4)], ['galões (EUA)', N(l / 3.78541, 2)], ['latas de 18 L', N(l / 18, 1)]]; }
      else if (v.tipo === 'decl') { const p = v.u === 'pct' ? v.x : v.u === 'cmm' ? v.x : v.u === 'grau' ? Math.tan(v.x * PI / 180) * 100 : 100 / v.x; linhas = [['%', N(p, 3)], ['cm/m', N(p, 2)], ['m/m', N(p / 100, 4)], ['graus', N(Math.atan(p / 100) * 180 / PI, 3) + '°'], ['1 : x', p ? '1 : ' + N(100 / p, 1) : '—']]; }
      else { const m2 = v.x * { m2: 1, ha: 10000, alqsp: 24200, alqmg: 48400, km2: 1e6 }[v.u]; linhas = [['m²', N(m2, 2)], ['hectare', N(m2 / 1e4, 4)], ['alqueire paulista', N(m2 / 24200, 4)], ['alqueire mineiro/goiano', N(m2 / 48400, 4)], ['km²', N(m2 / 1e6, 6)]]; }
      return { destaque: linhas[0][1] + ' ' + linhas[0][0], resumo: linhas, semArquivo: true };
    },
  },
];

// pressão: unidade → [kPa por unidade, nome]
const PRESSAO = { mca: [9.80665, 'mca (metro de coluna d’água)'], kgf: [98.0665, 'kgf/cm²'], bar: [100, 'bar'], kpa: [1, 'kPa'], mpa: [1000, 'MPa'], psi: [6.894757, 'psi'], atm: [101.325, 'atm'] };
const DN_REF = [15, 20, 25, 32, 40, 50, 60, 75, 85, 100, 110, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200];

// caçambas já medidas (por placa), para não medir de novo
const normPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function cacambas() { try { return JSON.parse(localStorage.getItem('obra-cacambas')) || {}; } catch (e) { return {}; } }
function lembrarCacamba(v) {
  const p = normPlaca(v.placa); if (p.length < 6) return;
  const c = cacambas(); c[p] = { caminhao: v.caminhao, forma: v.forma, C: v.C, L: v.L, Lb: v.Lb, fc: v.fc, H: v.H };
  try { localStorage.setItem('obra-cacambas', JSON.stringify(c)); } catch (e) { /* segue */ }
}
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
