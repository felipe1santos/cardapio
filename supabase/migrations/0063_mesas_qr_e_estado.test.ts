import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0063_mesas_qr_e_estado.sql'), 'utf8')

describe('0063 — mesa com token de QR e estado', () => {
  it('token é uuid opaco, com default e unicidade', () => {
    expect(sql).toMatch(/add column if not exists token uuid not null default gen_random_uuid\(\)/)
    expect(sql).toMatch(/create unique index if not exists mesas_token_unq on public\.mesas \(token\)/)
  })

  it('a chave anônima não alcança a tabela de mesas', () => {
    expect(sql).toMatch(/revoke all on public\.mesas from anon/)
  })

  it('bloqueio operacional é separado do cadastro', () => {
    expect(sql).toMatch(/add column if not exists bloqueada_em timestamptz/)
    // `ativa` (0033) continua sendo cadastro; não é reaproveitada para operação.
    expect(sql).not.toMatch(/drop column .*ativa/)
  })

  it('capacidade tem limite sensato', () => {
    expect(sql).toMatch(/capacidade is null or \(capacidade > 0 and capacidade <= 99\)/)
  })

  it('tudo aditivo e idempotente', () => {
    const adds = sql.match(/add column/g) ?? []
    const guards = sql.match(/add column if not exists/g) ?? []
    expect(guards.length).toBe(adds.length)
    for (const c of sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';')) {
      expect(c.trim()).not.toMatch(/^(insert|update|delete|truncate|drop table)\b/i)
    }
  })
})
