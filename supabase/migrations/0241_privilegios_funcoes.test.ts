import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 01/11/2026 (Fase 6): os privilégios padrão do schema davam EXECUTE a anon/authenticated em toda função nova — uma RPC
 * security definer nova ficava aberta até alguém lembrar de revogar. Só muda o PADRÃO para funções futuras; as
 * existentes não mudam (a vitrine continua com as dela).
 */
const sql = readFileSync('supabase/migrations/0241_privilegios_funcoes.sql', 'utf8').replace(/--.*$/gm, '')

describe('0241 privilégios padrão de funções novas', () => {
  it('revoga o execute padrão de anon e authenticated para funções criadas pelo postgres', () => {
    expect(sql).toMatch(/alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated/)
  })
  it('não mexe em função existente', () => {
    expect(sql).not.toMatch(/revoke [^;]*on function public\./)
    expect(sql).not.toMatch(/on all functions/)
  })
})
