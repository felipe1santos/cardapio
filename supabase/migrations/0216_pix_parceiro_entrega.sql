-- 0216 — Cobrar por Pix antes de chamar parceiro que não recebe na entrega (21/10/2026).
-- Pedido "a receber" (dinheiro/maquininha) + parceiro que não cobra (Uber, Lalamove): a loja manda um Pix do TOTAL;
-- pago, o servidor chama o parceiro sozinho. pagamentos_online ganha a finalidade 'entrega_parceiro'; o estado do fluxo
-- fica em pedidos.parceiro_pix {provedor, estado, preco, desde} — lido pelo Kanban (pedidos tem SELECT de tabela para o
-- painel; só UPDATE é por coluna, e quem grava aqui é o servidor). Aditiva. Rollback: drop column + CHECK da 0206.
alter table public.pagamentos_online drop constraint if exists pagamentos_online_finalidade_check;
alter table public.pagamentos_online add constraint pagamentos_online_finalidade_check
  check (finalidade in ('pedido', 'diferenca', 'entrega_parceiro'));
alter table public.pedidos add column if not exists parceiro_pix jsonb;
