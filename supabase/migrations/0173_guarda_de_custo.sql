-- 0173 — Guarda de custo das APIs pagas (10/10/2026, incidente Geocoding: ~20 mil chamadas em 03–09/10).
--   · api_uso_dia: chamadas (e custo em centavos) por API, por escopo ('total' ou id da loja) e por dia (São Paulo);
--   · api_uso_contar(): incrementa de forma ATÔMICA só se o total do dia ainda está abaixo do limite —
--     devolve { permitido, chamadas, limite }; com o limite atingido, ninguém mais chama a API até virar o dia;
--   · api_alertas: 80% do limite, limite atingido e disparo (mesma chamada > 20/min);
--   · geocode_cache: endereço normalizado → coordenada, compartilhado entre lojas; FALHA também fica guardada
--     (expira_em: 24 h para "não encontrado"; 1 h para recusa do Google).
-- Tudo só do servidor (service_role): RLS ligada sem política. Rollback: docs/rollback/0173_guarda_de_custo.down.sql
create table if not exists public.api_uso_dia (
  api text not null,
  escopo text not null,
  dia date not null,
  chamadas integer not null default 0,
  custo_centavos bigint not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (api, escopo, dia)
);
alter table public.api_uso_dia enable row level security;
revoke all on public.api_uso_dia from anon, authenticated;

create table if not exists public.api_alertas (
  id bigserial primary key,
  api text not null,
  nivel text not null check (nivel in ('atencao', 'bloqueio', 'disparo', 'erro')),
  mensagem text not null check (length(mensagem) <= 500),
  restaurante_id uuid,
  criado_em timestamptz not null default now()
);
create index if not exists api_alertas_criado on public.api_alertas (criado_em desc);
alter table public.api_alertas enable row level security;
revoke all on public.api_alertas from anon, authenticated;

create table if not exists public.geocode_cache (
  chave text primary key check (length(chave) <= 400),
  lat double precision,
  lng double precision,
  ok boolean not null,
  motivo text,
  consultado_em timestamptz not null default now(),
  expira_em timestamptz
);
alter table public.geocode_cache enable row level security;
revoke all on public.geocode_cache from anon, authenticated;

create or replace function public.api_uso_contar(p_api text, p_loja uuid, p_limite integer, p_custo_centavos bigint default 0, p_limite_custo_centavos bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
  v_chamadas integer;
begin
  insert into public.api_uso_dia (api, escopo, dia) values (p_api, 'total', v_dia) on conflict do nothing;
  update public.api_uso_dia
     set chamadas = chamadas + 1, custo_centavos = custo_centavos + coalesce(p_custo_centavos, 0), atualizado_em = now()
   where api = p_api and escopo = 'total' and dia = v_dia
     and chamadas < p_limite
     and (p_limite_custo_centavos is null or custo_centavos + coalesce(p_custo_centavos, 0) <= p_limite_custo_centavos)
  returning chamadas into v_chamadas;
  if v_chamadas is null then
    return jsonb_build_object('permitido', false, 'chamadas', p_limite, 'limite', p_limite);
  end if;
  if p_loja is not null then
    insert into public.api_uso_dia (api, escopo, dia, chamadas, custo_centavos) values (p_api, p_loja::text, v_dia, 1, coalesce(p_custo_centavos, 0))
    on conflict (api, escopo, dia) do update
      set chamadas = public.api_uso_dia.chamadas + 1, custo_centavos = public.api_uso_dia.custo_centavos + coalesce(p_custo_centavos, 0), atualizado_em = now();
  end if;
  return jsonb_build_object('permitido', true, 'chamadas', v_chamadas, 'limite', p_limite);
end $$;
revoke execute on function public.api_uso_contar(text, uuid, integer, bigint, bigint) from public, anon, authenticated;
