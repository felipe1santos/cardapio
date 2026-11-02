import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 02/11/2026: assinatura paga via Asaas (docs/ASSINATURA-ASAAS.md). Tabelas só do service role. */
const sql = readFileSync('supabase/migrations/0243_assinaturas_asaas.sql', 'utf8')

describe('0243 assinaturas', () => {
  it('uma assinatura por usuário, com plano e status restritos', () => {
    expect(sql).toMatch(/usuario_id uuid not null unique references public\.usuarios\(id\)/)
    expect(sql).toMatch(/plano in \('basico', 'completo'\)/)
    expect(sql).toMatch(/status in \('aguardando', 'em_dia', 'atrasada', 'cancelada'\)/)
    expect(sql).toMatch(/asaas_assinatura_id text not null unique/)
  })
  it('idempotência do webhook pelo id do evento', () => {
    expect(sql).toMatch(/create table if not exists public\.asaas_eventos \(\s*id text primary key/)
  })
  it('nada para anon/authenticated: RLS ligada e revoke nas duas tabelas', () => {
    expect(sql).toMatch(/alter table public\.assinaturas enable row level security/)
    expect(sql).toMatch(/revoke all on public\.assinaturas from anon, authenticated/)
    expect(sql).toMatch(/alter table public\.asaas_eventos enable row level security/)
    expect(sql).toMatch(/revoke all on public\.asaas_eventos from anon, authenticated/)
    expect(sql).not.toMatch(/create policy/)
  })
})
