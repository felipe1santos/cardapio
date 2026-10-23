import { describe, expect, it } from 'vitest'
import { mapearPedido99 } from './mapear'

/** Pedido do exemplo da documentação da 99Food (orderNew), resumido: centavos, IDs como string (lidos sem arredondar). */
const base = {
  order_id: '1152921547153933576', status: 100, order_index: 2, remark: 'sem cebola', pay_type: 1, change_for: 0, delivery_type: 2, fulfillment_mode: 0,
  create_time: 1602832474,
  price: { order_price: 2000, real_price: 2500, real_pay_price: 2500, delivery_price: 500, items_discount: 0, delivery_discount: 0, others_fees: { coupon_discount: 0 }, customer_need_paying_money: 2500, shop_paid_money: 0 },
  shop: { shop_id: '5764607688097661019', app_shop_id: 'loja-1' },
  receive_address: {
    name: 'Maria Souza', first_name: '', last_name: '', calling_code: '+55', phone: '27999990000', city: 'Vila Velha', poi_address: 'Av. Champagnat, 500 - Praia da Costa, Vila Velha - ES',
    street_name: 'Avenida Champagnat', street_number: '500', district: 'Praia da Costa', state: 'ES', postalCode: '29101220', complement: 'ap 101', reference: 'perto da praça',
    poi_lat: -20.3349, poi_lng: -40.2878, virtual_phone_number: '06234421637',
  },
  order_items: [
    { app_item_id: 'item-x', name: 'X-Burguer', total_price: 1500, sku_price: 1500, amount: 1, remark: 'bem passado', sub_item_list: [{ app_item_id: 'add-bacon', name: 'Bacon', total_price: 300, sku_price: 300, amount: 1, sub_item_list: [] }] },
    { app_item_id: 'item-coca', name: 'Coca 350', total_price: 500, sku_price: 250, amount: 2, remark: '', sub_item_list: [] },
  ],
}

describe('mapearPedido99', () => {
  it('pedido pago no app, entrega da loja', () => {
    const p = mapearPedido99(base)
    expect(p.canal).toBe('99food')
    expect(p.externoId).toBe('1152921547153933576')
    expect(p.displayId).toBe('2')
    expect(p.tipo).toBe('entrega')
    expect(p.entregaPor).toBe('loja')
    expect(p.pagamento).toMatchObject({ prepago: true, trocoPara: null })
    expect(p.cliente).toMatchObject({ nome: 'Maria Souza', telefone: '5527999990000' })
    expect(p.endereco).toMatchObject({ rua: 'Avenida Champagnat', numero: '500', bairro: 'Praia da Costa', cidade: 'Vila Velha', estado: 'ES', cep: '29101220', complemento: 'ap 101', referencia: 'perto da praça', latitude: -20.3349, longitude: -40.2878 })
    expect(p.itens).toHaveLength(2)
    expect(p.itens[0]).toMatchObject({ nome: 'X-Burguer', quantidade: 1, codigoExterno: 'item-x', observacao: 'bem passado', complementos: [{ nome: 'Bacon', preco: 3, quantidade: 1 }] })
    expect(p.itens[0].precoUnitario).toBe(12) // 15,00 da linha − 3,00 do bacon (o complemento vai à parte)
    expect(p.itens[1]).toMatchObject({ nome: 'Coca 350', quantidade: 2, precoUnitario: 2.5 })
    expect(p.subtotal).toBe(20)
    expect(p.taxaEntrega).toBe(5)
    expect(p.desconto).toBe(0)
    expect(p.total).toBe(25)
    // A 99Food exige o número do dia E o ID do pedido no sistema e no recibo: vão na observação (que já sai no recibo).
    expect(p.observacao).toContain('sem cebola')
    expect(p.observacao).toContain('1152921547153933576')
  })

  it('dinheiro com troco, entregador da 99, com desconto', () => {
    const p = mapearPedido99({ ...base, pay_type: 2, change_for: 5000, delivery_type: 1, price: { ...base.price, items_discount: 300, real_pay_price: 2200 } })
    expect(p.pagamento).toMatchObject({ prepago: false, forma: 'dinheiro', trocoPara: 50 })
    expect(p.entregaPor).toBe('app')
    expect(p.desconto).toBe(3)
    expect(p.total).toBe(22)
  })

  it('dinheiro com entregador da 99: valor que o entregador adianta à loja vai na observação', () => {
    const p = mapearPedido99({ ...base, pay_type: 2, delivery_type: 1, price: { ...base.price, shop_paid_money: 2150 } })
    expect(p.observacao).toContain('entregador 99Food paga à loja R$ 21,50')
    expect(mapearPedido99(base).observacao).not.toContain('entregador 99Food paga')
  })

  it('maquininha na entrega', () => {
    expect(mapearPedido99({ ...base, pay_type: 3 }).pagamento).toMatchObject({ prepago: false, forma: 'cartao' })
  })

  it('endereço só em poi_address (campos separados vazios)', () => {
    const p = mapearPedido99({ ...base, receive_address: { ...base.receive_address, street_name: '', street_number: '', district: '', postalCode: '' } })
    expect(p.endereco?.rua).toBe('Av. Champagnat, 500 - Praia da Costa, Vila Velha - ES')
  })

  it('sem nome usa first/last; sem nada usa "Cliente 99Food"', () => {
    expect(mapearPedido99({ ...base, receive_address: { ...base.receive_address, name: '', first_name: 'Ana', last_name: 'Lima' } }).cliente.nome).toBe('Ana Lima')
    expect(mapearPedido99({ ...base, receive_address: { ...base.receive_address, name: '', first_name: '', last_name: '' } }).cliente.nome).toBe('Cliente 99Food')
  })
})
