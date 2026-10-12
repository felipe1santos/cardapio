-- Rollback da 0190: volta a reserva da 0112 (sem janela/limite/frequência), push só onde era (Menuzia) e tira as colunas novas.
-- 1) Rode antes o corpo de campanha_reservar_envios de supabase/migrations/0112_campanhas_descadastro_pausa.sql
--    (drop function public.campanha_reservar_envios(integer); create function ... da 0112).
alter table public.restaurantes alter column push_liberado set default false;
update public.restaurantes set push_liberado = (slug = 'menuzia');
drop function if exists public.campanha_freio_numeros(uuid);
drop function if exists public.whatsapp_recebeu_disparo(uuid, text, integer);
drop function if exists public.whatsapp_esta_descadastrado(uuid, text);
alter table public.campanha_modelos drop column if exists titulo;
alter table public.campanha_envios drop column if exists ultimo_item;
alter table public.campanhas drop column if exists janela_inicio, drop column if exists janela_fim;
alter table public.restaurantes drop constraint if exists restaurantes_disparo_limite_dia_check;
alter table public.restaurantes drop column if exists disparo_limite_dia, drop column if exists disparo_proximo_em;
delete from public.plataforma_config where chave in ('disparo_teto_dia', 'disparo_frequencia_dias', 'push_teto_dia');
drop function if exists public.plataforma_int(text, integer);
