import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  ambienteDaChave, assinarLalamove, cabecalhosLalamove, finalDaChave, lerCidades, lerCotacao, lerMotorista, lerPedido, mensagemErroLalamove,
  montarCotacao, montarPedido, MSG_FORA_DA_AREA, orderIdDoWebhook, servicoDeMoto, telefoneLalamove, tipoDoWebhook,
} from './lalamove-regras'
import { cidadeDaLoja, coberturaLalamove } from './lalamove-cidades'

describe('assinatura HMAC v3', () => {
  it('assina <ts>\\r\\n<verbo>\\r\\n<caminho>\\r\\n\\r\\n<corpo> em hex minúsculo', () => {
    const esperado = createHmac('sha256', 'segredo').update('1700000000000\r\nPOST\r\n/v3/quotations\r\n\r\n{"a":1}').digest('hex')
    expect(assinarLalamove('segredo', 1700000000000, 'post', '/v3/quotations', '{"a":1}')).toBe(esperado)
  })
  it('cabeçalhos: hmac KEY:TS:SIG, Market BR, Request-ID', () => {
    const h = cabecalhosLalamove({ apiKey: 'pk_test_abc', apiSecret: 's' }, 'GET', '/v3/cities', '', 1, 'req-1')
    expect(h.Authorization).toBe(`hmac pk_test_abc:1:${assinarLalamove('s', 1, 'GET', '/v3/cities', '')}`)
    expect(h.Market).toBe('BR'); expect(h['Request-ID']).toBe('req-1')
  })
  it('ambiente pela chave e final mascarado', () => {
    expect(ambienteDaChave('pk_test_xyz')).toBe('sandbox'); expect(ambienteDaChave('pk_prod_xyz')).toBe('producao'); expect(ambienteDaChave('abc')).toBeNull()
    expect(finalDaChave('pk_test_1234abcd')).toBe('abcd')
  })
})

describe('cotação e pedido', () => {
  const loja = { lat: -23.5505, lng: -46.6333, endereco: 'Praça da Sé, 1, Centro, São Paulo' }
  const cli = { lat: -23.5614, lng: -46.6559, endereco: 'Av. Paulista, 1578, São Paulo' }
  it('monta a cotação com 2 paradas, coordenadas em texto e pt_BR', () => {
    const c = montarCotacao('MOTORCYCLE', loja, cli) as { data: { stops: { coordinates: { lat: string } }[]; language: string; serviceType: string } }
    expect(c.data.stops).toHaveLength(2); expect(c.data.stops[0].coordinates.lat).toBe('-23.550500'); expect(c.data.language).toBe('pt_BR'); expect(c.data.serviceType).toBe('MOTORCYCLE')
  })
  it('lê a cotação (envelope data) e converte km em metros', () => {
    const r = lerCotacao({ data: { quotationId: 'q1', expiresAt: '2026-10-18T20:00:00Z', priceBreakdown: { total: '14.50', currency: 'BRL' }, distance: { value: '3.2', unit: 'km' }, stops: [{ stopId: 's1' }, { stopId: 's2' }] } })
    expect(r).toMatchObject({ quotationId: 'q1', preco: 14.5, moeda: 'BRL', distanciaM: 3200, paradas: ['s1', 's2'] })
    expect(lerCotacao({ data: { quotationId: 'q' } })).toBeNull()
  })
  it('monta o pedido com remetente (loja) e destinatário (cliente) nos stopIds da cotação, telefone +55', () => {
    const cot = lerCotacao({ data: { quotationId: 'q1', priceBreakdown: { total: '10' }, stops: [{ stopId: 'A' }, { stopId: 'B' }] } })!
    const p = montarPedido(cot, { nome: 'Angus', telefone: '(27) 99253-4407' }, { numero: 500, clienteNome: 'Maria', clienteTelefone: '27988887777', observacao: 'sem cebola', complemento: 'ap 12', referencia: '' }, 'ped-1') as { data: Record<string, unknown> }
    expect(p.data.quotationId).toBe('q1')
    expect(p.data.sender).toEqual({ stopId: 'A', name: 'Angus', phone: '+5527992534407' })
    expect(p.data.recipients).toEqual([{ stopId: 'B', name: 'Maria', phone: '+5527988887777', remarks: 'Compl.: ap 12 · Obs.: sem cebola' }])
    expect(p.data.metadata).toEqual({ menuziaPedidoId: 'ped-1', numero: '500' })
  })
  it('telefone: já com 55 não duplica', () => { expect(telefoneLalamove('5527999990000')).toBe('+5527999990000'); expect(telefoneLalamove('')).toBe('') })
  it('lê pedido e motorista', () => {
    expect(lerPedido({ data: { orderId: 'o1', status: 'on_going', shareLink: 'https://l/x', driverId: 'd1', priceBreakdown: { total: '12' } } })).toMatchObject({ orderId: 'o1', status: 'ON_GOING', shareLink: 'https://l/x', driverId: 'd1', preco: 12 })
    expect(lerMotorista({ data: { driverId: 'd1', name: 'João', phone: '+5511999', plateNumber: '**C1D2*' } })).toEqual({ driverId: 'd1', nome: 'João', telefone: '+5511999', placa: '**C1D2*' })
  })
  it('webhook: orderId em data.order.orderId, data.orderId ou orderId; tipo do evento', () => {
    expect(orderIdDoWebhook({ eventType: 'ORDER_STATUS_CHANGED', data: { order: { orderId: 'o1' } } })).toBe('o1')
    expect(orderIdDoWebhook({ data: { orderId: 'o2' } })).toBe('o2'); expect(orderIdDoWebhook({ orderId: 'o3' })).toBe('o3'); expect(orderIdDoWebhook('x')).toBeNull()
    expect(tipoDoWebhook({ eventType: 'DRIVER_ASSIGNED' })).toBe('DRIVER_ASSIGNED')
  })
  it('cidades: lê locode/serviços e escolhe moto', () => {
    const c = lerCidades({ data: [{ locode: 'BR SAO', name: 'São Paulo', services: [{ key: 'CAR' }, { key: 'MOTORCYCLE' }] }] })
    expect(c).toEqual([{ locode: 'BR SAO', nome: 'São Paulo', servicos: ['CAR', 'MOTORCYCLE'] }])
    expect(servicoDeMoto(c[0].servicos)).toBe('MOTORCYCLE'); expect(servicoDeMoto(['VAN'])).toBe('VAN'); expect(servicoDeMoto([])).toBe('MOTORCYCLE')
  })
})

describe('mensagens de erro', () => {
  it('fora da área vira a frase do dono, sem erro técnico', () => {
    expect(mensagemErroLalamove(422, { message: 'ERR_OUT_OF_SERVICE_AREA' })).toBe(MSG_FORA_DA_AREA)
    expect(mensagemErroLalamove(422, { errors: [{ message: 'ERR_INVALID_FIELD', detail: 'stops outside service area' }] })).toBe(MSG_FORA_DA_AREA)
  })
  it('401, 402, 409 cancelamento, cotação vencida', () => {
    expect(mensagemErroLalamove(401, {})).toMatch(/Chaves/); expect(mensagemErroLalamove(402, {})).toMatch(/saldo/)
    expect(mensagemErroLalamove(409, { message: 'ERR_CANCELLATION_FORBIDDEN' })).toMatch(/não permite mais cancelar/)
    expect(mensagemErroLalamove(422, { message: 'ERR_INVALID_QUOTATION_ID' })).toMatch(/cotação venceu/)
  })
})

describe('cobertura por cidade', () => {
  it('oficial, vizinha (Niterói → Rio) e fora', () => {
    expect(coberturaLalamove('São Luís')).toEqual({ atende: true, cidade: 'São Luís' })
    expect(coberturaLalamove('NITERÓI')).toMatchObject({ atende: true, vizinha: 'Rio de Janeiro' })
    expect(coberturaLalamove('Baixo Guandu')).toEqual({ atende: false, cidade: 'Baixo Guandu' })
    expect(coberturaLalamove('Vila Velha')).toEqual({ atende: false, cidade: 'Vila Velha' })
    expect(coberturaLalamove('')).toEqual({ atende: 'desconhecida' })
  })
  it('cidade da loja: campo próprio ou fim do endereço livre', () => {
    expect(cidadeDaLoja({ enderecoCidade: 'Niterói', endereco: 'x' })).toBe('Niterói')
    expect(cidadeDaLoja({ enderecoCidade: '', endereco: 'Rua Pedro Álvares Cabral, 400 - Prédio, sao vicente, Baixo Guandu - ES' })).toBe('Baixo Guandu')
    expect(cidadeDaLoja({ endereco: '' })).toBe('')
  })
})
