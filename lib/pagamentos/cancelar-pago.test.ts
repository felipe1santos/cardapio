import { describe, expect, it, vi } from 'vitest'

const alertas: unknown[] = []
vi.mock('@/lib/financeiro/alertas', () => ({ criarAlerta: vi.fn(async (_a: unknown, x: unknown) => { alertas.push(x) }) }))
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

import { aDevolverAoCancelar } from './pix-online'

/** Supabase falso: update(...).eq().eq().eq().select() devolve as linhas que estavam "pago". */
function adminFalso(linhas: { id: string; valor: number; metodo: string; status: string; pedido_id: string }[]) {
  const mudou: { id: string; dados: unknown }[] = []
  const from = () => ({
    update: (dados: Record<string, unknown>) => {
      const filtros: Record<string, unknown> = {}
      const q = {
        eq: (c: string, v: unknown) => { filtros[c] = v; return q },
        select: async () => {
          const alvo = linhas.filter((l) => l.status === filtros.status && l.pedido_id === filtros.pedido_id)
          for (const l of alvo) { l.status = String(dados.status); mudou.push({ id: l.id, dados }) }
          return { data: alvo.map(({ id, valor, metodo }) => ({ id, valor, metodo })) }
        },
      }
      return q
    },
  })
  return { admin: { from } as never, mudou }
}

describe('cancelar pedido já pago online: marca "a devolver" e avisa — nunca estorna sozinho', () => {
  it('cartão pago → a_devolver + alerta grave', async () => {
    alertas.length = 0
    const { admin, mudou } = adminFalso([{ id: 'r1', valor: 50, metodo: 'cartao', status: 'pago', pedido_id: 'P' }])
    expect(await aDevolverAoCancelar(admin, 'L', { id: 'P', numero: 12 })).toBe(1)
    expect(mudou).toEqual([{ id: 'r1', dados: { status: 'a_devolver' } }])
    expect(alertas[0]).toMatchObject({ restauranteId: 'L', tipo: 'pix_online_a_devolver', gravidade: 'grave' })
    expect(String((alertas[0] as { mensagem: string }).mensagem)).toMatch(/Cartão online.*#12.*Devolva/)
  })
  it('pedido sem pagamento online pago (pendente, ou na entrega) → nada muda, sem alerta', async () => {
    alertas.length = 0
    const { admin, mudou } = adminFalso([{ id: 'r2', valor: 30, metodo: 'pix', status: 'pendente', pedido_id: 'P' }])
    expect(await aDevolverAoCancelar(admin, 'L', { id: 'P', numero: 13 })).toBe(0)
    expect(mudou).toEqual([])
    expect(alertas).toEqual([])
  })
})
