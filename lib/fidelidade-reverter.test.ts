import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reverterBeneficiosPedidoCancelado } from './fidelidade'

/** Tabelas em memória com eq/or(eq,is null) — o suficiente para a reversão do prêmio. */
function bancoFalso(tabelas: Record<string, Record<string, unknown>[]>): SupabaseClient {
  const from = (tabela: string) => {
    const filtros: ((l: Record<string, unknown>) => boolean)[] = []
    let patch: Record<string, unknown> | null = null
    const linhas = () => (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)))
    const b: Record<string, unknown> = {
      select: () => b,
      update: (p: Record<string, unknown>) => { patch = p; return b },
      eq: (k: string, v: unknown) => { filtros.push((l) => l[k] === v); return b },
      or: (expr: string) => {
        const conds = expr.split(',').map((c) => c.split('.'))
        filtros.push((l) => conds.some(([k, op, v]) => (op === 'is' ? l[k] === null : l[k] === v)))
        return b
      },
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => {
        const alvo = linhas()
        if (patch) for (const l of alvo) Object.assign(l, patch)
        return Promise.resolve({ data: alvo, error: null }).then(ok)
      },
    }
    return b
  }
  return { from } as unknown as SupabaseClient
}

describe('reverterBeneficiosPedidoCancelado — prêmio de fidelidade', () => {
  it('não libera de novo um prêmio que já foi usado em OUTRO pedido', async () => {
    const recompensa = { id: 'rec', restaurante_id: 'r1', status: 'resgatado', pedido_resgate_id: 'pedido-B' }
    const banco = bancoFalso({
      pedidos: [{ id: 'pedido-A', restaurante_id: 'r1', status: 'cancelado', cupom_codigo: null, recompensa_id: 'rec' }],
      fidelidade_recompensas: [recompensa],
    })
    await reverterBeneficiosPedidoCancelado(banco, 'r1', 'pedido-A')
    expect(recompensa).toMatchObject({ status: 'resgatado', pedido_resgate_id: 'pedido-B' })
  })

  it('devolve o prêmio do próprio pedido cancelado (com ou sem vínculo gravado)', async () => {
    for (const vinculo of ['pedido-A', null]) {
      const recompensa = { id: 'rec', restaurante_id: 'r1', status: 'resgatado', pedido_resgate_id: vinculo }
      const banco = bancoFalso({
        pedidos: [{ id: 'pedido-A', restaurante_id: 'r1', status: 'cancelado', cupom_codigo: null, recompensa_id: 'rec' }],
        fidelidade_recompensas: [recompensa],
      })
      await reverterBeneficiosPedidoCancelado(banco, 'r1', 'pedido-A')
      expect(recompensa.status).toBe('disponivel')
    }
  })
})
