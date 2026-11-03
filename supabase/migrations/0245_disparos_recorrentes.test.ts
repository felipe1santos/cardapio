import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 03/11/2026: disparos recorrentes (docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md). */
const sql = readFileSync('supabase/migrations/0245_disparos_recorrentes.sql', 'utf8')

describe('0245 campanha_recorrentes', () => {
  it('tabela com os 3 tipos, unique por loja e RLS de gestor', () => {
    expect(sql).toMatch(/create table if not exists public\.campanha_recorrentes/)
    expect(sql).toMatch(/tipo in \('recuperacao', 'nunca_compraram', 'promocoes'\)/)
    expect(sql).toMatch(/unique \(restaurante_id, tipo\)/)
    expect(sql).toMatch(/ativa boolean not null default false/)
    expect(sql).toMatch(/jsonb_array_length\(imagens\) <= 5/)
    expect(sql).toMatch(/alter table public\.campanha_recorrentes enable row level security/)
    expect(sql).toMatch(/auth_e_gestor\(\)/)
    expect(sql).toMatch(/grant select, insert, update on public\.campanha_recorrentes to authenticated/)
  })
  it('índice parcial dos vencidos e coluna recorrente_id em campanhas', () => {
    expect(sql).toMatch(/create index if not exists campanha_recorrentes_vencidos on public\.campanha_recorrentes \(proximo_disparo_em\) where ativa/)
    expect(sql).toMatch(/alter table public\.campanhas add column if not exists recorrente_id uuid references public\.campanha_recorrentes\(id\) on delete set null/)
  })
  it('frequência por cliente vai a 2 dias; trigger calcula a agenda', () => {
    expect(sql).toMatch(/update public\.plataforma_config set valor = '2'::jsonb[^;]*where chave = 'disparo_frequencia_dias'/)
    expect(sql).toMatch(/create or replace function public\.campanha_recorrente_proximo\(p_dias smallint\[\], p_hora time, p_a_partir timestamptz\)/)
    expect(sql).toMatch(/create trigger campanha_recorrentes_agenda before insert or update of ativa, dias_semana, hora, pular_ate/)
  })
})
