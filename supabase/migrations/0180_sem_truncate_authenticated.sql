-- 0180 — Retira TRUNCATE dos papéis do navegador (anon, authenticated) em todas as tabelas de public (10/10/2026,
-- auditoria de segurança). TRUNCATE não passa pela API (PostgREST), não respeita RLS e nenhuma função usa; era só o
-- padrão do Supabase. Também para tabelas futuras (default privileges do dono das migrações).
-- Rollback: docs/rollback/0180_sem_truncate_authenticated.down.sql (lista exata de antes).
revoke truncate on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;
