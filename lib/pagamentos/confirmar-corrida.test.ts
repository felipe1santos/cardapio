import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Achado #4 da auditoria (25/10): confirmarPago marcava a cobrança como 'pago' ANTES de conferir se o pedido mudou.
 * Se o pedido fosse cancelado entre a leitura e a gravação condicional, devolvia 'ja_confirmado': dinheiro recebido
 * num pedido cancelado, sem livro-caixa, sem "a devolver" e sem alerta.
 */

const consultar = vi.fn()
const criarAlerta = vi.fn(async () => {})
const lancar = vi.fn(async () => ({ ok: true }))
vi.mock('./mercadopago', async (orig) => ({ ...(await orig<typeof import('./mercadopago')>()), provedorMp: () => ({ consultar, cancelar: vi.fn() }) }))
vi.mock('./contas', () => ({
  comTokenDaLoja: (_a: unknown, _r: unknown, f: (t: string, u: string) => unknown) => f('token', 'mp-user'),
  tokenDaLoja: async () => null, contaPublica: async () => null, webhookUrlMp: () => '',
}))
vi.mock('@/lib/fidelidade', () => ({ reverterBeneficiosPedidoCancelado: vi.fn(async () => {}) }))
vi.mock('@/lib/whatsapp', () => ({ notificarPedido: vi.fn(async () => {}), enviarWhatsapp: vi.fn(async () => true), formatarTelefoneWhatsapp: (t: string) => t }))
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(async () => {}) }))
vi.mock('@/lib/agente-ia/avisos', () => ({ avisarPixExpiradoIa: vi.fn(async () => false) }))
vi.mock('@/lib/financeiro/alertas', () => ({ criarAlerta: (...a: unknown[]) => criarAlerta(...(a as [])) }))
vi.mock('@/lib/financeiro/ledger', () => ({ lancar: (...a: unknown[]) => lancar(...(a as [])) }))
vi.mock('@/lib/meta-capi', () => ({ enviarPurchaseCapi: vi.fn(async () => {}) }))
vi.mock('@/lib/push/painel-pedidos', () => ({ avisarPainelPedidoNovo: vi.fn(async () => {}) }))

type Linha = Record<string, unknown>

/** Banco em memória; `antesDeAtualizar` deixa o teste mexer numa linha no instante da gravação (corrida). */
function banco(tabelas: Record<string, Linha[]>, antesDeAtualizar?: (tabela: string, patch: Linha) => void) {
  const from = (nome: string) => {
    const filtros: ((l: Linha) => boolean)[] = []
    let patch: Linha | null = null
    const executar = () => {
      if (patch) antesDeAtualizar?.(nome, patch)
      const achadas = (tabelas[nome] ?? []).filter((l) => filtros.every((f) => f(l)))
      if (patch) for (const l of achadas) Object.assign(l, patch)
      return achadas.map((l) => ({ ...l }))
    }
    const q = {
      select: () => q, order: () => q, limit: () => q,
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q },
      in: (c: string, v: unknown[]) => { filtros.push((l) => v.includes(l[c])); return q },
      lt: () => q,
      is: (c: string, v: unknown) => { filtros.push((l) => (l[c] ?? null) === v); return q },
      update: (p: Linha) => { patch = p; return q },
      insert: async () => ({ data: null, error: null }),
      single: async () => ({ data: executar()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: executar()[0] ?? null, error: null }),
      then: (ok: (r: { data: Linha[]; error: null }) => unknown) => Promise.resolve({ data: executar(), error: null }).then(ok),
    }
    return q
  }
  return { from } as unknown as SupabaseClient
}

function cenario(corrida: boolean) {
  const tabelas: Record<string, Linha[]> = {
    pagamentos_online: [{ id: 'pg1', mp_payment_id: 'mp1', restaurante_id: 'loja', pedido_id: 'ped1', status: 'pendente', metodo: 'pix', valor: 50, mp_user_id: 'mp-user', verificacoes: 0, contexto: {} }],
    pedidos: [{ id: 'ped1', numero: 9, status: 'aguardando_pagamento', total: 50, restaurante_id: 'loja', tipo: 'entrega' }],
    restaurantes: [{ id: 'loja', financeiro_ativo: true }],
    caixa_turnos: [],
  }
  const admin = banco(tabelas, (tabela, patch) => {
    // Cancelado por outra ação no instante em que o MP confirmava.
    if (corrida && tabela === 'pedidos' && patch.status === 'recebido') tabelas.pedidos[0].status = 'cancelado'
  })
  return { tabelas, admin }
}

describe('confirmação do Pix com o pedido cancelado no meio', () => {
  beforeEach(() => {
    consultar.mockReset().mockResolvedValue({ id: 'mp1', status: 'approved', valor: 50, externalReference: 'ped1', coletorId: 'mp-user', metodo: 'pix', moeda: 'BRL', taxa: 0.5, liquido: 49.5 })
    criarAlerta.mockClear()
    lancar.mockClear()
  })

  it('vira "a devolver", com alerta e lançamento — não "já confirmado" em silêncio', async () => {
    const { conferirPagamento } = await import('./pix-online')
    const { tabelas, admin } = cenario(true)
    const r = await conferirPagamento(admin, 'mp1', 'webhook')
    expect(r).toBe('a_devolver')
    expect(tabelas.pagamentos_online[0].status).toBe('a_devolver')
    expect(criarAlerta).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tipo: 'pix_online_a_devolver' }))
    expect(lancar).toHaveBeenCalled()
  })

  it('sem corrida continua confirmando normalmente', async () => {
    const { conferirPagamento } = await import('./pix-online')
    const { tabelas, admin } = cenario(false)
    expect(await conferirPagamento(admin, 'mp1', 'webhook')).toBe('confirmado')
    expect(tabelas.pedidos[0].status).toBe('recebido')
    expect(tabelas.pagamentos_online[0].status).toBe('pago')
  })
})
