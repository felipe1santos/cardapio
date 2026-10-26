-- 0225 — Índices para consultas que hoje varrem a tabela inteira (26/10/2026, auditoria de egress).
-- Medido no pg_stat_statements (52 h): whatsapp_envios 11,5 mi de linhas lidas por varredura, pedidos 5,8 mi,
-- whatsapp_conversas 5,2 mi. As tabelas ainda são pequenas, mas o custo cresce junto com elas.
-- Só índices: nenhum dado nem formato muda. Cada um corresponde a uma consulta vista no banco:
--   pedidos (entregador_id, status)                  app do motoboy (entregas dele, sem filtro de loja)
--   pedidos (restaurante_id, status, atualizado_em)  concluídos do dia (Kanban, Logística)
--   pedidos (restaurante_id, criado_em)              Kanban, Dashboard e tempos de entrega
--   pedido_itens (item_id)                           chave estrangeira sem índice (vendidos, apagar item)
--   whatsapp_envios (restaurante_id, telefone, …)    conferência de envio repetido
--   whatsapp_conversas (restaurante_id, estado, …)   contador da Central (~17 mil chamadas em 52 h)
-- Rollback: drop index if exists public.pedidos_entregador_status_idx, public.pedidos_loja_status_atualizado_idx,
--           public.pedidos_loja_criado_idx, public.pedido_itens_item_idx, public.whatsapp_envios_loja_telefone_idx,
--           public.whatsapp_conversas_loja_estado_idx;

create index if not exists pedidos_entregador_status_idx on public.pedidos (entregador_id, status) where entregador_id is not null;
create index if not exists pedidos_loja_status_atualizado_idx on public.pedidos (restaurante_id, status, atualizado_em desc);
create index if not exists pedidos_loja_criado_idx on public.pedidos (restaurante_id, criado_em);
create index if not exists pedido_itens_item_idx on public.pedido_itens (item_id) where item_id is not null;
create index if not exists whatsapp_envios_loja_telefone_idx on public.whatsapp_envios (restaurante_id, telefone, criado_em desc);
create index if not exists whatsapp_conversas_loja_estado_idx on public.whatsapp_conversas (restaurante_id, estado, atendimento);
