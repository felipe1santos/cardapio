-- Rollback da 0127 (notificações push). Apaga assinaturas e histórico de envios.
drop function if exists public.push_reservar_envios(integer);
drop table if exists public.push_envios;
drop table if exists public.push_avulsas;
drop table if exists public.push_assinaturas;
drop table if exists public.push_automacoes;
drop table if exists public.push_config;
alter table public.restaurantes drop column if exists push_liberado;
