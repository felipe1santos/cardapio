-- Rollback da 0140: tira os gatilhos que fecham a comanda de entrega quitada e a agregação do fluxo.
-- (Comandas já fechadas por eles continuam fechadas — fechar não lança nada no livro-caixa.)
drop trigger if exists fin_pedido_entregue_fecha_comanda on public.pedidos;
drop trigger if exists fin_pagamento_fecha_comanda_entrega on public.pagamentos_comanda;
drop function if exists public.fin_pedido_entregue_fecha_comanda();
drop function if exists public.fin_pagamento_fecha_comanda_entrega();
drop function if exists public.fin_fechar_comanda_entrega_quitada(uuid, uuid, uuid, text);
drop function if exists public.fin_fluxo_turnos(uuid, date, date, text[], text[], uuid, uuid, uuid);
drop function if exists public.fin_grupo_origem(text);
drop function if exists public.fin_grupo_forma(text);
drop index if exists public.fin_lancamentos_referencia_idx;
drop index if exists public.pedidos_cancelado_em_idx;
