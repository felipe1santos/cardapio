-- Desfaz a 0173 (apaga a contagem, os alertas e o cache de geocodificação).
drop function if exists public.api_uso_contar(text, uuid, integer, bigint, bigint);
drop table if exists public.geocode_cache;
drop table if exists public.api_alertas;
drop table if exists public.api_uso_dia;
