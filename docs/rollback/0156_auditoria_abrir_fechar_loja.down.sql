-- Desfaz a 0156 (os eventos já gravados ficam na auditoria).
drop trigger if exists restaurantes_audita_status_loja on public.restaurantes;
drop function if exists public.restaurantes_audita_status_loja();
