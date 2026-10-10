-- Rollback da 0176: some a trava de módulos (o app volta a mostrar o Financeiro pela flag financeiro_ativo).
drop function if exists public.auth_modulo_liberado(text);
drop function if exists public.modulo_liberado(uuid, text);
drop table if exists public.loja_modulos;
