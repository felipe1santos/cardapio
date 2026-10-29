import { describe, it, expect, vi, beforeEach } from 'vitest'

// Egress (29/10): a lista de impressoras só serve ao Assistente quando há pedido; sem pedido nem é lida.
const listarImpressoras = vi.fn(async () => [{ id: 'i1', largura: 48, ativa: true }])
const listarPedidosParaImprimir = vi.fn(async (): Promise<unknown[]> => [])
let quem: unknown = { tipo: 'token', restauranteId: 'loja-teste' }
let rota: Record<string, unknown> = { ativo: false }

vi.mock('@/lib/supabase/admin', () => ({ getAdminSupabase: () => ({}) }))
vi.mock('@/lib/agente-token', () => ({ lerAgenteToken: () => 'tok' }))
vi.mock('@/lib/impressao/credenciais', () => ({ identificarAgente: async () => quem }))
vi.mock('@/lib/impressao/servico', () => ({ destinoCozinha: async () => rota }))
vi.mock('@/lib/queries/impressao', () => ({
  buscarConfigImpressao: async () => ({ impressaoAutomatica: true }),
  buscarLojaImpressao: async () => ({ nome: 'Loja' }),
  haPedidoParaImprimir: async () => false,
  listarImpressoras,
  listarPedidosParaImprimir,
  registrarHeartbeatAgente: async () => undefined,
}))
vi.mock('@/lib/impressao/transferencia', () => ({ aposCorteDaTransferencia: (p: unknown[]) => p }))
vi.mock('@/lib/impressao/cozinha-beta', () => ({
  extrasDaCozinhaBeta: async () => ({}),
  lojaImpressao: async () => null,
  qrDaRotaImpressa: () => ({}),
}))
vi.mock('@/lib/impressao/alarme-assistente', () => ({ aguardandoAceite: async () => null, alarmeSabido: () => null }))
vi.mock('@/lib/impressao/despertador', () => ({
  esperarComBusca: async (_r: string, _e: number, _s: unknown, buscar: () => Promise<unknown[]>) => buscar(),
}))

const { GET } = await import('./route')
const { _limparCacheAgente } = await import('@/lib/impressao/cache-agente')

const req = () => new Request('http://x/api/agente/pedidos', { headers: { authorization: 'Bearer tok' } })

describe('GET /api/agente/pedidos: lista de impressoras', () => {
  beforeEach(() => {
    listarImpressoras.mockClear(); listarPedidosParaImprimir.mockClear(); _limparCacheAgente()
    quem = { tipo: 'token', restauranteId: 'loja-teste' }; rota = { ativo: false }
  })

  it('modo antigo sem pedido: não lê impressoras e responde impressoras: []', async () => {
    const r = await (await GET(req())).json()
    expect(listarImpressoras).not.toHaveBeenCalled()
    expect(r.impressoras).toEqual([])
    expect(r.pedidos).toEqual([])
  })
  it('modo antigo com pedido: traz a lista', async () => {
    listarPedidosParaImprimir.mockResolvedValueOnce([{ id: 'p1' }])
    const r = await (await GET(req())).json()
    expect(listarImpressoras).toHaveBeenCalledTimes(1)
    expect(r.impressoras).toHaveLength(1)
  })
  it('agente fora do modo: pedidos sempre vazios, sem ler impressoras', async () => {
    quem = { tipo: 'agente', agenteId: 'ag-1', restauranteId: 'loja-teste' }
    const r = await (await GET(req())).json()
    expect(listarImpressoras).not.toHaveBeenCalled()
    expect(r.impressoras).toEqual([])
  })
  it('rota ativa, dono, sem pedido: não lê impressoras', async () => {
    quem = { tipo: 'agente', agenteId: 'ag-1', restauranteId: 'loja-teste' }
    rota = { ativo: true, agenteId: 'ag-1' }
    const r = await (await GET(req())).json()
    expect(listarImpressoras).not.toHaveBeenCalled()
    expect(r.impressoras).toEqual([])
  })
  it('rota ativa, dono, com pedido: traz a lista', async () => {
    quem = { tipo: 'agente', agenteId: 'ag-1', restauranteId: 'loja-teste' }
    rota = { ativo: true, agenteId: 'ag-1' }
    listarPedidosParaImprimir.mockResolvedValueOnce([{ id: 'p1', tipo: 'retirada' }])
    const r = await (await GET(req())).json()
    expect(r.impressoras).toHaveLength(1)
  })
})
