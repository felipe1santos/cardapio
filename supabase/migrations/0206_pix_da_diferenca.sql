-- 0206 — Pix da diferença (19/10/2026, Etapa 1 do modo autônomo; Fase 3 da edição de pedido).
-- Pedido pago online cujo total AUMENTA na edição: a loja pode cobrar SÓ a diferença por Pix (Mercado Pago da loja)
-- ou receber na entrega. A cobrança da diferença é uma linha de pagamentos_online com finalidade 'diferenca'
-- (referência = o mesmo pedido; valor = diferença). O pedido guarda o modo escolhido.
alter table public.pagamentos_online add column if not exists finalidade text not null default 'pedido';
alter table public.pagamentos_online drop constraint if exists pagamentos_online_finalidade_check;
alter table public.pagamentos_online add constraint pagamentos_online_finalidade_check
  check (finalidade in ('pedido', 'diferenca'));

-- 'entrega' = o motoboy/caixa recebe; 'pix' = cobrança Pix pendente; 'pix_vencido' = passou dos 30 min sem pagar (a loja decide).
alter table public.pedidos add column if not exists diferenca_modo text;
alter table public.pedidos drop constraint if exists pedidos_diferenca_modo_check;
alter table public.pedidos add constraint pedidos_diferenca_modo_check
  check (diferenca_modo is null or diferenca_modo in ('entrega', 'pix', 'pix_vencido'));
-- pedidos tem SELECT na tabela inteira para authenticated (não é por coluna): nada a conceder.

-- Diferenças já marcadas "a receber na entrega" pelas edições anteriores (Fase 2) ganham o modo explícito.
update public.pedidos set diferenca_modo = 'entrega' where diferenca_a_receber is not null and diferenca_a_receber > 0 and diferenca_modo is null;
