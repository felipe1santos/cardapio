-- Rollback da 0160 (perde a escolha das lojas e o selo dos pedidos já marcados).
revoke select (despacho_automatico) on public.restaurantes from authenticated;
alter table public.restaurantes drop column if exists despacho_automatico;
alter table public.pedidos drop column if exists entregue_automatico;
