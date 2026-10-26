import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { corteLiberacaoAgendados } from './pedidos'

/**
 * Egress (26/10): o alarme e os contadores do menu reliam `restaurantes.agendamento_libera_min` a cada leitura
 * (~20 mil consultas/dia). A antecedência quase nunca muda: guardada por 5 min na memória da aba.
 */

function supabaseFalso(min: number) {
  const maybeSingle = vi.fn(async () => ({ data: { agendamento_libera_min: min }, error: null }))
  const q = { select: () => q, eq: () => q, maybeSingle }
  return { supabase: { from: vi.fn(() => q) } as unknown as SupabaseClient, maybeSingle }
}

describe('corteLiberacaoAgendados', () => {
  it('lê a antecedência da loja uma vez e reaproveita nas próximas chamadas', async () => {
    const { supabase, maybeSingle } = supabaseFalso(45)
    const a = await corteLiberacaoAgendados(supabase, 'loja-cache-1')
    const b = await corteLiberacaoAgendados(supabase, 'loja-cache-1')
    expect(maybeSingle).toHaveBeenCalledTimes(1)
    expect(Date.parse(a) - Date.now()).toBeGreaterThan(44 * 60_000)
    expect(Date.parse(b) - Date.now()).toBeGreaterThan(44 * 60_000)
  })

  it('cada loja tem o seu valor', async () => {
    const { supabase, maybeSingle } = supabaseFalso(10)
    await corteLiberacaoAgendados(supabase, 'loja-cache-2')
    await corteLiberacaoAgendados(supabase, 'loja-cache-3')
    expect(maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('passados 5 minutos, lê de novo (a loja pode ter mudado)', async () => {
    vi.useFakeTimers()
    try {
      const { supabase, maybeSingle } = supabaseFalso(30)
      await corteLiberacaoAgendados(supabase, 'loja-cache-4')
      vi.advanceTimersByTime(5 * 60_000 + 1)
      await corteLiberacaoAgendados(supabase, 'loja-cache-4')
      expect(maybeSingle).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
