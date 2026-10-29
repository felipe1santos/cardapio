import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Revisão de 26/10 do CONNECTION_UPDATE (d8a4bd8c):
 *  · dois eventos "open" seguidos (ou evento + cron) reenviavam DUAS vezes os avisos que falharam para os clientes;
 *  · desconectar pelo painel: o "close" do logout chegava antes da marca de manual → alerta falso e reconexão.
 */

const estadoConexao = vi.fn()
const fetchConnect = vi.fn()
const enviarWhatsapp = vi.fn(async () => true)
const criarAlerta = vi.fn(async () => {})
vi.mock('@/lib/evolution', () => ({
  estadoConexao: (...a: unknown[]) => estadoConexao(...(a as [])),
  evolutionConfigurado: () => true,
  evolutionHeaders: () => ({}),
  evolutionUrl: (p: string) => `http://evo${p}`,
}))
vi.mock('@/lib/whatsapp', () => ({ enviarWhatsapp: (...a: unknown[]) => enviarWhatsapp(...(a as [])) }))
vi.mock('@/lib/financeiro/alertas', () => ({ criarAlerta: (...a: unknown[]) => criarAlerta(...(a as [])) }))
vi.mock('@/lib/push/painel-pedidos', () => ({ avisarPainelPedidoNovo: vi.fn(async () => {}) }))
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

type Linha = Record<string, unknown>

function banco(tabelas: Record<string, Linha[]>) {
  const from = (nome: string) => {
    const filtros: ((l: Linha) => boolean)[] = []
    let patch: Linha | null = null
    const exec = () => {
      const achadas = (tabelas[nome] ?? []).filter((l) => filtros.every((f) => f(l)))
      if (patch) for (const l of achadas) Object.assign(l, patch)
      return achadas.map((l) => ({ ...l }))
    }
    const q: Record<string, unknown> = {
      select: () => q, order: () => q, limit: () => q, not: () => q,
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q },
      gte: () => q,
      update: (p: Linha) => { patch = p; return q },
      insert: (v: Linha) => { (tabelas[nome] ??= []).push(v); return Promise.resolve({ error: null }) },
      is: () => q, or: () => q,
      maybeSingle: async () => ({ data: exec()[0] ?? null, error: null }),
      single: async () => ({ data: exec()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: exec(), error: null }).then(ok),
    }
    return q
  }
  return { from } as unknown as SupabaseClient
}

const CAIU = new Date(Date.now() - 20 * 60_000).toISOString()

function lojaCaida(extra: Linha = {}) {
  return {
    restaurantes: [{ id: 'l1', nome: 'Loja', evolution_instance: 'inst', whatsapp_estado: 'close', whatsapp_estado_em: CAIU, whatsapp_caiu_em: CAIU, whatsapp_alertado_em: CAIU, whatsapp_desconexao_manual_em: null, ...extra }],
    whatsapp_mensagens: [{ id: 'm1', texto: 'Seu pedido saiu', conversa_id: 'c1', whatsapp_conversas: { telefone: '5527999990000' }, restaurante_id: 'l1', direcao: 'loja', origem: 'automatico', status_envio: 'falhou', criado_em: CAIU }],
  } as Record<string, Linha[]>
}

describe('evento de conexão: volta do WhatsApp', () => {
  beforeEach(() => {
    estadoConexao.mockReset().mockResolvedValue('open')
    enviarWhatsapp.mockClear()
    criarAlerta.mockClear()
    vi.stubGlobal('fetch', fetchConnect.mockReset().mockResolvedValue({ ok: true }))
  })

  it('dois "open" ao mesmo tempo reenviam os avisos UMA vez só', async () => {
    const { aplicarEventoConexao } = await import('./whatsapp-monitor')
    const admin = banco(lojaCaida())
    await Promise.all([aplicarEventoConexao(admin, 'l1', { estado: 'open', motivo: null }), aplicarEventoConexao(admin, 'l1', { estado: 'open', motivo: null })])
    expect(enviarWhatsapp).toHaveBeenCalledTimes(1)
  })
})

describe('evento de conexão: desconexão pelo painel', () => {
  beforeEach(() => {
    estadoConexao.mockReset().mockResolvedValue('close')
    criarAlerta.mockClear()
    vi.stubGlobal('fetch', fetchConnect.mockReset().mockResolvedValue({ ok: true }))
  })

  it('com a marca de manual recente: nem alerta nem tenta reconectar', async () => {
    const { aplicarEventoConexao } = await import('./whatsapp-monitor')
    const admin = banco({ restaurantes: [{ id: 'l1', nome: 'Loja', evolution_instance: 'inst', whatsapp_estado: 'open', whatsapp_estado_em: CAIU, whatsapp_caiu_em: null, whatsapp_alertado_em: null, whatsapp_desconexao_manual_em: new Date().toISOString() }] })
    await aplicarEventoConexao(admin, 'l1', { estado: 'close', motivo: 401 })
    expect(criarAlerta).not.toHaveBeenCalled()
    expect(fetchConnect).not.toHaveBeenCalled()
  })

  it('evento repetido com o mesmo estado já gravado não refaz a conferência', async () => {
    const { aplicarEventoConexao } = await import('./whatsapp-monitor')
    const admin = banco(lojaCaida())
    await aplicarEventoConexao(admin, 'l1', { estado: 'close', motivo: 428 })
    expect(estadoConexao).not.toHaveBeenCalled()
  })
})

/** Enxurrada de 27/10 (Ponto 400: ~75 mil CONNECTION_UPDATE em 2 h, close 440/503 e connecting): regra de 28/10. */
describe('enxurrada de eventos de conexão', () => {
  beforeEach(() => {
    estadoConexao.mockReset()
    vi.stubGlobal('fetch', fetchConnect.mockReset().mockResolvedValue({ ok: true }))
  })
  const conectada = () => ({ restaurantes: [{ id: 'l1', nome: 'Loja', evolution_instance: 'inst', whatsapp_estado: 'open', whatsapp_estado_em: CAIU, whatsapp_caiu_em: null, whatsapp_alertado_em: null, whatsapp_desconexao_manual_em: null }] } as Record<string, Linha[]>)

  it('440 numa loja conectada: desconectada na hora, NENHUMA reconexão, 1 aviso ao Super Admin', async () => {
    const { aplicarEventoConexao } = await import('./whatsapp-monitor')
    estadoConexao.mockResolvedValue('close')
    const t = conectada()
    const admin = banco(t)
    for (let i = 0; i < 50; i++) await aplicarEventoConexao(admin, 'l1', { estado: i % 2 ? 'close' : 'connecting', motivo: 440 })
    expect(fetchConnect).not.toHaveBeenCalled()
    expect(t.restaurantes[0].whatsapp_estado).toBe('close')
    expect((t.sistema_alertas ?? []).length).toBe(1)
    // Depois de desconectada, os 49 eventos seguintes não consultaram a Evolution.
    expect(estadoConexao).toHaveBeenCalledTimes(1)
  })

  it('loja já desconectada: 100 eventos connecting/close = 0 conferências, 0 gravações, 0 avisos', async () => {
    const { aplicarEventoConexao } = await import('./whatsapp-monitor')
    const t = lojaCaida()
    const antes = JSON.stringify(t.restaurantes)
    const admin = banco(t)
    for (let i = 0; i < 100; i++) await aplicarEventoConexao(admin, 'l1', { estado: i % 2 ? 'close' : 'connecting', motivo: i % 3 ? 503 : 401 })
    expect(estadoConexao).not.toHaveBeenCalled()
    expect(fetchConnect).not.toHaveBeenCalled()
    expect(JSON.stringify(t.restaurantes)).toBe(antes)
    expect(t.sistema_alertas ?? []).toHaveLength(0)
  })

  it('queda momentânea (503) que não volta: 3 tentativas NO TOTAL e depois silêncio', async () => {
    const { monitorarLoja, MAX_TENTATIVAS } = await import('./whatsapp-monitor')
    estadoConexao.mockResolvedValue('close')
    const t = conectada()
    t.restaurantes[0].id = 'l3'
    const admin = banco(t)
    for (let i = 0; i < 10; i++) await monitorarLoja(admin, { ...t.restaurantes[0] } as never, { forcar: true, motivo: 503 })
    expect(fetchConnect).toHaveBeenCalledTimes(MAX_TENTATIVAS)
    expect(t.restaurantes[0].whatsapp_estado).toBe('close')
    expect((t.sistema_alertas ?? []).length).toBe(1)
  })
})
