-- Cancelamento de pedido pelo Kanban: motivo, autoria e momento.
-- Aditiva e idempotente. Pedidos cancelados antes desta migration ficam com as
-- colunas nulas — é histórico, não erro.

alter table pedidos add column if not exists cancelado_motivo text;
alter table pedidos add column if not exists cancelado_observacao text;
alter table pedidos add column if not exists cancelado_por text;
alter table pedidos add column if not exists cancelado_em timestamptz;
