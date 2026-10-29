import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ONLINE_MS } from './regras-modo'

// A 0234 grava visto_em só a cada 10 s; a margem de "online" (30 s) precisa continuar bem maior que isso.
describe('sinal de vida do Assistente', () => {
  it('online continua sendo 30 s', () => {
    expect(ONLINE_MS).toBe(30_000)
  })
  it('a migration 0234 só grava visto_em após 10 s', () => {
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0234_agente_visto_em_10s.sql'), 'utf8')
    expect(sql).toContain("interval '10 seconds'")
    expect(sql).toContain('create or replace function public.impressao_agente_autenticar')
  })
})
