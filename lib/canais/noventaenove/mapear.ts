import { telefoneBr, type ItemExterno, type PedidoExterno } from '../tipos'

/**
 * Pedido da 99Food (orderNew / order/detail, protocolo próprio) → PedidoExterno. Puro. Preços vêm em CENTAVOS; IDs já
 * chegam como string (lerJsonComIdsGrandes). pay_type: 1 online, 2 dinheiro, 3 maquininha, 4 carteira 99 (online).
 * delivery_type: 1 entregador da 99, 2 entrega da loja. fulfillment_mode 1 = retirada no balcão (0 = entrega).
 */
type Obj = Record<string, unknown>
const o = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()
const reais = (centavos: unknown) => { const n = Number(centavos); return Number.isFinite(n) ? Math.round(n) / 100 : 0 }

function complementosDe(sub: unknown): ItemExterno['complementos'] {
  const lista = Array.isArray(sub) ? (sub as Obj[]) : []
  return lista.flatMap((s) => [
    { nome: txt(s.name), preco: reais(s.sku_price), quantidade: Math.max(1, Number(s.amount) || 1) },
    ...complementosDe(s.sub_item_list),
  ]).filter((c) => c.nome)
}

export function mapearPedido99(info: unknown): PedidoExterno {
  const p = o(info)
  const preco = o(p.price)
  const outros = o(preco.others_fees)
  const end = o(p.receive_address)
  const payType = Number(p.pay_type)
  const prepago = payType === 1 || payType === 4
  const forma: PedidoExterno['pagamento']['forma'] = payType === 2 ? 'dinheiro' : payType === 3 ? 'cartao' : 'pix'
  const trocoPara = payType === 2 && Number(p.change_for) > 0 ? reais(p.change_for) : null
  const retirada = Number(p.fulfillment_mode) === 1

  const itens: ItemExterno[] = (Array.isArray(p.order_items) ? (p.order_items as Obj[]) : []).map((it, idx) => {
    const quantidade = Math.max(1, Number(it.amount) || 1)
    const complementos = complementosDe(it.sub_item_list)
    const somaComplementos = complementos.reduce((s, c) => s + c.preco * c.quantidade, 0)
    // total_price da linha inclui os complementos; o preço unitário do item fica sem eles (como nos outros canais).
    const unitario = Math.max(0, Math.round((reais(it.total_price) / quantidade - somaComplementos) * 100) / 100)
    return {
      externoId: txt(it.mdu_id) || `${txt(p.order_id)}-${idx}`,
      codigoExterno: txt(it.app_item_id) || null,
      nome: txt(it.name) || 'Item',
      quantidade,
      precoUnitario: unitario,
      observacao: txt(it.remark),
      complementos,
    }
  })

  const subtotal = reais(preco.order_price)
  const taxaEntrega = reais(preco.delivery_price)
  const total = reais(preco.real_pay_price ?? preco.customer_need_paying_money)
  const desconto = Math.max(0, Math.round((subtotal + taxaEntrega - total) * 100) / 100)

  const nome = txt(end.name) || [txt(end.first_name), txt(end.last_name)].filter(Boolean).join(' ') || 'Cliente 99Food'
  const telefone = telefoneBr(txt(end.phone) || txt(end.virtual_phone_number))
  const rua = txt(end.street_name) || txt(end.poi_address) || txt(end.poi_display_name)
  const lat = Number(end.poi_lat)
  const lng = Number(end.poi_lng)

  const criado = Number(p.create_time)
  return {
    canal: '99food',
    externoId: txt(p.order_id),
    displayId: txt(p.order_index) || txt(p.order_id).slice(-4),
    criadoEm: Number.isFinite(criado) && criado > 0 ? new Date(criado * 1000).toISOString() : new Date().toISOString(),
    tipo: retirada ? 'retirada' : 'entrega',
    cliente: { nome, telefone, documento: null },
    endereco: retirada ? null : {
      rua, numero: txt(end.street_number), complemento: txt(end.complement), bairro: txt(end.district), cidade: txt(end.city), estado: txt(end.state),
      cep: txt(end.postalCode).replace(/\D/g, ''), referencia: txt(end.reference),
      latitude: Number.isFinite(lat) && lat !== 0 ? lat : null, longitude: Number.isFinite(lng) && lng !== 0 ? lng : null,
    },
    itens,
    subtotal,
    taxaEntrega,
    desconto,
    total,
    pagamento: {
      prepago,
      forma,
      trocoPara,
      descricao: prepago ? 'Pago no app 99Food' : payType === 2 ? `Dinheiro na entrega${trocoPara ? ` (troco para R$ ${trocoPara.toFixed(2).replace('.', ',')})` : ''}` : 'Maquininha na entrega',
    },
    entregaPor: Number(p.delivery_type) === 1 ? 'app' : 'loja',
    // A 99Food exige o número do dia e o ID do pedido no sistema e no recibo: a observação já sai no recibo.
    observacao: [txt(p.remark), `ID 99Food: ${txt(p.order_id)}`, Number(outros.coupon_discount) > 0 ? `cupom 99Food R$ ${reais(outros.coupon_discount).toFixed(2).replace('.', ',')}` : ''].filter(Boolean).join(' · '),
    agendadoPara: null,
    bruto: info,
  }
}
