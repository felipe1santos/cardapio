-- 0214 — Cabeçalho da vitrine configurável (21/10/2026): Ajustes › Perfil › "O que mostrar na vitrine".
-- {status, tempo, avaliacao, endereco}: vazio = tudo ligado (lib/vitrine-cabecalho.ts), igual a antes.
-- restaurantes tem grant POR COLUNA (0055/0080): anon lê (vitrine); authenticated lê e grava (Perfil).
-- Aditiva. Rollback: alter table public.restaurantes drop column vitrine_cabecalho.

alter table public.restaurantes add column if not exists vitrine_cabecalho jsonb not null default '{}'::jsonb;
alter table public.restaurantes drop constraint if exists restaurantes_vitrine_cabecalho_check;
alter table public.restaurantes add constraint restaurantes_vitrine_cabecalho_check check (jsonb_typeof(vitrine_cabecalho) = 'object');

grant select (vitrine_cabecalho) on public.restaurantes to anon, authenticated;
grant update (vitrine_cabecalho) on public.restaurantes to authenticated;
