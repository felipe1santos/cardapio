// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA DE CALIBRAÇÃO (Assistente Beta 0.2+).
//
// Prova, no papel, até onde a impressora imprime: régua numerada em pontos com bordas
// nas duas pontas (marcador K do print.ps1), texto, negrito, valores em reais alinhados
// à direita e o que o Windows informa do driver. Não é recibo nem ficha: o recibo da
// cozinha (recibo.js) não é tocado.
// ─────────────────────────────────────────────────────────────────────────────

const { brl } = require('./pre-conta')

const SOH = '\x01'
const STX = '\x02'

/** Largura em pontos que o print.ps1 usa: o perfil da impressora ou o padrão do papel. */
function larguraEfetiva(larguraMm, larguraPontos) {
  const n = Number(larguraPontos)
  if (Number.isInteger(n) && n >= 256 && n <= 832) return n
  return Number(larguraMm) <= 58 ? 384 : 576
}

function texto(v, sufixo = '') {
  return v === undefined || v === null || v === '' ? '—' : `${v}${sufixo}`
}

/**
 * Linhas da página de calibração. `s` é o snapshot do servidor (impressao_calibracao_criar);
 * `diag` é o que o Windows informou desta impressora (diagnostico-impressoras.ps1).
 */
function montarCalibracaoLinhas(s, diag = {}) {
  const L = []
  const N = (t) => L.push(`${SOH}N${STX}${t}`)
  const H = (t) => L.push(`${SOH}H${STX}${t}`)
  const C = (t) => L.push(`${SOH}C${STX}${t}`)
  const I = (a, b) => L.push(`${SOH}I${STX}${a}${STX}${b}`)
  const P = (a, b) => L.push(`${SOH}P${STX}${a}${STX}${b}`)
  const T = (a, b) => L.push(`${SOH}T${STX}${a}${STX}${b}`)
  const Lin = (t) => L.push(`${SOH}L${STX}${t}`)
  const R = () => L.push(`${SOH}R`)
  const K = () => L.push(`${SOH}K`)
  const F = (t) => L.push(`${SOH}F${STX}${t}`)

  const largura = larguraEfetiva(s.largura_mm, s.largura_pontos)
  const desloc = Number(s.deslocamento_pontos) || 0

  if (s.loja) N(String(s.loja).toUpperCase())
  H('CALIBRAÇÃO DA IMPRESSORA')
  C(String(s.impressora ?? s.nome_sistema ?? ''))
  K()
  Lin('As duas barras pretas (esquerda e direita) precisam aparecer inteiras.')
  Lin('Anote o ÚLTIMO número que aparece inteiro à direita da régua.')
  K()

  H('O QUE O WINDOWS INFORMA')
  P('Impressora', texto(s.nome_sistema))
  P('Driver', texto(diag.driver))
  P('Porta', texto(diag.porta))
  P('DPI', diag.dpiX ? `${diag.dpiX} x ${texto(diag.dpiY)}` : '—')
  P('Papel', `${texto(diag.papelLarguraMm ?? s.largura_mm)} mm`)
  P('Área imprimível', texto(diag.areaImprimivelLarguraMm, ' mm'))
  P('Margem esq./dir.', `${texto(diag.margemEsquerdaMm, ' mm')} / ${texto(diag.margemDireitaMm, ' mm')}`)
  P('Pontos imprimíveis', texto(diag.pontosImprimiveis))

  H('O QUE O MENUZIA APLICA')
  P('Largura aplicada', `${largura} pontos`)
  P('Deslocamento', `${desloc} pontos`)
  P('Escala', '1:1 (sem redução)')
  P('Perfil', s.largura_pontos ? 'calibrado' : 'padrão do papel')

  H('TEXTO E VALORES')
  Lin('Texto normal: ÁÉÍÓÚ ÂÊÔ ÃÕ Ç à ü')
  I('1x X-Burguer Duplo com Bacon e Cheddar Cremoso', brl(38.9))
  I('2x Refrigerante Lata', brl(12))
  P('Subtotal', brl(1234.56))
  P('Desconto', brl(-10))
  T('TOTAL', brl(12345.67))
  R()
  C(`Pedido por: ${texto(s.operador)}`)
  F('Fotografe a folha inteira, com as duas bordas.')
  F('O valor do TOTAL tem que aparecer completo.')
  return L
}

function montarCalibracao(s, diag) {
  return montarCalibracaoLinhas(s, diag).join('\n')
}

module.exports = { montarCalibracao, montarCalibracaoLinhas, larguraEfetiva }
