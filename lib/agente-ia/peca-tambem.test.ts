import { describe, expect, it } from 'vitest'
import { sugestoesPecaTambem, textoPecaTambem } from './peca-tambem'
import type { ItemIa } from './cardapio'

const item = (id: string, nome: string, categoria: string, preco: number, situacao = 'disponivel'): ItemIa =>
  ({ id, nome, descricao: '', categoria, posicao: 0, preco, precoCheio: null, situacao, tipo: 'simples', grupos: [], tamanhos: [], sabores: [] })
const cardapio = [
  item('b1', 'Coca lata', 'Bebidas', 6), item('b2', 'Guaraná 2L', 'Bebidas', 12), item('b3', 'Suco', 'Bebidas', 9, 'esgotado'),
  item('a1', 'Batata média', 'Acompanhamentos', 12), item('a2', 'Onion rings', 'Porções', 15),
  item('l1', 'X-Bacon', 'Lanches', 30),
]

describe('"Peça também" (order bump): até 2 sugestões escolhidas pelo servidor', () => {
  it('1 acompanhamento + 1 bebida, os mais vendidos, disponíveis e fora do carrinho', () => {
    const vendas = new Map([['b2', 50], ['b1', 10], ['a2', 30], ['a1', 5]])
    const s = sugestoesPecaTambem(cardapio, ['l1'], vendas)
    expect(s.map((x) => x.id)).toEqual(['a2', 'b2'])
  })
  it('não sugere o que já está no carrinho nem item indisponível', () => {
    const s = sugestoesPecaTambem(cardapio, ['l1', 'a2', 'b2'], new Map([['b3', 99]]))
    expect(s.map((x) => x.id)).toEqual(['a1', 'b1'])
  })
  it('loja sem bebida nem acompanhamento: nada', () => {
    expect(sugestoesPecaTambem([item('l1', 'X-Bacon', 'Lanches', 30)], [], new Map())).toEqual([])
  })
  it('texto: lista numerada, emoji, nome em negrito, preço em cinza; aceita número ou "não"', () => {
    const t = textoPecaTambem([item('a1', 'Batata média', 'Acompanhamentos', 12), item('b1', 'Coca lata', 'Bebidas', 6)])
    // Sem número na frente (12/10: números só no robô sem IA).
    expect(t).toBe('Quer acompanhar? 😋\n\n🍟 *Batata média* `R$ 12,00`\n🥤 *Coca lata* `R$ 6,00`\n\n_Se não quiser, é só dizer "não"._')
  })
})

describe('"Peça também" uma vez por pedido', () => {
  const agora = Date.parse('2026-10-12T21:00:00Z')
  it('ainda não ofereceu / ofereceu antes do último pedido / há mais de 3 h → oferece', async () => {
    const { bumpJaOferecido } = await import('./peca-tambem')
    expect(bumpJaOferecido(null, agora)).toBe(false)
    expect(bumpJaOferecido({ ia_bump_em: '2026-10-12T20:00:00Z', ia_pedido_em: '2026-10-12T20:30:00Z' }, agora)).toBe(false)
    expect(bumpJaOferecido({ ia_bump_em: '2026-10-12T17:00:00Z' }, agora)).toBe(false)
  })
  it('ofereceu neste pedido → não oferece de novo (respeita o "não")', async () => {
    const { bumpJaOferecido } = await import('./peca-tambem')
    expect(bumpJaOferecido({ ia_bump_em: '2026-10-12T20:50:00Z', ia_pedido_em: '2026-10-12T19:00:00Z' }, agora)).toBe(true)
  })
})
