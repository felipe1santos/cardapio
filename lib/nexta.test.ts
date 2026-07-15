import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  isoNexta,
  montarPayloadCotacao,
  montarPayloadEntrega,
  motivoRejeicaoTexto,
  telefoneNexta,
  validarAssinaturaWebhook,
  type NextaConfig,
  type NextaEntrega,
  type NextaPedido,
} from './nexta'

const cfg: NextaConfig = {
  restauranteId: 'r1',
  ativo: true,
  baseUrl: 'https://bck.nextadelivery.app/api:84_dGPfI',
  clientId: 'cid',
  clientSecret: 'segredo',
  merchantId: '12345678000199-11111111-2222-3333-4444-555555555555',
  merchantName: 'Menuzia Burger',
  cnpj: '12345678000199',
  webhookToken: 'tok',
  pickup: {
    rua: 'Avenida Ibirapuera',
    numero: '100',
    complemento: 'Loja 1',
    bairro: 'Moema',
    cidade: 'Sao Paulo',
    uf: 'SP',
    cep: '04029-000',
    latitude: -23.6015,
    longitude: -46.6664,
  },
  vehicleType: 'MOTORBIKE_BAG',
  container: 'THERMIC',
  containerSize: 'MEDIUM',
  pickupLimitMin: 30,
  deliveryLimitMin: 60,
  limitTimesAsDatetime: false,
  pesoPadraoG: 1500,
}

const entrega: NextaEntrega = {
  rua: 'Alameda dos Maracatins',
  numero: '500',
  complemento: '',
  bairro: 'Moema',
  cidade: 'Sao Paulo',
  uf: 'SP',
  cep: '04089-001',
  latitude: -23.61,
  longitude: -46.66,
  instrucoes: 'Portão azul',
}

const pedido: NextaPedido = {
  id: 'p1',
  numero: 42,
  clienteNome: 'Maria',
  clienteTelefone: '(11) 98888-7777',
  formaPagamento: 'dinheiro',
  trocoPara: 50,
  pago: false,
  total: 40,
  taxaEntrega: 8,
  criadoEm: '2026-07-15T18:00:00.000Z',
  itens: [{ nome: 'X-Burger', quantidade: 2 }],
}

const agora = new Date('2026-07-15T18:00:00.000Z')

describe('isoNexta', () => {
  it('formata em UTC RFC3339 sem milissegundos', () => {
    expect(isoNexta(new Date('2026-07-15T18:00:00.123Z'))).toBe('2026-07-15T18:00:00Z')
  })
})

describe('telefoneNexta', () => {
  it('adiciona o DDI quando o número vem só com DDD', () => {
    expect(telefoneNexta('(11) 98888-7777')).toBe('+5511988887777')
  })

  it('não duplica o DDI quando já vem com 55', () => {
    expect(telefoneNexta('5511988887777')).toBe('+5511988887777')
  })

  it('devolve vazio quando não há dígitos', () => {
    expect(telefoneNexta('')).toBe('')
  })
})

describe('montarPayloadCotacao', () => {
  const payload = montarPayloadCotacao(cfg, entrega, { totalPedido: 40, taxaEntrega: 8 }, agora)

  it('manda vehicle.type como array (string quebra o parse do Nexta)', () => {
    expect(payload.vehicle).toEqual({ type: ['MOTORBIKE_BAG'], container: 'THERMIC', containerSize: 'MEDIUM' })
  })

  it('inclui os campos opcionais de endereço mesmo vazios (ausência causa ERROR_FATAL)', () => {
    const destino = payload.deliveryAddress as Record<string, unknown>
    expect(destino.complement).toBe('')
    expect(destino.reference).toBe('')
    expect(destino.instructions).toBe('Portão azul')
  })

  it('converte UF para ISO 3166-2 e limpa o CEP', () => {
    const coleta = payload.pickupAddress as Record<string, unknown>
    expect(coleta.state).toBe('BR-SP')
    expect(coleta.postalCode).toBe('04029000')
    expect(coleta.country).toBe('BR')
  })

  it('manda limitTimes em minutos quando a flag de compatibilidade está desligada', () => {
    expect(payload.limitTimes).toEqual({ pickupLimit: 30, deliveryLimit: 60, orderCreatedAt: '2026-07-15T18:00:00Z' })
  })

  it('manda limitTimes como datetime quando a flag está ligada', () => {
    const comFlag = montarPayloadCotacao({ ...cfg, limitTimesAsDatetime: true }, entrega, { totalPedido: 40, taxaEntrega: 8 }, agora)
    expect(comFlag.limitTimes).toEqual({
      pickupLimit: '2026-07-15T18:30:00Z',
      deliveryLimit: '2026-07-15T19:00:00Z',
      orderCreatedAt: '2026-07-15T18:00:00Z',
    })
  })

  it('omite lat/lng quando o geocode do cliente falhou (0 mandaria o pino pro Atlântico)', () => {
    const semCoord = montarPayloadCotacao(cfg, { ...entrega, latitude: null, longitude: null }, { totalPedido: 40, taxaEntrega: 8 }, agora)
    const destino = semCoord.deliveryAddress as Record<string, unknown>
    expect(destino).not.toHaveProperty('latitude')
    expect(destino).not.toHaveProperty('longitude')
    expect(destino.street).toBe('Alameda dos Maracatins')
  })

  it('deixa o Nexta combinar corridas e não pede retorno à loja', () => {
    expect(payload.canCombine).toBe(true)
    expect(payload.returnToMerchant).toBe(false)
  })
})

describe('montarPayloadEntrega', () => {
  it('pedido em dinheiro vira OFFLINE com o troco em payments.change', () => {
    const payload = montarPayloadEntrega(cfg, pedido, entrega, 'order-1', agora)
    expect(payload.payments).toEqual({
      method: 'OFFLINE',
      offlineMethod: [{ type: 'CASH', amount: 40 }],
      change: { value: 50, currency: 'BRL' },
    })
  })

  it('pedido em dinheiro sem troco não manda change', () => {
    const payload = montarPayloadEntrega(cfg, { ...pedido, trocoPara: null }, entrega, 'order-1', agora)
    expect(payload.payments).toEqual({ method: 'OFFLINE', offlineMethod: [{ type: 'CASH', amount: 40 }] })
  })

  it('pedido já pago (pix na vitrine) vira ONLINE, sem troco', () => {
    const payload = montarPayloadEntrega(cfg, { ...pedido, formaPagamento: 'pix', pago: true, trocoPara: null }, entrega, 'order-1', agora)
    expect(payload.payments).toEqual({ method: 'ONLINE' })
  })

  it('cartão a receber na entrega vira OFFLINE CREDIT_DEBIT', () => {
    const payload = montarPayloadEntrega(cfg, { ...pedido, formaPagamento: 'cartao', trocoPara: null }, entrega, 'order-1', agora)
    expect(payload.payments).toEqual({ method: 'OFFLINE', offlineMethod: [{ type: 'CREDIT_DEBIT', amount: 40 }] })
  })

  it('leva orderId, nº curto do pedido, cliente e itens', () => {
    const payload = montarPayloadEntrega(cfg, pedido, entrega, 'order-1', agora)
    expect(payload.orderId).toBe('order-1')
    expect(payload.orderDisplayId).toBe('#42')
    expect(payload.customerName).toBe('Maria')
    expect(payload.customerPhone).toBe('+5511988887777')
    expect(payload.items).toEqual([{ name: 'X-Burger', quantity: 2 }])
  })

  it('prometemos só o readyForPickup — coleta e conclusão chegam por webhook', () => {
    const payload = montarPayloadEntrega(cfg, pedido, entrega, 'order-1', agora)
    expect(payload.notifyReadyForPickup).toBe(true)
    expect(payload.notifyPickup).toBe(false)
    expect(payload.notifyConclusion).toBe(false)
    expect(payload.confirmationCodeRequired).toBe(false)
  })

  it('cliente sem nome não vai vazio pro motoboy', () => {
    const payload = montarPayloadEntrega(cfg, { ...pedido, clienteNome: '' }, entrega, 'order-1', agora)
    expect(payload.customerName).toBe('Cliente')
  })

  it('mantém tudo que a cotação já mandava', () => {
    const payload = montarPayloadEntrega(cfg, pedido, entrega, 'order-1', agora)
    expect(payload.merchant).toEqual({ id: cfg.merchantId, name: 'Menuzia Burger' })
    expect(payload.totalWeight).toBe(1500)
    expect(payload.totalOrderPrice).toEqual({ value: 40, currency: 'BRL' })
    expect(payload.orderDeliveryFee).toEqual({ value: 8, currency: 'BRL' })
  })
})

describe('validarAssinaturaWebhook', () => {
  const corpo = JSON.stringify({ orderId: 'o1', event: { type: 'ACCEPTED' } })
  const assinatura = createHmac('sha256', 'segredo').update(corpo, 'utf8').digest('hex')

  it('aceita a assinatura correta', () => {
    expect(validarAssinaturaWebhook(corpo, assinatura, 'segredo')).toBe(true)
  })

  it('aceita assinatura em maiúsculas (hex é case-insensitive)', () => {
    expect(validarAssinaturaWebhook(corpo, assinatura.toUpperCase(), 'segredo')).toBe(true)
  })

  it('rejeita quando o corpo foi adulterado', () => {
    expect(validarAssinaturaWebhook(corpo + ' ', assinatura, 'segredo')).toBe(false)
  })

  it('rejeita quando o segredo é de outra loja', () => {
    expect(validarAssinaturaWebhook(corpo, assinatura, 'outro-segredo')).toBe(false)
  })

  it('rejeita quando não veio assinatura', () => {
    expect(validarAssinaturaWebhook(corpo, null, 'segredo')).toBe(false)
  })

  it('rejeita quando a loja ainda não tem client_secret', () => {
    expect(validarAssinaturaWebhook(corpo, assinatura, '')).toBe(false)
  })

  it('rejeita assinatura de tamanho diferente sem estourar', () => {
    expect(validarAssinaturaWebhook(corpo, 'abc', 'segredo')).toBe(false)
  })
})

describe('motivoRejeicaoTexto', () => {
  it('traduz os motivos conhecidos', () => {
    expect(motivoRejeicaoTexto('NO_DELIVERYPERSON_AVAILABLE')).toBe('Sem entregador disponível agora')
  })

  it('repassa motivos novos sem quebrar (a spec permite valores novos)', () => {
    expect(motivoRejeicaoTexto('ALGUM_MOTIVO_NOVO')).toBe('ALGUM_MOTIVO_NOVO')
  })

  it('trata ausência de motivo', () => {
    expect(motivoRejeicaoTexto(null)).toBe('Motivo não informado')
  })
})
