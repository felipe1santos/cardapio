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
