-- 0232 — Saúde do sistema com números reais (28/10/2026, pedido do dono): tamanho exato do Storage no contador e a série
-- diária (30 dias) para os gráficos do Super Admin › Saúde do sistema. Só o servidor (service_role).
-- Rollback: recriar sistema_saude_contadores da 0229; drop function if exists public.sistema_saude_dias(integer);

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
    'conexoes', (select count(*) from pg_stat_activity),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects)
  )
  from extensions.pg_stat_statements
$$;
revoke all on function public.sistema_saude_contadores() from public, anon, authenticated;
grant execute on function public.sistema_saude_contadores() to service_role;

-- Por dia (São Paulo): requisições PostgREST (soma dos saltos do contador entre fotos; zerou = ignora o salto), bytes que
-- saíram da instância do banco (Prometheus oficial, salvo pelo vigia em dados.oficial.prom.txDelta) e a contagem oficial
-- de 24 h da Management API na última foto do dia.
create or replace function public.sistema_saude_dias(p_dias integer default 30)
returns table(dia date, req_postgrest bigint, tx_bytes bigint, oficial_24h jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select em, (em at time zone 'America/Sao_Paulo')::date d, req_postgrest,
           req_postgrest - lag(req_postgrest) over (order by em) salto,
           (dados #>> '{oficial,prom,txDelta}')::bigint tx,
           dados #> '{oficial,supabase,req24h}' of24
      from public.sistema_saude_fotos
     where em > now() - make_interval(days => greatest(1, least(p_dias, 31)))
  )
  select d,
         coalesce(sum(salto) filter (where salto >= 0), 0)::bigint,
         coalesce(sum(tx), 0)::bigint,
         (array_agg(of24 order by em desc) filter (where of24 is not null))[1]
    from f group by d order by d
$$;
revoke all on function public.sistema_saude_dias(integer) from public, anon, authenticated;
grant execute on function public.sistema_saude_dias(integer) to service_role;
