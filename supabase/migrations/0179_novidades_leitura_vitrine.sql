-- 0179 — A vitrine pública (anon) precisa ler "Novidades em teste" (0178) para mostrar o carrossel de fotos só nas lojas
-- com a chave. restaurantes tem SELECT por COLUNA para anon: sem este grant, pôr a coluna no select derrubaria a vitrine.
-- Rollback: revoke select (novidades_teste) on public.restaurantes from anon, authenticated;
grant select (novidades_teste) on public.restaurantes to anon, authenticated;
