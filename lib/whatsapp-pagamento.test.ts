import { describe, expect, it } from 'vitest'
import { montarResumoPedido } from './whatsapp'
import type { Pedido } from './queries/pedidos'

const base = {
  numero: 16, tipo: 'entrega', itens: [], subtotal: 60, desconto: 0, taxaEntrega: 3, total: 63, pago: false,
  formaPagamento: 'dinheiro', trocoPara: 100, cartaoTipo: null, clienteNome: 'Cliente', enderecoRua: 'Rua', enderecoNumero: '1',
  enderecoComplemento: '', enderecoBairro: 'Centro', enderecoCep: '', enderecoCidade: '', enderecoReferencia: '', observacao: '',
} as unknown as Pedido

describe('WhatsApp: linha de pagamento (0135)', () => {
  it('dinheiro com troco, a receber na entrega', () => {
    expect(montarResumoPedido(base, 'Loja')).toMatch(/\*Pagamento na entrega:\* Dinheiro \(troco para R\$\s100,00\)/)
  })
  it('cartão do PDV com detalhe; retirada', () => {
    const t = montarResumoPedido({ ...base, tipo: 'retirada', formaPagamento: 'cartao', cartaoTipo: 'debito', trocoPara: null } as Pedido, 'Loja')
    expect(t).toContain('*Pagamento na retirada:* Cartão de débito')
  })
  it('pago (pix da vitrine) não diz "na entrega"', () => {
    expect(montarResumoPedido({ ...base, formaPagamento: 'pix', pago: true, trocoPara: null } as Pedido, 'Loja')).toContain('*Pagamento:* Pix')
  })
})

describe('"Pedido aceito" no padrão novo (12/10)', () => {
  const comItens = { ...base, numero: 306, subtotal: 55, total: 58, itens: [
    { nome: 'Acai grandao', quantidade: 1, precoUnitario: 32, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', observacao: '',
      complementos: [{ nome: 'banana', preco: 0 }, { nome: 'leite em po', preco: 0 }, { nome: 'Morango extra', preco: 2 }] },
    { nome: 'ffd', quantidade: 1, precoUnitario: 23, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', observacao: '', complementos: [] },
  ] } as unknown as Pedido
  const t = montarResumoPedido(comItens, 'Angus Burguer')
  it('nº do pedido com fundo cinza e em negrito; item com emoji, negrito e preço em cinza', () => {
    expect(t).toContain('✅ *Pedido `#306` aceito!*')
    expect(t).toContain('🍇 *1x Acai grandao* `R$ 32,00`')
    expect(t).toContain('*1x ffd* `R$ 23,00`')
  })
  it('complementos um por linha, com emoji; grátis sem "(+R$ 0,00)"', () => {
    expect(t).toContain('   🍌 Banana\n   🥛 Leite em po\n   🍓 Morango extra `+R$ 2,00`')
    expect(t).not.toMatch(/R\$\s0,00/)
  })
  it('valores em cinza; negrito só no total', () => {
    expect(t).toContain('Subtotal: `R$ 55,00`')
    expect(t).toContain('Taxa de entrega: `R$ 3,00`')
    expect(t).toContain('*Total:* `R$ 58,00`')
    expect(t).not.toContain('*Subtotal')
  })
})
