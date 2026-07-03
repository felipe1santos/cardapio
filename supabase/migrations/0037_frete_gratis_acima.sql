-- Entrega grátis para pedidos acima de um valor mínimo (configurável por loja).
-- NULL = recurso desativado.
alter table public.restaurantes
  add column if not exists frete_gratis_acima numeric(10, 2);
