-- 0233 — Espera crescente entre tentativas nos 3 riscos médios da auditoria (28/10/2026,
-- docs/relatorios/2026-10-28-auditoria-travas.md). Só colunas novas, todas nulas/zero: nada muda para o que já existe.
--   · pedidos_externos: status para iFood/99Food/Open Delivery com erro era reenviado todo minuto, sem limite.
--   · pagamentos_online: Pix com erro de API era consultado no Mercado Pago todo minuto, para sempre; e os 200 mais
--     antigos presos tampavam a fila dos novos.
--   · entregas_provedor: corrida ativa consultada no parceiro a cada ~1 min durante toda a corrida (cota do sistema).
-- Rollback: alter table ... drop column (as 4 abaixo).

alter table public.pedidos_externos add column if not exists envio_tentativas integer not null default 0;
alter table public.pedidos_externos add column if not exists envio_proxima_em timestamptz;
alter table public.pagamentos_online add column if not exists proxima_verificacao_em timestamptz;
alter table public.entregas_provedor add column if not exists consultado_em timestamptz;
