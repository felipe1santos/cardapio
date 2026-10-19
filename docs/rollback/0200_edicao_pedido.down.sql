-- Desfaz a 0200 (edição de pedido). Apaga as solicitações e o rastro das edições — backup antes.
alter publication supabase_realtime drop table public.pedido_solicitacoes;
drop table if exists public.pedido_solicitacoes;
alter table public.pedidos drop column if exists editado_em;
alter table public.pedidos drop column if exists editado_por_nome;
alter table public.pedidos drop column if exists edicoes;
alter table public.pedidos drop column if exists diferenca_a_receber;
alter table public.pedidos drop column if exists observacao_original;
alter table public.pagamentos_online drop column if exists devolucao_valor;
alter table public.pagamentos_online drop constraint if exists pagamentos_online_status_check;
alter table public.pagamentos_online add constraint pagamentos_online_status_check
  check (status in ('pendente', 'pago', 'expirado', 'cancelado', 'a_devolver', 'devolvido', 'verificacao_pendente', 'erro'));
