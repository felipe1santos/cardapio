-- 0238 — Índices para as consultas de cron e do robô (01/11/2026, auditoria de infraestrutura, Fase 6). Aditiva, reaplicável.
-- Hoje as tabelas são pequenas e tudo leva 1 ms; sem índice, cada uma dessas consultas é uma varredura completa que
-- cresce com o histórico: 1.440×/dia por rotina. Rollback: drop index if exists <nome> (cada um abaixo).

-- Pix do parceiro sem pagamento (lib/entregas/parceiro-pix-servidor.ts, cron canais 1/min, todas as lojas).
create index if not exists pedidos_parceiro_pix_aguardando_idx
  on public.pedidos ((parceiro_pix->>'desde')) where (parceiro_pix->>'estado') = 'aguardando' and pago = false;

-- Corridas em andamento dos parceiros (lib/entregas/provedores.ts, cron canais 1/min).
create index if not exists entregas_provedor_ativas_idx
  on public.entregas_provedor (atualizado_em) where status in ('ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP');

-- Pedidos do cliente por telefone (robô/IA a cada mensagem; vitrine na aba Pedidos a cada 8 s).
create index if not exists pedidos_loja_telefone_idx
  on public.pedidos (restaurante_id, cliente_telefone, criado_em desc);

-- FKs de pedidos sem índice: apagar/desfazer um pedido varria estas 4 tabelas inteiras.
create index if not exists whatsapp_envios_pedido_idx on public.whatsapp_envios (pedido_id) where pedido_id is not null;
create index if not exists push_envios_pedido_idx on public.push_envios (pedido_id) where pedido_id is not null;
create index if not exists pedido_itens_custo_pedido_idx on public.pedido_itens_custo (pedido_id);
create index if not exists cupom_usos_pedido_idx on public.cupom_usos (pedido_id) where pedido_id is not null;
