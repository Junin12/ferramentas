# Ferramentas WiApps

Site estático em https://wiapps.com.br/ferramentas/ (cPanel HostGator, pasta `public_html/ferramentas`).
Cada ferramenta é uma pasta com `index.html`; `comum/` tem o código compartilhado; `sw.js` guarda tudo para abrir sem internet.

## Mudar e publicar
1. Mude os arquivos e suba `VERSAO` no `sw.js` (arquivo novo: acrescente na lista `APP`).
2. `node tests/smoke.cjs` (precisa do `playwright` com o Chromium): todas as páginas, a busca e a troca de arquivos com o Wigo.
3. Commit e push; depois envie ao cPanel só os arquivos que mudaram (skill `publicar-jogo`, passo 4).

## Ligação com o Wigo (mesmo endereço: wiapps.com.br)
- Aberto de dentro do Wigo com `?de=wigo` (vale para a sessão): aparece o botão **Guardar no Wigo** no Escanear, e o Assinar manda o PDF assinado.
- Cache `ferr-wigo`, chaves a partir da raiz do site: `/ferr-wigo/entrada/pdf` (o Wigo manda a prancha para o Medir na prancha,
  `medir-pdf/?doc=wigo`) e `/ferr-wigo/saida/<id>` (arquivos para as Fotos da obra do Wigo).
- `localStorage` `ferr-arquivo-fila`: registros da Calculadora de obra para o Arquivo da obra.
- IndexedDB `sinapi`: a tabela importada na Consulta SINAPI; o Wigo lê a mesma base nos boletins de medição.

## Licenças
O leitor de DWG usa a `@mlightcad/libredwg-web` (GPL-3.0). Antes de vender as Ferramentas ou o Wigo como produto fechado,
veja `documentos/LICENCAS_E_VENDA.md` na pasta do Wigo (OneDrive).

## SINAPI Analítico
A Consulta SINAPI aceita também a planilha Analítico da Caixa (composições com os coeficientes). Cada base guarda, por composição,
as horas de mão de obra por unidade (`coef[código].mo`), lidas pelo Wigo no cronograma e nos Insights.
