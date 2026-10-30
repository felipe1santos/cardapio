-- 0235 — Quarentena de arquivos sem uso no bucket `cardapio` (30/10/2026, aprovado pelo dono). NÃO APAGA NENHUM ARQUIVO: só anota
-- quais estão órfãos e desde quando. A remoção vem em etapa própria, pela API de Storage (delete por SQL deixa o arquivo pago no
-- bucket; ver docs do Supabase "delete-objects"), depois de 7 dias nesta lista.
--   · Referência = qualquer coluna de texto/JSON/array do schema public que cite `/cardapio/<caminho>`. A lista de colunas vem de
--     information_schema, então coluna nova já entra sozinha. Imagem compartilhada (complementos) segue protegida.
--   · Fora da lista, sempre: nomes com caractere especial (na URL vêm codificados e não bateriam) e a pasta `impressao` (lida pelo
--     caminho, sem URL no banco). Outros buckets nem são lidos.
--   · Sem nenhuma referência encontrada, a rodada não marca nada: falha na varredura nunca vira "tudo órfão".
-- Chamada 1×/dia pelo vigia (lib/saude/vigia.ts). Uma consulta só: 0,65 s medido em 30/10 (limite do PostgREST: 8 s).
-- Rollback: drop function public.storage_quarentena_atualizar(); drop table public.storage_quarentena;

create table if not exists public.storage_quarentena (
  nome text primary key,
  tamanho bigint not null default 0,
  visto_em timestamptz not null default now()
);
alter table public.storage_quarentena enable row level security;
-- Sem política: só o servidor. Grant explícito: tabela nova em public não é mais exposta sozinha (Supabase, 30/10/2026).
revoke all on public.storage_quarentena from public, anon, authenticated;
grant select, insert, update, delete on public.storage_quarentena to service_role;

create or replace function public.storage_quarentena_atualizar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fontes text;
  r jsonb;
begin
  select string_agg(format('select %I::text v from public.%I where %I::text like %L', c.column_name, c.table_name, c.column_name, '%/cardapio/%'), ' union all ')
    into fontes
    from information_schema.columns c
    join pg_catalog.pg_tables t on t.schemaname = c.table_schema and t.tablename = c.table_name
   where c.table_schema = 'public'
     and c.table_name <> 'storage_quarentena'
     and c.data_type in ('text', 'ARRAY', 'jsonb', 'json', 'character varying');

  execute format($sql$
    with bruto as (%s),
    achados as (
      select distinct rtrim((regexp_matches(v, '/cardapio/([A-Za-z0-9/._-]+)', 'g'))[1], './_-') nome from bruto
    ),
    orfaos as (
      select o.name, coalesce((o.metadata->>'size')::bigint, 0) tamanho
        from storage.objects o
       where o.bucket_id = 'cardapio'
         and (select count(*) from achados) > 0
         and o.name ~ '^[A-Za-z0-9/._-]+$'
         and o.name !~ '(^|/)impressao/'
         and not exists (select 1 from achados a where a.nome = o.name)
    ),
    voltaram as (
      delete from public.storage_quarentena q where not exists (select 1 from orfaos o where o.name = q.nome) returning 1
    ),
    novos as (
      insert into public.storage_quarentena (nome, tamanho) select name, tamanho from orfaos on conflict (nome) do nothing returning 1
    )
    select jsonb_build_object(
      'referencias', (select count(*) from achados),
      'orfaos', (select count(*) from orfaos),
      'bytes', (select coalesce(sum(tamanho), 0) from orfaos),
      'novos', (select count(*) from novos),
      'voltaram', (select count(*) from voltaram)
    )
  $sql$, fontes) into r;
  return r;
end $$;
revoke all on function public.storage_quarentena_atualizar() from public, anon, authenticated;
grant execute on function public.storage_quarentena_atualizar() to service_role;
