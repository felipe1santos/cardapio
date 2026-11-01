-- 0240 — Quarentena do Storage com lista fixa de colunas (01/11/2026, auditoria de infraestrutura, Fase 6).
-- A 0235 montava a varredura a partir de information_schema: TODA coluna de texto/JSON do schema (pedidos, mensagens do
-- WhatsApp, auditoria, eventos da vitrine…) numa requisição de 8 s — ia falhar em silêncio com as tabelas crescendo.
-- Agora lê só as colunas que guardam URL do bucket (as 16 com `/cardapio/` em produção em 01/11). Coluna nova que
-- guarde URL de arquivo precisa entrar nesta lista (senão o arquivo dela aparece como órfão na quarentena — que NÃO apaga
-- nada; a remoção é etapa própria e manual). Resto igual à 0235. Rollback: reaplicar a 0235.

create or replace function public.storage_quarentena_atualizar()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  with bruto as (
    select imagem_url::text v from public.itens_cardapio where imagem_url::text like '%/cardapio/%'
    union all select imagem_thumb_url::text v from public.itens_cardapio where imagem_thumb_url::text like '%/cardapio/%'
    union all select video::text v from public.itens_cardapio where video::text like '%/cardapio/%'
    union all select imagem_url::text v from public.item_complementos where imagem_url::text like '%/cardapio/%'
    union all select imagem_url::text v from public.pizza_sabores where imagem_url::text like '%/cardapio/%'
    union all select imagem_url::text v from public.grupos_cardapio where imagem_url::text like '%/cardapio/%'
    union all select imagem_url::text v from public.preset_complemento_itens where imagem_url::text like '%/cardapio/%'
    union all select logo_url::text v from public.restaurantes where logo_url::text like '%/cardapio/%'
    union all select banner_url::text v from public.restaurantes where banner_url::text like '%/cardapio/%'
    union all select banner_mobile_url::text v from public.restaurantes where banner_mobile_url::text like '%/cardapio/%'
    union all select mesa_carrossel_urls::text v from public.restaurantes where mesa_carrossel_urls::text like '%/cardapio/%'
    union all select banner_promo_video::text v from public.restaurantes where banner_promo_video::text like '%/cardapio/%'
    union all select imagem_url::text v from public.campanhas where imagem_url::text like '%/cardapio/%'
    union all select foto_url::text v from public.entregadores where foto_url::text like '%/cardapio/%'
    union all select midia_url::text v from public.whatsapp_mensagens where midia_url::text like '%/cardapio/%'
    union all select payload::text v from public.push_envios where payload::text like '%/cardapio/%'
  ),
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
  ) into r;
  return r;
end $$;
revoke all on function public.storage_quarentena_atualizar() from public, anon, authenticated;
grant execute on function public.storage_quarentena_atualizar() to service_role;
