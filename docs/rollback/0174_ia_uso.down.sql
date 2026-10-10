-- Rollback da 0174 (contador da IA). Apaga só o que a 0174 criou.
drop function if exists public.ia_uso_registrar(uuid, text, bigint, bigint, bigint);
drop table if exists public.ia_uso_dia;
