-- ============================================================================
-- 0080 — Isolamento de `restaurantes` entre lojas (Etapa 0 de segurança)
--
-- O vazamento: a policy "Anyone can read restaurant storefront" (0003:165) é
-- `using (true)` para `public` — anon E authenticated. A 0055 limitou as colunas
-- que o ANÔNIMO enxerga, mas o `authenticated` mantinha SELECT na tabela inteira
-- (0003:182). Resultado, medido em produção em 2026-09-23 (leitura read-only,
-- sem expor valores): um usuário logado de uma loja lia todas as colunas de todas
-- as outras lojas, incluindo `impressao_agente_token` — e com o token dá para
-- puxar a fila de impressão alheia (/api/agente/pedidos), com nome, telefone e
-- endereço de clientes.
--
-- A correção tem duas camadas:
--
-- 1. LINHAS. A leitura "vitrine aberta" passa a valer só para `anon`, que já está
--    limitado às colunas públicas da 0055. O `authenticated` fica só com a policy
--    que já existia, "Tenant members can read their restaurant"
--    (id = auth_restaurante_id()): enxerga a própria loja e nenhuma outra.
--    A vitrine não é afetada: o navegador lê com a chave anon, sem sessão
--    (lib/supabase/vitrine.ts), e a página do servidor passa a fazer o mesmo
--    (app/loja/[slug]/page.tsx) — antes ela lia com a sessão do visitante e,
--    com esta migration, um lojista logado deixaria de ver a vitrine de outra loja.
--
-- 2. COLUNA. `impressao_agente_token` sai do alcance do navegador de vez, até da
--    própria loja: nem SELECT nem UPDATE. Quem lê e gera o token é a rota de
--    servidor /api/admin/impressao/token, só para o dono. Postgres não deixa
--    revogar uma coluna de quem tem o privilégio na tabela inteira; por isso o
--    grant de tabela vira grant por coluna, calculado aqui a partir das colunas
--    existentes (todas menos o token).
--
-- ⚠ CONSEQUÊNCIA PARA MIGRATIONS FUTURAS: coluna nova em `restaurantes` NÃO fica
--   visível para o painel automaticamente. Toda migration que adicionar coluna
--   que o painel lê pelo navegador precisa de
--   `grant select (coluna) on public.restaurantes to authenticated` (e update, se
--   o painel grava). O teste scripts/seguranca/verificar-isolamento-lojas.mjs
--   falha se alguma coluna nova ficar sem grant.
--
-- ORDEM DE DEPLOY: o CÓDIGO que não pede mais o token pelo navegador tem que estar
-- no ar ANTES desta migration. Código antigo + esta migration = "permission denied
-- for column impressao_agente_token" nas telas de Ajustes › Impressão e no Kanban.
-- Rollback: docs/PDV-V2-OPERACAO.md, seção "Rollback da 0080".
-- ============================================================================

-- 1. Linhas -------------------------------------------------------------------
drop policy if exists "Anyone can read restaurant storefront" on public.restaurantes;
drop policy if exists "Visitante le a vitrine" on public.restaurantes;
create policy "Visitante le a vitrine"
  on public.restaurantes for select to anon
  using (true);

-- A policy da própria loja já existe desde a 0001/0003; recriada aqui de forma
-- idempotente só para garantir que ninguém fique sem acesso ao próprio registro.
drop policy if exists "Tenant members can read their restaurant" on public.restaurantes;
create policy "Tenant members can read their restaurant"
  on public.restaurantes for select to authenticated
  using (id = auth_restaurante_id());

-- 2. Coluna -------------------------------------------------------------------
do $$
declare
  v_colunas text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_colunas
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'restaurantes'
     and column_name <> 'impressao_agente_token';

  execute 'revoke select, update on public.restaurantes from authenticated';
  execute format('grant select (%s) on public.restaurantes to authenticated', v_colunas);
  execute format('grant update (%s) on public.restaurantes to authenticated', v_colunas);
end $$;

-- `anon` nunca teve o token (0055:75); reforço explícito, sem efeito colateral.
revoke select (impressao_agente_token) on public.restaurantes from anon;
