-- 0184 — Agente de IA: pedido já criado (12/10/2026, teste do Felipe no #287).
--  pediu_atendente_motivo: quando a IA chama alguém da loja ("Cancelamento do pedido #287", "Alteração do pedido #287"),
--    o motivo aparece na central (amarela, no topo). Nulo = pedido de atendente pelo robô (o "0").
--  pediu_atendente_aviso_em: o cliente foi avisado uma vez de que a loja já sabe (10 min sem resposta; cron do WhatsApp).
-- Só colunas novas, nulas: nada muda para as conversas existentes. Rollback: docs/rollback/0184_ia_pos_pedido_atendente.down.sql.

alter table public.whatsapp_conversas
  add column if not exists pediu_atendente_motivo text,
  add column if not exists pediu_atendente_aviso_em timestamptz;

alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_pediu_atendente_motivo_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_pediu_atendente_motivo_check
  check (pediu_atendente_motivo is null or char_length(pediu_atendente_motivo) <= 200);

-- Aviso de 10 min: o cron procura só conversas com motivo e sem aviso.
create index if not exists whatsapp_conversas_atendente_aviso_idx on public.whatsapp_conversas (pediu_atendente_em)
  where pediu_atendente_motivo is not null and pediu_atendente_aviso_em is null;
