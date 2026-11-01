import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 01/11/2026 (Fase 6): o Super Admin paginava TODOS os pedidos entregues de todas as lojas pelo PostgREST só para somar
 * faturamento e contar (egress cresce com o histórico). Agora o banco soma e devolve uma linha por loja.
 */
const sql = readFileSync('supabase/migrations/0242_plataforma_metricas.sql', 'utf8')

describe('0242 métricas da plataforma no banco', () => {
  it('função que agrega por loja os pedidos entregues', () => {
    expect(sql).toMatch(/create or replace function public\.plataforma_metricas_entregues\(\)/)
    expect(sql).toMatch(/returns table\s*\(restaurante_id uuid, faturamento numeric, qtd_pedidos bigint\)/)
    expect(sql).toMatch(/where status = 'entregue'/)
    expect(sql).toMatch(/group by restaurante_id/)
  })
  it('só o servidor executa (security definer com revoke)', () => {
    expect(sql).toMatch(/security definer/)
    expect(sql).toMatch(/revoke all on function public\.plataforma_metricas_entregues\(\) from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.plataforma_metricas_entregues\(\) to service_role/)
  })
})
