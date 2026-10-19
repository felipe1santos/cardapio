import { num2, telefoneBr, type Canal, type ItemExterno, type PedidoExterno } from '../tipos'

/**
 * Open Delivery (Abrasel, spec v1.x — Keeta usa a 1.5, 99Food aderiu em 11/2025): traduz o `Order` do app para o
 * modelo comum. PURO (testado com um pedido de exemplo). Campos do Order: id, displayId, createdAt, orderTiming
 * (INSTANT|SCHEDULED), merchant, items[] (quantity, unitPrice{value}, totalPrice, options[], specialInstructions,
 * externalCode), otherFees[] (DELIVERY_FEE…), discounts[], total{itemsPrice, otherFees, discount, orderAmount},
 * payments{prepaid, pending, methods[]{value, method, methodInfo, changeFor}}, customer{name, phone{number}, documentNumber},
 * delivery{deliveredBy, deliveryAddress{street, number, complement, district, city, state, postalCode, reference,
 * coordinates}}, takeout{mode, takeoutDateTime}, schedule{scheduledDateTimeStart}, extraInfo.
 */
type R = Record<string, unknown>
const r = (v: unknown): R => (v && typeof v === 'object' && !Array.isArray(v) ? (v as R) : {})
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()
const valor = (v: unknown): number => (v && typeof v === 'object' ? num2((v as R).value) : num2(v))

function formaPagamento(metodo: string): 'pix' | 'cartao' | 'dinheiro' {
  const m = metodo.toUpperCase()
  if (m === 'CASH') return 'dinheiro'
  if (m === 'PIX') return 'pix'
  return 'cartao'
}

export function mapearItemOpenDelivery(i: unknown): ItemExterno {
  const it = r(i)
  const options = Array.isArray(it.options) ? it.options : []
  return {
    externoId: s(it.id),
    codigoExterno: s(it.externalCode) || null,
    nome: s(it.name) || 'Item',
    quantidade: Math.max(1, Math.round(num2(it.quantity) || 1)),
    precoUnitario: valor(it.unitPrice),
    observacao: s(it.specialInstructions),
    complementos: options.map((o) => {
      const op = r(o)
      return { nome: s(op.name) || 'Opção', preco: valor(op.unitPrice), quantidade: Math.max(1, Math.round(num2(op.quantity) || 1)) }
    }),
  }
}

export function mapearPedidoOpenDelivery(canal: Canal, bruto: unknown): PedidoExterno {
  const o = r(bruto)
  const total = r(o.total)
  const pagamentos = r(o.payments)
  const metodos = Array.isArray(pagamentos.methods) ? pagamentos.methods.map(r) : []
  const principal = metodos[0] ?? {}
  const prepago = valor(pagamentos.prepaid) > 0 && valor(pagamentos.pending) <= 0
  const entrega = r(o.delivery)
  const end = r(entrega.deliveryAddress)
  const coord = r(end.coordinates)
  const tipo: 'entrega' | 'retirada' = Object.keys(entrega).length && !Object.keys(r(o.takeout)).length ? 'entrega' : 'retirada'
  const taxas = Array.isArray(o.otherFees) ? o.otherFees.map(r) : []
  const taxaEntrega = taxas.filter((t) => s(t.type).toUpperCase() === 'DELIVERY_FEE' || /entrega|delivery/i.test(s(t.name))).reduce((a, t) => a + valor(t.price), 0)
  const cliente = r(o.customer)
  const schedule = r(o.schedule)
  const agendado = s(o.orderTiming).toUpperCase() === 'SCHEDULED' ? (s(schedule.scheduledDateTimeStart) || null) : null
  const trocoPara = s(principal.method).toUpperCase() === 'CASH' ? (valor(principal.changeFor) || null) : null
  return {
    canal,
    externoId: s(o.id),
    displayId: s(o.displayId) || s(o.id).slice(0, 8),
    criadoEm: s(o.createdAt) || new Date().toISOString(),
    tipo,
    cliente: { nome: s(cliente.name) || 'Cliente do app', telefone: telefoneBr(r(cliente.phone).number), documento: s(cliente.documentNumber) || null },
    endereco: tipo === 'entrega' ? {
      rua: s(end.street), numero: s(end.number), complemento: s(end.complement), bairro: s(end.district), cidade: s(end.city), estado: s(end.state),
      cep: s(end.postalCode).replace(/\D/g, ''), referencia: s(end.reference), latitude: coord.latitude === undefined ? null : Number(coord.latitude), longitude: coord.longitude === undefined ? null : Number(coord.longitude),
    } : null,
    itens: (Array.isArray(o.items) ? o.items : []).map(mapearItemOpenDelivery),
    subtotal: valor(total.itemsPrice),
    taxaEntrega: taxaEntrega || valor(total.otherFees),
    desconto: valor(total.discount),
    total: valor(total.orderAmount),
    pagamento: { prepago, forma: formaPagamento(s(principal.method)), trocoPara, descricao: [s(principal.method), s(principal.brand), s(principal.methodInfo)].filter(Boolean).join(' ') },
    entregaPor: s(entrega.deliveredBy).toUpperCase() === 'MERCHANT' ? 'loja' : 'app',
    observacao: s(o.extraInfo),
    agendadoPara: agendado,
    bruto,
  }
}
