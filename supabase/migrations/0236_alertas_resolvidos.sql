-- 0236 — Histórico de alertas com "resolvido" (01/11/2026, auditoria de infraestrutura, Fase 1).
-- O vigia (lib/saude/vigia.ts) marca resolvido_em quando o assunto de um alerta aberto some da foto seguinte; o Super
-- Admin mostra uma linha por assunto (quantas vezes saiu, se ainda está ativo). Aditiva: nenhuma linha muda.
-- Rollback: drop index if exists public.sistema_alertas_abertos; alter table public.sistema_alertas drop column if exists resolvido_em;

alter table public.sistema_alertas add column if not exists resolvido_em timestamptz;

-- Consulta do vigia a cada 5 min: alertas abertos dos últimos 7 dias.
create index if not exists sistema_alertas_abertos on public.sistema_alertas (criado_em desc) where resolvido_em is null;
