-- Rollback da 0098. Só remove o gatilho e a função; nenhum pedido é alterado.
-- Sem ele, a entrega do balcão volta ao comportamento anterior: fica em "pronto"
-- (Kanban mostra "Na logística" ou os botões manuais, conforme a loja).
drop trigger if exists pedidos_balcao_entrega_destino on public.pedidos;
drop function if exists public.pedido_entrega_balcao_destino();
