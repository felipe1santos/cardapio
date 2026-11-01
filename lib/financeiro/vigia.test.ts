import { describe, expect, it } from 'vitest'
import { adminGravador } from '@/lib/teste/admin-gravador'
import { varrerLoja } from './vigia'

/**
 * 01/11/2026 (Fase 5): o vigia do financeiro lia TODO o histórico de lançamentos do motoboy de cada loja a cada
 * 15 min, inclusive em loja nível 1 (sem controle de caixa), onde esse alerta nem existe. Regra 3: desligado = zero
 * consulta.
 */
describe('varrerLoja em loja nível 1 (sem controle de caixa)', () => {
  it('não lê fin_lancamentos nem caixa; só a auditoria recente', async () => {
    const g = adminGravador({ restaurantes: [{ status_loja: 'automatico', horario_funcionamento: null, financeiro_ativo: true, controle_caixa_ativo: false }] })
    await varrerLoja(g.admin, 'L1', Date.parse('2026-11-01T22:00:00Z'))
    expect(g.vezes('fin_lancamentos')).toBe(0)
    expect(g.vezes('eventos_auditoria')).toBe(1)
  })
})
