/**
 * Casos difíceis da comanda e da pré-conta do Beta (nomes longos, mesa, balcão, pago
 * parcial, taxa manual, 58 mm, os três tamanhos de letra) desenhados pelo MESMO
 * ticket.html do instalador, numa folha de contato por largura. Nunca imprime.
 *   node scripts/impressao/render-casos-v2.mjs <pasta>
 */
import { join } from 'node:path'
import { createRequire } from 'node:module'
import sharp from 'sharp'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'
import { PEDIDO, CONTA } from './render-modelos-v2.mjs'

const require = createRequire(import.meta.url)
const { montarCozinhaBeta } = require('../../printer-agent/src/cozinha-beta.js')
const { montarPreContaBeta } = require('../../printer-agent/src/pre-conta-beta.js')
const SAIDA = process.argv[2] ?? '.shots/casos-v2'

const longo = {
  ...PEDIDO, numero: 12345, canal: 'mesa', tipo: 'retirada', mesa: 'Varanda 12', formaPagamento: 'dinheiro', trocoPara: 100, observacao: 'cliente alérgico a amendoim, separar talheres',
  itens: [
    { nome: 'X-Burguer artesanal com queijo coalho grelhado e cebola caramelizada', quantidade: 12, precoUnitario: 40, observacao: 'bem passado, sem tomate e com bastante molho da casa por favor', complementos: [{ nome: 'Bacon', preco: 4 }, { nome: 'Bacon', preco: 4 }, { nome: 'Ovo', preco: 2 }] },
    { nome: 'Pizza', quantidade: 1, precoUnitario: 60, tamanhoNome: 'Grande', saborNome: 'Calabresa / Frango com Catupiry', bordaNome: 'Cheddar', massaNome: 'Fina', observacao: '', complementos: [] },
  ],
}
const balcao = { ...PEDIDO, canal: 'balcao', tipo: 'retirada', senha: 42, taxaEntrega: 0, clienteNome: 'Maria', clienteTelefone: '' }
const contaLonga = {
  ...CONTA, mesa: 'Mesa Varanda 02', cliente_nome: 'João Pedro', via: 2, taxa_extra: 15, taxa_extra_nome: 'Couvert artístico', desconto: 12.5, pago: 60, restante: 83.24, total: 143.24,
  itens: [...CONTA.itens, { quantidade: 12, nome: 'X-Burguer artesanal com queijo coalho grelhado e cebola caramelizada', subtotal: 1480, complementos: [{ nome: 'Bacon' }, { nome: 'Bacon' }, { nome: 'Ovo' }], observacao: 'bem passado' }],
}
const casos = [
  ['cozinha-mesa-longo', montarCozinhaBeta(longo, { lojaNome: 'Menuzia', extras: { comandaNumero: 175, atendente: 'Pedro' }, qr: CONTA.qr })],
  ['cozinha-balcao', montarCozinhaBeta(balcao, { lojaNome: 'Menuzia', extras: {}, qr: null })],
  ['preconta-longa', montarPreContaBeta(contaLonga)],
  ['preconta-balcao', montarPreContaBeta({ ...CONTA, tipo: 'balcao', senha: 128, mesa: null, qr: null })],
]
for (const mm of [80, 58]) {
  const cols = []
  for (const [n, doc] of casos) for (const tam of ['grande', 'media', 'pequena']) {
    const r = await renderizarTicket(doc, { larguraMm: mm, tamanhoFonte: tam, saida: join(SAIDA, `${n}-${mm}-${tam}.png`) })
    cols.push(r)
  }
  const w = mm === 80 ? 576 : 384
  const gap = 16
  const H = Math.max(...cols.map((c) => c.altura))
  await sharp({ create: { width: cols.length * (w + gap), height: H, channels: 3, background: '#9aa0a6' } })
    .composite(cols.map((c, i) => ({ input: c.png, left: i * (w + gap), top: 0 })))
    .png().toFile(join(SAIDA, `folha-${mm}.png`))
  console.log(`folha-${mm}.png`, cols.map((c) => c.altura).join(' '))
}
await fecharRender()
