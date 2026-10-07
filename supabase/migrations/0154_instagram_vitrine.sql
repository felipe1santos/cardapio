-- 0154 — Instagram da loja na ficha "Sobre a loja" da vitrine (2026-10-07).
-- A vitrine lê restaurantes como anon (PostgREST, grants por coluna). instagram_url (0106) só tinha
-- leitura para authenticated; o link é público (a loja o divulga), então o anon passa a ler.
-- Sem dado novo nem convertido. Rollback: docs/rollback/0154_instagram_vitrine.down.sql
grant select (instagram_url) on public.restaurantes to anon;
