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
  // Entrega da 99 (roteiro de homologação): a loja recebe tudo online, mesmo se o cliente pagou em dinheiro ao
  // entregador — pedido pago, sem troco e sem valor pendente.
  const entrega99 = Number(p.delivery_type) === 1
  const prepago = entrega99 || payType === 1 || payType === 4
  const forma: PedidoExterno['pagamento']['forma'] = prepago ? 'pix' : payType === 2 ? 'dinheiro' : payType === 3 ? 'cartao' : 'pix'
  const trocoPara = !prepago && payType === 2 && Number(p.change_for) > 0 ? reais(p.change_for) : null
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
  let taxaEntrega: number
  let total: number
  let desconto: number
  if (preco.real_pay_price !== undefined || preco.customer_need_paying_money !== undefined) {
    // Preço "modelo 2" (entrega da loja / retirada): vem o total que o cliente paga.
    taxaEntrega = reais(preco.delivery_price)
    total = reais(preco.real_pay_price ?? preco.customer_need_paying_money)
    desconto = Math.max(0, Math.round((subtotal + taxaEntrega - total) * 100) / 100)
  } else {
    // Preço "modelo 1" (entrega da 99): só itens e descontos; o frete, quando vem, é o original menos o desconto dele.
    taxaEntrega = Math.max(0, reais(preco.store_charged_delivery_price) - reais(preco.delivery_discount))
    desconto = reais(preco.items_discount)
    total = Math.max(0, Math.round((subtotal - desconto + taxaEntrega) * 100) / 100)
  }

  // Quem paga cada desconto (checklist da 99Food: cupom da loja x da 99). shop_subside_price = parte da loja.
  const promocoes = Array.isArray(p.promotions) ? (p.promotions as Obj[]) : []
  const descontoLoja = promocoes.reduce((s, x) => s + reais(x.shop_subside_price), 0)
  const desconto99 = promocoes.reduce((s, x) => s + Math.max(0, reais(x.promo_discount) - reais(x.shop_subside_price)), 0)
  const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

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
      cep: (txt(end.postal_code) || txt(end.postalCode)).replace(/\D/g, ''), referencia: txt(end.reference),
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
      descricao: prepago ? (entrega99 && payType === 2 ? 'Pago no app 99Food (dinheiro com o entregador da 99)' : 'Pago no app 99Food') : payType === 2 ? `Dinheiro na entrega${trocoPara ? ` (troco para R$ ${trocoPara.toFixed(2).replace('.', ',')})` : ''}` : 'Maquininha na entrega',
    },
    entregaPor: Number(p.delivery_type) === 1 ? 'app' : 'loja',
    // A 99Food exige o número do dia e o ID do pedido no sistema e no recibo: a observação já sai no recibo.
    // shop_paid_money: em dinheiro com entregador da 99, ele adianta esse valor à loja na retirada.
    observacao: [txt(p.remark), `ID 99Food: ${txt(p.order_id)}`, Number(preco.shop_paid_money) > 0 ? `entregador 99Food paga à loja R$ ${reais(preco.shop_paid_money).toFixed(2).replace('.', ',')}` : '', Number(outros.coupon_discount) > 0 ? `cupom 99Food R$ ${reais(outros.coupon_discount).toFixed(2).replace('.', ',')}` : '', descontoLoja > 0 ? `desconto pago pela loja ${brl(descontoLoja)}` : '', desconto99 > 0 ? `desconto pago pela 99Food ${brl(desconto99)}` : ''].filter(Boolean).join(' · '),
    agendadoPara: null,
    bruto: info,
  }
}
