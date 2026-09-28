/**
 * Desenha a comanda e a pré-conta do Beta com os DADOS DOS MODELOS
 * (docs/referencias/impressao/v2) — para comparar lado a lado. Nunca imprime.
 *   node scripts/impressao/render-modelos-v2.mjs <pasta> [grande|media|pequena]
 */
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'

const require = createRequire(import.meta.url)
const QRCode = require('qrcode')
const { montarCozinhaBeta } = require('../../printer-agent/src/cozinha-beta.js')
const { montarPreContaBeta } = require('../../printer-agent/src/pre-conta-beta.js')
const SAIDA = process.argv[2] ?? '.shots/modelos-v2'
const TAM = process.argv[3] ?? 'grande'

function qr(url, instagram) {
  const q = QRCode.create(url, { errorCorrectionLevel: instagram ? 'H' : 'M' })
  const n = q.modules.size
  return { origem: instagram ? 'instagram' : 'cardapio', url, linhas: Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (q.modules.get(y, x) ? '1' : '0')).join('')) }
}
const IG = qr('https://instagram.com/menuzia', true)
const hora = (h, m) => new Date(Date.UTC(2026, 8, 28, h + 3, m)).toISOString()

export const PEDIDO = {
  id: 'modelo', numero: 129, tipo: 'entrega', canal: 'delivery', origem: 'cardapio', formaPagamento: 'pix', trocoPara: null,
  clienteNome: 'teste claude', clienteTelefone: '552799920804', enderecoRua: 'Avenida Henrique Moscoso', enderecoNumero: '1',
  enderecoComplemento: '', enderecoBairro: 'JABURUNA', observacao: '', pago: false, mesa: null, senha: null,
  subtotal: 44.4, taxaEntrega: 3, total: 45.4, criadoEm: hora(13, 52),
  itens: [
    { nome: 'Bolo Duplo', quantidade: 1, precoUnitario: 19.9, observacao: 'cortar ao meio e enviar', complementos: [{ nome: 'Calda de chocolate', preco: 2 }, { nome: 'Morango extra', preco: 3 }] },
    { nome: 'Coca-Cola Lata 350ml', quantidade: 1, precoUnitario: 5, observacao: '', complementos: [] },
    { nome: 'Coxinha', quantidade: 2, precoUnitario: 9.75, observacao: '', complementos: [{ nome: 'Catupiry', preco: 2 }, { nome: 'Molho especial', preco: 0.75 }] },
  ],
}
const EXTRAS = { desconto: 2, prontoEm: hora(14, 9) }
export const CONTA = {
  loja: 'Menuzia', tipo: 'mesa', mesa: '08', comanda_numero: 55, pedido_numero: 102, impresso_em: hora(14, 16), via: 1,
  itens: [
    { quantidade: 1, nome: 'X-Burger Artesanal', preco_unitario: 28.9, subtotal: 28.9, complementos: [] },
    { quantidade: 2, nome: 'Coca-Cola Lata', preco_unitario: 7, subtotal: 14, complementos: [] },
    { quantidade: 1, nome: 'Batata Frita', preco_unitario: 18.5, subtotal: 18.5, complementos: [] },
    { quantidade: 1, nome: 'Pudim da Casa', preco_unitario: 12, subtotal: 12, complementos: [] },
  ],
  subtotal: 73.4, taxa_percentual: 10, taxa: 7.34, taxa_extra: 0, desconto: 0, total: 80.74, pago: 0, restante: 80.74, qr: IG,
}

if (process.argv[1] && process.argv[1].endsWith('render-modelos-v2.mjs')) {
  const casos = [
    ['cozinha-80', montarCozinhaBeta(PEDIDO, { lojaNome: 'Menuzia', extras: EXTRAS, qr: IG }), 80],
    ['preconta-80', montarPreContaBeta(CONTA), 80],
    ['cozinha-58', montarCozinhaBeta(PEDIDO, { lojaNome: 'Menuzia', extras: EXTRAS, qr: IG }), 58],
    ['preconta-58', montarPreContaBeta(CONTA), 58],
  ]
  for (const [n, doc, mm] of casos) {
    const r = await renderizarTicket(doc, { larguraMm: mm, tamanhoFonte: TAM, saida: join(SAIDA, `${n}-${TAM}.png`) })
    console.log(n, `${r.largura}x${r.altura}`)
  }
  await fecharRender()
}
