-- Rollback da 0168
drop trigger if exists auditar_imprimir_sozinho on public.restaurantes;
drop function if exists public.auditar_imprimir_sozinho();
