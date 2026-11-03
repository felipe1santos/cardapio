import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 03/11/2026 (pedido do dono): "Excluir dados" do Super Admin não apagava nada — `usuarios` tem referências sem cascade
 * (pedidos.criado_por…), `fin_*`/`pagamentos_online` são RESTRICT e as tabelas financeiras/auditoria têm gatilho
 * imutável. A função roda como postgres (fin_manutencao() libera os gatilhos), solta as referências a usuários,
 * apaga tudo que é da loja em passadas (até não sobrar violação de FK) e por fim usuários e a loja.
 */
const sql = readFileSync('supabase/migrations/0244_plataforma_excluir_loja.sql', 'utf8')

describe('0244 exclusão definitiva de uma loja', () => {
  it('função security definer só para o servidor, devolvendo o que apagou', () => {
    expect(sql).toMatch(/create or replace function public\.plataforma_excluir_loja\(p_restaurante uuid\)/)
    expect(sql).toMatch(/security definer/)
    expect(sql).toMatch(/returns jsonb/)
    expect(sql).toMatch(/revoke all on function public\.plataforma_excluir_loja\(uuid\) from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.plataforma_excluir_loja\(uuid\) to service_role/)
  })
  it('preserva histórico da plataforma, apaga usuários depois das linhas da loja e a loja por último', () => {
    expect(sql).toMatch(/update public\.auditoria_plataforma set restaurante_id = null/)
    expect(sql).toMatch(/update public\.assinaturas set restaurante_id = null/)
    expect(sql).toMatch(/delete from public\.usuarios where restaurante_id = p_restaurante/)
    expect(sql.lastIndexOf('delete from public.restaurantes where id = p_restaurante')).toBeGreaterThan(sql.lastIndexOf('delete from public.usuarios where restaurante_id = p_restaurante'))
  })
  it('não toca em outras lojas: todo delete dinâmico filtra por restaurante_id = $1', () => {
    expect(sql).toMatch(/where restaurante_id = \$1/)
    expect(sql).not.toMatch(/truncate/i)
  })
})
