-- supabase/migrations/0030_cozinha_preparo.sql
-- Rastreio de preparo na cozinha: quem pegou o pedido (claim) e quem concluiu.
alter table pedidos
  add column preparando_por text,
  add column preparado_por text;
