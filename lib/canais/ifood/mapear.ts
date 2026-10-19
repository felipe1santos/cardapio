import { num2, telefoneBr, type ItemExterno, type PedidoExterno } from '../tipos'

/**
 * iFood Merchant API (order v1.0): traduz o detalhe do pedido (GET /order/v1.0/orders/{id}) para o modelo comum. PURO.
 * Campos usados: id, displayId, createdAt, orderType (DELIVERY|TAKEOUT|INDOOR), orderTiming (IMMEDIATE|SCHEDULED),
 * items[] (id, name, externalCode, quantity, unitPrice, totalPrice, observations, options[]{name, quantity, unitPrice}),
 * total{subTotal, deliveryFee, benefits, orderAmount, additionalFees}, payments{prepaid, pending, methods[]{method, type
 * (ONLINE|OFFLINE), value, cash{changeFor}, card{brand}}}, customer{name, phone{number, localizer}, documentNumber},
 * delivery{deliveredBy (IFOOD|MERCHANT), deliveryAddress{streetName, streetNumber, complement, neighborhood, city, state,
 * postalCode, reference, coordinates}}, schedule{deliveryDateTimeStart}, extraInfo.
 */
type R = Record<string, unknown>
const r = (v: unknown): R => (v && typeof v === 'object' && !Array.isArray(v) ? (v as R) : {})
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

function formaPagamento(metodo: string, tipo: string): 'pix' | 'cartao' | 'dinheiro' {
  const m = metodo.toUpperCase()
  if (m === 'CASH') return 'dinheiro'
  if (m === 'PIX') return 'pix'
  if (tipo.toUpperCase() === 'ONLINE') return 'cartao'
  return 'cartao'
}

export function mapearItemIfood(i: unknown): ItemExterno {
  const it = r(i)
  const options = Array.isArray(it.options) ? it.options : []
  return {
    externoId: s(it.id) || s(it.uniqueId),
    codigoExterno: s(it.externalCode) || null,
    nome: s(it.name) || 'Item',
    quantidade: Math.max(1, Math.round(num2(it.quantity) || 1)),
    precoUnitario: num2(it.unitPrice),
    observacao: s(it.observations),
    complementos: options.map((o) => {
      const op = r(o)
      return { nome: s(op.name) || 'Opção', preco: num2(op.unitPrice), quantidade: Math.max(1, Math.round(num2(op.quantity) || 1)) }
    }),
  }
}

export function mapearPedidoIfood(bruto: unknown): PedidoExterno {
  const o = r(bruto)
  const total = r(o.total)
  const pagamentos = r(o.payments)
  const metodos = Array.isArray(pagamentos.methods) ? pagamentos.methods.map(r) : []
  const principal = metodos[0] ?? {}
  const prepago = num2(pagamentos.prepaid) > 0 && num2(pagamentos.pending) <= 0
  const tipo: 'entrega' | 'retirada' = s(o.orderType).toUpperCase() === 'DELIVERY' ? 'entrega' : 'retirada'
  const entrega = r(o.delivery)
  const end = r(entrega.deliveryAddress)
  const coord = r(end.coordinates)
  const cliente = r(o.customer)
  const fone = r(cliente.phone)
  const schedule = r(o.schedule)
  const agendado = s(o.orderTiming).toUpperCase() === 'SCHEDULED' ? (s(schedule.deliveryDateTimeStart) || null) : null
  const cash = r(principal.cash)
  const trocoPara = s(principal.method).toUpperCase() === 'CASH' ? (num2(cash.changeFor) || null) : null
  // O telefone do iFood é um número intermediário (0800 + localizador): guardamos como vem; o localizador vai na observação.
  const localizador = s(fone.localizer)
  const observacao = [s(o.extraInfo), localizador ? `Localizador iFood: ${localizador}` : ''].filter(Boolean).join(' · ')
  return {
    canal: 'ifood',
    externoId: s(o.id),
    displayId: s(o.displayId) || s(o.id).slice(0, 8),
    criadoEm: s(o.createdAt) || new Date().toISOString(),
    tipo,
    cliente: { nome: s(cliente.name) || 'Cliente iFood', telefone: telefoneBr(fone.number), documento: s(cliente.documentNumber) || null },
    endereco: tipo === 'entrega' ? {
      rua: s(end.streetName), numero: s(end.streetNumber), complemento: s(end.complement), bairro: s(end.neighborhood), cidade: s(end.city), estado: s(end.state),
      cep: s(end.postalCode).replace(/\D/g, ''), referencia: s(end.reference), latitude: coord.latitude === undefined ? null : Number(coord.latitude), longitude: coord.longitude === undefined ? null : Number(coord.longitude),
    } : null,
    itens: (Array.isArray(o.items) ? o.items : []).map(mapearItemIfood),
    subtotal: num2(total.subTotal),
    taxaEntrega: num2(total.deliveryFee),
    desconto: num2(total.benefits),
    total: num2(total.orderAmount),
    pagamento: { prepago, forma: formaPagamento(s(principal.method), s(principal.type)), trocoPara, descricao: [s(principal.method), s(r(principal.card).brand), s(principal.type)].filter(Boolean).join(' ') },
    entregaPor: s(entrega.deliveredBy).toUpperCase() === 'MERCHANT' ? 'loja' : 'app',
    observacao,
    agendadoPara: agendado,
    bruto,
  }
}
