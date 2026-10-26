import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Integração do cron do Pix/cartão online (verificarPendentes) com um banco em memória e o MP simulado.
 * Bug de 26/10: cartão recusado com o prazo vencido ficava `pendente` para sempre — conferido a cada minuto
 * (19 mil vezes em 13 dias) e o pedido parado em "aguardando pagamento".
 */

const consultar = vi.fn()
const cancelar = vi.fn()
vi.mock('./mercadopago', async (orig) => ({ ...(await orig<typeof import('./mercadopago')>()), provedorMp: () => ({ consultar, cancelar }) }))
vi.mock('./contas', () => ({
  comTokenDaLoja: (_a: unknown, _r: unknown, f: (t: string, u: string) => unknown) => f('token', 'mp-user'),
  tokenDaLoja: async () => null, contaPublica: async () => null, webhookUrlMp: () => '',
}))
vi.mock('@/lib/fidelidade', () => ({ reverterBeneficiosPedidoCancelado: vi.fn(async () => {}) }))
vi.mock('@/lib/whatsapp', () => ({ notificarPedido: vi.fn(async () => {}), enviarWhatsapp: vi.fn(async () => true), formatarTelefoneWhatsapp: (t: string) => t }))
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(async () => {}) }))
vi.mock('@/lib/agente-ia/avisos', () => ({ avisarPixExpiradoIa: vi.fn(async () => false) }))
vi.mock('@/lib/financeiro/alertas', () => ({ criarAlerta: vi.fn(async () => {}) }))
vi.mock('@/lib/financeiro/ledger', () => ({ lancar: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/meta-capi', () => ({ enviarPurchaseCapi: vi.fn(async () => {}) }))
vi.mock('@/lib/push/painel-pedidos', () => ({ avisarPainelPedidoNovo: vi.fn(async () => {}) }))

type Linha = Record<string, unknown>

/** Supabase em memória: o mínimo que o cron usa (select/update com eq, in, lt, order, limit, single, maybeSingle). */
function bancoEmMemoria(tabelas: Record<string, Linha[]>) {
  const from = (nome: string) => {
    const filtros: ((l: Linha) => boolean)[] = []
    let patch: Linha | null = null
    let limite = Infinity
    const linhas = () => (tabelas[nome] ?? []).filter((l) => filtros.every((f) => f(l)))
    const executar = () => {
      const achadas = linhas().slice(0, limite)
      if (patch) for (const l of achadas) Object.assign(l, patch)
      return achadas
    }
    const q = {
      select: () => q, order: () => q,
      limit: (n: number) => { limite = n; return q },
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q },
      in: (c: string, v: unknown[]) => { filtros.push((l) => v.includes(l[c])); return q },
      lt: (c: string, v: string) => { filtros.push((l) => String(l[c]) < v); return q },
      update: (p: Linha) => { patch = p; return q },
      single: async () => ({ data: executar()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: executar()[0] ?? null, error: null }),
      then: (ok: (r: { data: Linha[]; error: null }) => unknown) => Promise.resolve({ data: executar(), error: null }).then(ok),
    }
    return q
  }
  return { from } as unknown as SupabaseClient
}

const VENCEU = new Date(Date.now() - 10 * 60_000).toISOString()
const NO_PRAZO = new Date(Date.now() + 10 * 60_000).toISOString()

function cenario(expiraEm: string) {
  const tabelas: Record<string, Linha[]> = {
    pagamentos_online: [{ id: 'pg1', mp_payment_id: 'mp1', restaurante_id: 'loja', pedido_id: 'ped1', expira_em: expiraEm, status: 'pendente', metodo: 'cartao', valor: 50, mp_user_id: 'mp-user', verificacoes: 0 }],
    pedidos: [{ id: 'ped1', numero: 7, status: 'aguardando_pagamento', total: 50, restaurante_id: 'loja', tipo: 'entrega' }],
    pagamentos_contas: [],
  }
  return { tabelas, admin: bancoEmMemoria(tabelas) }
}

describe('verificarPendentes — cartão recusado', () => {
  beforeEach(() => {
    consultar.mockReset().mockResolvedValue({ id: 'mp1', status: 'rejected', valor: 50, externalReference: 'ped1', coletorId: 'mp-user', tipo: 'credit_card' })
    cancelar.mockReset()
  })

  it('prazo vencido: expira o pedido, tira a cobrança da fila e não cancela no MP', async () => {
    const { verificarPendentes } = await import('./pix-online')
    const { tabelas, admin } = cenario(VENCEU)
    await verificarPendentes(admin)
    expect(tabelas.pedidos[0].status).toBe('cancelado')
    expect(tabelas.pagamentos_online[0].status).not.toBe('pendente')
    expect(cancelar).not.toHaveBeenCalled()

    // Próximo minuto: nada mais a conferir — o MP não é chamado de novo.
    consultar.mockClear()
    await verificarPendentes(admin)
    expect(consultar).not.toHaveBeenCalled()
  })

  it('dentro do prazo: o pedido continua esperando outro cartão', async () => {
    const { verificarPendentes } = await import('./pix-online')
    const { tabelas, admin } = cenario(NO_PRAZO)
    await verificarPendentes(admin)
    expect(tabelas.pedidos[0].status).toBe('aguardando_pagamento')
    expect(tabelas.pagamentos_online[0].status).toBe('pendente')
  })

  it('pedido já cancelado e cobrança recusada vencida: só sai da fila', async () => {
    const { verificarPendentes } = await import('./pix-online')
    const { tabelas, admin } = cenario(VENCEU)
    tabelas.pedidos[0].status = 'cancelado'
    await verificarPendentes(admin)
    expect(tabelas.pagamentos_online[0].status).not.toBe('pendente')
  })
})
