-- Rollback da 0184 (o código novo lê as colunas: voltar o deploy ANTES de rodar isto).
drop index if exists public.whatsapp_conversas_atendente_aviso_idx;
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_pediu_atendente_motivo_check;
alter table public.whatsapp_conversas drop column if exists pediu_atendente_aviso_em, drop column if exists pediu_atendente_motivo;
