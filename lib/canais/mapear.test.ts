import { describe, expect, it } from 'vitest'
import { mapearPedidoOpenDelivery } from './opendelivery/mapear'
import { mapearPedidoIfood } from './ifood/mapear'
import { etapasAEnviar, statusParaApp, telefoneBr } from './tipos'

/** Pedido no formato do Open Delivery (v1.x), como a Keeta/99Food mandam em GET /v1/orders/{id}. */
const OD = {
  id: '5e1f2c1e-5f8a-4f8e-9a0b-1c2d3e4f5a6b', displayId: '4321', createdAt: '2026-10-19T22:10:00Z', orderTiming: 'INSTANT',
  merchant: { id: 'm-1', name: 'Angus Burguer' },
  items: [
    { id: 'i1', name: 'X-Bacon', externalCode: 'item-uuid-1', quantity: 2, unitPrice: { value: 25.5, currency: 'BRL' }, totalPrice: { value: 59 }, specialInstructions: 'sem cebola',
      options: [{ id: 'o1', name: 'Bacon extra', quantity: 1, unitPrice: { value: 4 } }] },
    { id: 'i2', name: 'Coca lata', quantity: 1, unitPrice: { value: 6 }, totalPrice: { value: 6 } },
  ],
  otherFees: [{ name: 'Taxa de entrega', type: 'DELIVERY_FEE', price: { value: 7 } }],
  discounts: [{ amount: { value: 5 }, target: 'CART' }],
  total: { itemsPrice: { value: 65 }, otherFees: { value: 7 }, discount: { value: 5 }, orderAmount: { value: 67 } },
  payments: { prepaid: 67, pending: 0, methods: [{ value: 67, currency: 'BRL', method: 'CREDIT', brand: 'VISA', methodInfo: 'online' }] },
  customer: { id: 'c1', name: 'Maria Silva', documentNumber: '12345678900', phone: { number: '27 99999-1234' } },
  delivery: { deliveredBy: 'MARKETPLACE', deliveryAddress: { country: 'BR', state: 'ES', city: 'Vila Velha', district: 'Itaparica', street: 'Rua das Flores', number: '100', complement: 'Ap 2', reference: 'Perto da praça', postalCode: '29102-000', coordinates: { latitude: -20.33, longitude: -40.29 } } },
  extraInfo: 'Tocar a campainha',
}

/** Pedido no formato do iFood Merchant API (order v1.0). */
const IFOOD = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001', displayId: '7788', createdAt: '2026-10-19T22:15:00.000Z', orderType: 'DELIVERY', orderTiming: 'IMMEDIATE',
  merchant: { id: 'mer-1', name: 'Angus Burguer' },
  items: [
    { id: 'it-1', uniqueId: 'u1', name: 'Combo Supremo', externalCode: 'item-uuid-9', quantity: 1, unitPrice: 32.3, totalPrice: 36.3, observations: 'bem passado', options: [{ name: 'Cheddar', quantity: 1, unitPrice: 4 }] },
  ],
  total: { subTotal: 36.3, deliveryFee: 5.99, benefits: 0, orderAmount: 42.29, additionalFees: 0 },
  payments: { prepaid: 0, pending: 42.29, methods: [{ method: 'CASH', type: 'OFFLINE', value: 42.29, cash: { changeFor: 50 } }] },
  customer: { id: 'c-9', name: 'João', phone: { number: '0800 123 4567', localizer: '12345678' } },
  delivery: { deliveredBy: 'MERCHANT', deliveryAddress: { streetName: 'Av. Central', streetNumber: '55', complement: '', neighborhood: 'Centro', city: 'Vila Velha', state: 'ES', postalCode: '29100000', reference: '', coordinates: { latitude: -20.3, longitude: -40.3 } } },
  schedule: null, extraInfo: '',
}

describe('iFood: dados exigidos na homologação', () => {
  const base = { ...IFOOD, delivery: { ...IFOOD.delivery, observations: 'Deixar na portaria', pickupCode: '9034' } }
  it('observação de entrega e código de coleta vão na observação do pedido', () => {
    const p = mapearPedidoIfood(base)
    expect(p.observacao).toContain('Entrega: Deixar na portaria')
    expect(p.observacao).toContain('Código de coleta: 9034')
  })
  it('observação da retirada também aparece', () => {
    expect(mapearPedidoIfood({ ...IFOOD, orderType: 'TAKEOUT', takeout: { observations: 'Vaga 3' } }).observacao).toContain('Retirada: Vaga 3')
  })
  it('separa quem paga o cupom', () => {
    const p = mapearPedidoIfood({ ...IFOOD, benefits: [{ value: 14.99, sponsorshipValues: [{ name: 'IFOOD', value: 4.99 }, { name: 'MERCHANT', value: 10 }] }] })
    expect(p.observacao).toContain('cupom pago pela loja R$ 10,00')
    expect(p.observacao).toContain('cupom pago pelo iFood R$ 4,99')
  })
})

describe('canais externos: Open Delivery → PedidoExterno', () => {
  it('mapeia itens, opções, taxa, desconto, total, cliente, endereço e pagamento pré-pago', () => {
    const p = mapearPedidoOpenDelivery('keeta', OD)
    expect(p).toMatchObject({ canal: 'keeta', externoId: OD.id, displayId: '4321', tipo: 'entrega', subtotal: 65, taxaEntrega: 7, desconto: 5, total: 67, entregaPor: 'app', observacao: 'Tocar a campainha' })
    expect(p.itens).toHaveLength(2)
    expect(p.itens[0]).toMatchObject({ nome: 'X-Bacon', codigoExterno: 'item-uuid-1', quantidade: 2, precoUnitario: 25.5, observacao: 'sem cebola', complementos: [{ nome: 'Bacon extra', preco: 4, quantidade: 1 }] })
    expect(p.itens[1].codigoExterno).toBeNull()
    expect(p.cliente).toEqual({ nome: 'Maria Silva', telefone: '5527999991234', documento: '12345678900' })
    expect(p.endereco).toMatchObject({ rua: 'Rua das Flores', numero: '100', bairro: 'Itaparica', cidade: 'Vila Velha', cep: '29102000', latitude: -20.33 })
    expect(p.pagamento).toMatchObject({ prepago: true, forma: 'cartao', trocoPara: null })
  })
  it('retirada e dinheiro com troco; sem endereço', () => {
    const p = mapearPedidoOpenDelivery('99food', { ...OD, delivery: undefined, takeout: { mode: 'DEFAULT' }, payments: { prepaid: 0, pending: 67, methods: [{ value: 67, method: 'CASH', changeFor: 100 }] } })
    expect(p.tipo).toBe('retirada')
    expect(p.endereco).toBeNull()
    expect(p.pagamento).toMatchObject({ prepago: false, forma: 'dinheiro', trocoPara: 100 })
  })
})

describe('canais externos: iFood → PedidoExterno', () => {
  it('mapeia o pedido, o localizador do telefone e a entrega pela loja', () => {
    const p = mapearPedidoIfood(IFOOD)
    expect(p).toMatchObject({ canal: 'ifood', externoId: IFOOD.id, displayId: '7788', tipo: 'entrega', subtotal: 36.3, taxaEntrega: 5.99, total: 42.29, entregaPor: 'loja' })
    expect(p.itens[0]).toMatchObject({ nome: 'Combo Supremo', codigoExterno: 'item-uuid-9', precoUnitario: 32.3, observacao: 'bem passado', complementos: [{ nome: 'Cheddar', preco: 4, quantidade: 1 }] })
    expect(p.pagamento).toMatchObject({ prepago: false, forma: 'dinheiro', trocoPara: 50 })
    expect(p.observacao).toBe('Localizador iFood: 12345678')
    expect(p.endereco).toMatchObject({ rua: 'Av. Central', numero: '55', bairro: 'Centro' })
  })
  it('pago online no app = prepago, cartão', () => {
    const p = mapearPedidoIfood({ ...IFOOD, payments: { prepaid: 42.29, pending: 0, methods: [{ method: 'CREDIT', type: 'ONLINE', value: 42.29, card: { brand: 'MASTERCARD' } }] } })
    expect(p.pagamento).toMatchObject({ prepago: true, forma: 'cartao' })
  })
})

describe('status Menuzia → etapa do app', () => {
  it('traduz e só avança', () => {
    expect(statusParaApp('recebido', 'entrega')).toBeNull()
    expect(statusParaApp('preparando', 'entrega')).toBe('preparando')
    expect(statusParaApp('em_rota', 'entrega')).toBe('despachado')
    expect(statusParaApp('em_rota', 'retirada')).toBe('pronto')
    expect(etapasAEnviar(null, 'preparando')).toEqual(['confirmado', 'preparando'])
    expect(etapasAEnviar('preparando', 'despachado')).toEqual(['pronto', 'despachado'])
    expect(etapasAEnviar('despachado', 'preparando')).toEqual([])
    expect(etapasAEnviar('preparando', 'cancelado')).toEqual(['cancelado'])
    expect(etapasAEnviar('cancelado', 'entregue')).toEqual([])
  })
  it('telefone BR com DDI', () => {
    expect(telefoneBr('(27) 99999-1234')).toBe('5527999991234')
    expect(telefoneBr('5527999991234')).toBe('5527999991234')
    expect(telefoneBr('0800 123 4567')).toBe('08001234567')
  })
})
