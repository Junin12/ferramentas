// Worker: lê o arquivo (DWG pelo LibreDWG, DXF pelo leitor próprio) sem travar a tela.
// Depois de ler, continua vivo guardando o desenho para as exportações que precisam dele inteiro (DXF).
'use strict';
importScripts('lib.js', 'dxf.js');

const LIBREDWG = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.14';
let libre = null;
let modelo = null;

async function carregarLibre() {
  if (libre) return libre;
  postMessage({ msg: 'Baixando o leitor de DWG (≈ 10 MB, só na primeira vez)…' });
  const mod = await import(LIBREDWG + '/dist/libredwg-web.js');
  const lib = await mod.LibreDwg.create(LIBREDWG + '/wasm');
  // dados extras de aplicativos (xdata) não servem para desenhar e eram ~95% do tempo de conversão
  lib.dwg_object_entity_get_xdata = () => [];
  // idem para o que o visualizador não usa: tipo de linha, dicionário e dono de cada entidade, miniatura dos blocos
  lib.dwg_object_entity_get_ltype_object_ref = () => ({ handleref: { value: 0 } });
  lib.dwg_object_entity_get_xdicobjhandle_object = () => ({ absolute_ref: 0 });
  lib.dwg_object_entity_get_ownerhandle_object = () => ({ absolute_ref: 0 });
  lib.dwg_entity_block_header_get_preview = () => null;
  // textos de DWG até 2004 vêm em bytes na página de código do arquivo. Muitos programas gravam a página errada
  // (ou nenhuma) e a biblioteca lê como UTF-8: cada acento vira "�". Aqui: UTF-8 só se for válido; senão, Windows-1252.
  const utf8 = new TextDecoder('utf-8', { fatal: true }), ansi = new TextDecoder('windows-1252');
  lib.dwg_dynapi_entity_value = function (obj, campo) {
    const v = this.wasmInstance.dwg_dynapi_entity_value(obj, campo);
    if (v.bin) {
      const enc = this.decoder && this.decoder.encoding;
      if (!enc || enc === 'utf-8') { try { v.data = utf8.decode(v.bin); } catch (e) { v.data = ansi.decode(v.bin); } }
      else v.data = this.decoder.decode(v.bin);
    }
    if (typeof v.data === 'string' && v.data.includes('\\U+')) v.data = v.data.replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    return v;
  };
  libre = { mod, lib };
  return libre;
}

// DXF antigo vem em ANSI (Windows-1252); a partir do AutoCAD 2007, em UTF-8
function decodificar(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}

const buffers = (r) => [r.pts.buffer, r.ini.buffer, r.cam.buffer, r.cor.buffer, r.tipo.buffer, r.snaps.buffer];

async function ler({ nome, buf }) {
  if (/\.dxf$/i.test(nome)) {
    postMessage({ msg: 'Lendo o DXF…' });
    const txt = decodificar(new Uint8Array(buf));
    if (/^\s*AutoCAD Binary DXF/.test(txt.slice(0, 30))) throw new Error('DXF binário não é suportado. Salve como DXF texto (ASCII).');
    modelo = Cad.lerDxf(txt);
  } else {
    const { mod, lib } = await carregarLibre();
    postMessage({ msg: 'Lendo o DWG…' });
    const dwg = lib.dwg_read_data(buf, mod.Dwg_File_Type.DWG);
    if (!dwg) throw new Error('Não consegui ler este DWG. Tente salvar como DXF no AutoCAD.');
    const db = lib.convert(dwg);
    lib.dwg_free(dwg);
    modelo = Cad.deLibre(db);
  }
  postMessage({ msg: 'Montando o desenho…' });
  const r = Cad.achatar(modelo);
  const fs = Cad.folhas(modelo);
  if (r.ini.length < 2 && !r.textos.length && !fs.length) throw new Error('Não achei nada desenhado neste arquivo.');
  postMessage({ pronto: r, folhas: fs }, [...buffers(r), ...fs.flatMap((f) => buffers(f.d))]);
}

onmessage = async ({ data }) => {
  try {
    if (data.acao === 'dxf') {
      const bytes = CadDxf.escrever(modelo, data.camadasOcultas || []);
      postMessage({ dxf: bytes }, [bytes.buffer]);
      return;
    }
    await ler(data);
  } catch (e) {
    const falta = /memory|alloc|Array buffer/i.test(e.message || '');
    postMessage({ erro: falta ? 'O arquivo é grande demais para a memória deste aparelho.' : e.message || 'Não consegui abrir o arquivo.' });
  }
};
