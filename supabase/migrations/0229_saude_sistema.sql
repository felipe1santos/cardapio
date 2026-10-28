-- 0229 — Vigia da saúde do sistema (28/10/2026, varredura de custo/carga — docs/relatorios/2026-10-28-varredura.md, Etapa 7).
-- Em 27/10 o Supabase bloqueou o projeto por egress sem nenhum aviso antes. O vigia (dentro do cron do WhatsApp, a cada
-- 5 min) tira uma foto dos números, compara com a média e manda alerta no WhatsApp do dono.
--  · sistema_saude_fotos: a foto de cada rodada (contadores acumulados do banco + VPS + APIs pagas) — 30 dias.
--  · sistema_alertas: histórico do que foi mandado (e a trava de 6 h por assunto) — 180 dias.
--  · sistema_cron_batidas: última vez que cada cron rodou (cron parado = alerta).
--  · sistema_saude_contadores(): requisições PostgREST e consultas acumuladas (pg_stat_statements) e tamanho do banco.
-- Só o servidor (service_role) lê e grava: RLS ligada sem política nenhuma.
-- Rollback: drop function if exists public.sistema_saude_contadores(); drop table if exists public.sistema_cron_batidas,
--           public.sistema_alertas, public.sistema_saude_fotos;

create table if not exists public.sistema_saude_fotos (
  id bigserial primary key,
  em timestamptz not null default now(),
  req_postgrest bigint,
  consultas bigint,
  dados jsonb not null default '{}'::jsonb
);
create index if not exists sistema_saude_fotos_em on public.sistema_saude_fotos (em desc);

create table if not exists public.sistema_alertas (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  assunto text not null,
  nivel text not null check (nivel in ('amarelo', 'vermelho', 'resumo', 'teste')),
  texto text not null,
  canal text,
  enviado boolean not null default false,
  erro text
);
create index if not exists sistema_alertas_assunto_em on public.sistema_alertas (assunto, criado_em desc);

create table if not exists public.sistema_cron_batidas (
  nome text primary key,
  ultima_em timestamptz not null default now()
);

alter table public.sistema_saude_fotos enable row level security;
alter table public.sistema_alertas enable row level security;
alter table public.sistema_cron_batidas enable row level security;
revoke all on public.sistema_saude_fotos, public.sistema_alertas, public.sistema_cron_batidas from anon, authenticated;
grant select, insert, update, delete on public.sistema_saude_fotos, public.sistema_alertas, public.sistema_cron_batidas to service_role;
grant usage, select on sequence public.sistema_saude_fotos_id_seq, public.sistema_alertas_id_seq to service_role;

-- Soma por queryid de todos os papéis (o mesmo id aparece uma vez por papel). `select set_config(` = 1 por requisição PostgREST.
create or replace function public.sistema_saude_contadores()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'req_postgrest', coalesce(sum(calls) filter (where query like 'select set_config(%'), 0),
    'consultas', coalesce(sum(calls), 0),
    'db_bytes', pg_database_size(current_database()),
    'conexoes', (select count(*) from pg_stat_activity)
  )
  from extensions.pg_stat_statements
$$;
revoke all on function public.sistema_saude_contadores() from public, anon, authenticated;
grant execute on function public.sistema_saude_contadores() to service_role;
