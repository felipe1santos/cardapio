-- Rollback da 0139: remove a trilha de auditoria da plataforma (perde o histórico gravado nela).
drop table if exists public.auditoria_plataforma;
