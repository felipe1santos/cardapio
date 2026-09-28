/**
 * Casos difíceis da comanda e da pré-conta do Beta (nomes longos, mesa, balcão, sem QR,
 * Instagram, logo da loja, pago parcial, taxa manual, 58 mm, os três tamanhos de letra)
 * desenhados pelo MESMO ticket.html do instalador, numa folha de contato por largura.
 * Nunca imprime.   node scripts/impressao/render-casos-v3.mjs <pasta> [logo.png]
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import sharp from 'sharp'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'
import { qr, LOJA, LOJA_PC } from './render-modelos-v3.mjs'
import { snapshotCozinhaTeste, snapshotReciboTeste } from '../../lib/impressao/recibo-teste.ts'

const require = createRequire(import.meta.url)
const { montarCozinhaBeta } = require('../../printer-agent/src/cozinha-beta.js')
const { montarPreContaBeta } = require('../../printer-agent/src/pre-conta-beta.js')
const SAIDA = process.argv[2] ?? '.shots/casos-v3'
const LOGO = process.argv[3] ? `data:image/png;base64,${readFileSync(process.argv[3]).toString('base64')}` : null
const IG = qr('https://instagram.com/pizzadorosa', true)
const D = { loja: 'Pizza do Rosa', impressora: '', nomeSistema: '', computador: '', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }
const sc = snapshotCozinhaTeste(D, '', IG)
const sp = snapshotReciboTeste(D, '')

const longo = {
  ...sc.pedido, numero: 12345, canal: 'mesa', tipo: 'retirada', mesa: 'Varanda 12', formaPagamento: 'dinheiro', trocoPara: 100, observacao: 'cliente alérgico a amendoim, separar talheres',
  itens: [
    { nome: 'X-Burguer artesanal com queijo coalho grelhado e cebola caramelizada', quantidade: 12, precoUnitario: 48, observacao: 'bem passado, sem tomate e com bastante molho da casa por favor', complementos: [{ nome: 'Bacon', preco: 4 }, { nome: 'Bacon', preco: 4 }, { nome: 'Ovo', preco: 0 }] },
    { nome: 'Pizza', quantidade: 1, precoUnitario: 60, tamanhoNome: 'Grande', saborNome: 'Calabresa / Frango com Catupiry', bordaNome: 'Cheddar', massaNome: 'Fina', observacao: '', complementos: [] },
  ],
}
const balcao = { ...sc.pedido, canal: 'balcao', tipo: 'retirada', senha: 42, taxaEntrega: 0, clienteNome: 'Maria', clienteTelefone: '', formaPagamento: 'cartao' }
const contaLonga = { ...sp, recibo_teste: false, tipo: 'mesa', mesa: 'Mesa Varanda 02', via: 2, taxa_extra: 15, taxa_extra_nome: 'Couvert artístico', taxa: 25.07, taxa_percentual: 10, qr: IG, loja_dados: LOJA_PC }
const contaBalcao = { ...sp, recibo_teste: false, tipo: 'balcao', senha: 128, mesa: null, pago: 0, restante: sp.total, qr: null, loja_dados: { nome: 'Loja Sem Endereço' } }
const casos = [
  ['cozinha-mesa-longo', montarCozinhaBeta(longo, { lojaNome: 'Pizza do Rosa', loja: LOJA, extras: { comandaNumero: 175, atendente: 'Pedro' }, qr: IG, config: { multiplicarOpcoesQtd: true, fonteMaiorProducao: true } })],
  ['cozinha-balcao', montarCozinhaBeta(balcao, { lojaNome: 'Loja Com Nome Bem Comprido Para Testar', loja: { nome: 'Loja Com Nome Bem Comprido Para Testar' }, extras: {}, qr: null })],
  ['preconta-longa', montarPreContaBeta(contaLonga)],
  ['preconta-balcao', montarPreContaBeta(contaBalcao)],
]
for (const mm of [80, 58]) {
  const cols = []
  for (const [n, doc] of casos) for (const tam of ['grande', 'media', 'pequena']) {
    cols.push(await renderizarTicket(doc, { larguraMm: mm, tamanhoFonte: tam, logo: LOGO, imprimirLogo: true, saida: join(SAIDA, `${n}-${mm}-${tam}.png`) }))
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
