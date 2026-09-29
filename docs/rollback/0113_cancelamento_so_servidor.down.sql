-- Rollback da 0113. ATENÇÃO: reabre o cancelamento direto pelo PostgREST (sem motivo/auditoria).
drop trigger if exists pedidos_cancelamento_so_servidor on public.pedidos;
drop function if exists public.pedidos_cancelamento_so_servidor();
