-- 0241 — Função nova nasce fechada (01/11/2026, auditoria de infraestrutura, Fase 6).
-- O privilégio padrão do schema dava EXECUTE a anon e authenticated em toda função criada pelo `postgres` (migrations):
-- uma RPC security definer nova ficava aberta pelo PostgREST até alguém lembrar de revogar. Em produção todas as
-- funções de escrita já foram revogadas à mão; isto só muda o PADRÃO para as próximas. Funções existentes não mudam
-- (a vitrine continua com as dela). A guarda B7 (scripts/guardas/bugs-conhecidos.mjs) exige grant/revoke explícito em
-- toda função nova a partir desta migration.
-- Rollback: alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;

alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
