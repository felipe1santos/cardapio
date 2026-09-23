-- ============================================================================
-- 0081 — Etapa 0 de segurança, parte 2: funções SECURITY DEFINER e escrita anônima
--
-- Varredura de 2026-09-23 (banco local espelhando a produção) depois da 0080:
--
-- 1. Três funções SECURITY DEFINER eram executáveis por `anon` e `authenticated`
--    via PostgREST (/rest/v1/rpc/...), embora só o servidor (service_role) as chame:
--      · restaurante_id_por_agente_token(token) — oráculo: responde se um token de
--        Assistente de Impressão é válido e de qual loja. Chamada só por
--        lib/queries/impressao.ts com o cliente admin.
--      · campanha_incrementar_enviados / campanha_incrementar_erros — qualquer
--        visitante incrementava o contador de uma campanha de qualquer loja.
--        Chamadas só por lib/queries/campanhas.ts com o cliente admin.
--    Postgres concede EXECUTE a PUBLIC por padrão; por isso o revoke é de PUBLIC,
--    anon e authenticated, e o grant volta explícito só para service_role.
--
-- 2. `anon` tinha INSERT/UPDATE/DELETE/TRUNCATE de tabela em ~38 tabelas (resto do
--    default do Supabase). Hoje a RLS barra — nenhuma policy de escrita alcança
--    anon —, mas é uma camada só. Nada no produto escreve com a chave anônima: a
--    vitrine lê com ela (lib/supabase/vitrine.ts) e todo checkout, evento e QR de
--    mesa passa por rota de servidor com service_role. SELECT não é tocado (a
--    vitrine depende dele, filtrado por RLS e pelos grants de coluna da 0055).
--
-- Rollback: docs/rollback/0081_seg_funcoes_definer_e_escrita_anon.down.sql.
-- Não depende de ordem de deploy: nenhum código lê ou escreve por esses caminhos.
-- ============================================================================

revoke execute on function public.restaurante_id_por_agente_token(text) from public, anon, authenticated;
revoke execute on function public.campanha_incrementar_enviados(uuid) from public, anon, authenticated;
revoke execute on function public.campanha_incrementar_erros(uuid) from public, anon, authenticated;
grant execute on function public.restaurante_id_por_agente_token(text) to service_role;
grant execute on function public.campanha_incrementar_enviados(uuid) to service_role;
grant execute on function public.campanha_incrementar_erros(uuid) to service_role;

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t.relname);
  end loop;
end $$;
