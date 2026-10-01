-- Rollback da 0125. Voltar o CÓDIGO antes (ele chama as funções).
drop function if exists public.cupom_reservar_cliente(uuid, uuid, text);
drop function if exists public.cupom_liberar_cliente(uuid, text);
drop table if exists public.cupom_reservas_cliente;
