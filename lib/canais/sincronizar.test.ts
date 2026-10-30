import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConfigCanal } from './config'
import type { EventoIfood } from './ifood/cliente'
import { MAX_TENTATIVAS_CANAL } from '@/lib/espera-tentativas'

const m = vi.hoisted(() => ({ polling: vi.fn(), ack: vi.fn(), detalhe: vi.fn(), importar: vi.fn(), listar: vi.fn(), alterar: vi.fn() }))
vi.mock('./ifood/cliente', () => ({
  EVENTO_IFOOD: { PLACED: 'PLC', CANCELLED: 'CAN', PATCHED: 'OPA' },
  pollingIfood: m.polling, acknowledgmentIfood: m.ack, detalheDoPedidoIfood: m.detalhe, enviarStatusIfood: vi.fn(),
}))
vi.mock('./importar', () => ({ importarPedidoExterno: m.importar, cancelarPeloApp: vi.fn(), atualizarPedidoPeloApp: m.alterar }))
vi.mock('./config', () => ({ listarCanaisAtivos: m.listar, registrarPolling: vi.fn() }))
vi.mock('./ifood/mapear', () => ({ mapearPedidoIfood: (b: unknown) => b }))
vi.mock('@/lib/entregas/queries', () => ({ buscarCorridaPorExterno: vi.fn() }))
vi.mock('@/lib/entregas/provedores', () => ({ aplicarEventoCorrida: vi.fn(), statusDeEventoIfood: vi.fn() }))

import { limparFalhasDeEvento, pollingDaLoja, sincronizarCanais, type ResumoSincronizacao } from './sincronizar'

/** Banco mínimo: nenhum evento visto antes; grava sem erro. */
const admin = { from: () => ({
  select() { return this }, eq() { return this }, gte() { return this }, not() { return this }, limit: async () => ({ data: [] }),
  maybeSingle: async () => ({ data: null }), upsert: async () => ({}), update() { return this },
}) } as unknown as SupabaseClient
const cfg = { canal: 'ifood', restauranteId: 'r1' } as ConfigCanal
const resumo = (): ResumoSincronizacao => ({ lojas: 0, eventos: 0, pedidosNovos: 0, cancelados: 0, statusEnviados: 0, erros: [] })
const novo = (id: string): EventoIfood => ({ id, code: 'PLC', orderId: `o-${id}` })

describe('polling do iFood: evento com erro não pode virar pedido perdido', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useRealTimers(); limparFalhasDeEvento()
    m.importar.mockResolvedValue({ novo: true })
    m.detalhe.mockResolvedValue({})
  })

  it('confirma só o evento que deu certo; o que falhou fica para a próxima rodada', async () => {
    m.polling.mockResolvedValue([novo('ok'), novo('ruim')])
    m.detalhe.mockImplementation(async (_a, _c, id: string) => { if (id === 'o-ruim') throw new Error('HTTP 500'); return {} })
    const r = resumo()
    await pollingDaLoja(admin, cfg, r)
    expect(m.ack.mock.calls[0][2].map((e: EventoIfood) => e.id)).toEqual(['ok'])
    expect(r.erros).toHaveLength(1)
  })

  it('evento com erro espera antes de consultar de novo', async () => {
    m.polling.mockResolvedValue([novo('ruim')])
    m.detalhe.mockRejectedValue(new Error('HTTP 500'))
    await pollingDaLoja(admin, cfg, resumo())
    await pollingDaLoja(admin, cfg, resumo())
    expect(m.detalhe).toHaveBeenCalledTimes(1)
  })

  it('para no limite de tentativas: confirma o evento e registra o erro', async () => {
    vi.useFakeTimers({ now: 0 })
    m.polling.mockResolvedValue([novo('ruim')])
    m.detalhe.mockRejectedValue(new Error('HTTP 500'))
    const r = resumo()
    for (let i = 0; i < MAX_TENTATIVAS_CANAL; i++) { await pollingDaLoja(admin, cfg, r); vi.advanceTimersByTime(2 * 3600_000) }
    expect(m.detalhe).toHaveBeenCalledTimes(MAX_TENTATIVAS_CANAL)
    expect(m.ack).toHaveBeenCalledTimes(1)
    expect(r.erros.at(-1)).toContain('desistiu')
  })

  it('pedido alterado no iFood (OPA) relê o pedido e atualiza aqui', async () => {
    m.polling.mockResolvedValue([{ id: 'p1', code: 'OPA', fullCode: 'ORDER_PATCHED', orderId: 'o-1' }])
    await pollingDaLoja(admin, cfg, resumo())
    expect(m.detalhe).toHaveBeenCalledTimes(1)
    expect(m.alterar).toHaveBeenCalledTimes(1)
    expect(m.ack).toHaveBeenCalledTimes(1)
  })
})

describe('sincronizarCanais: iFood a cada 30 s com cron de 1 min', () => {
  beforeEach(() => { vi.clearAllMocks(); m.polling.mockResolvedValue([]) })

  it('consulta o iFood 2 vezes por rodada, com 30 s entre elas', async () => {
    vi.useFakeTimers({ now: 0 })
    m.listar.mockResolvedValue([{ ...cfg, credenciais: { clientId: 'a', clientSecret: 'b' } }])
    const rodada = sincronizarCanais(admin)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(m.polling).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await rodada
    expect(m.polling).toHaveBeenCalledTimes(2)
  })

  it('sem iFood ligado, não espera nem consulta', async () => {
    vi.useFakeTimers({ now: 0 })
    m.listar.mockResolvedValue([])
    await sincronizarCanais(admin)
    expect(m.polling).not.toHaveBeenCalled()
  })
})
