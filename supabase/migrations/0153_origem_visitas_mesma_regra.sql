-- 0153 — "Origem das visitas" do Dashboard com a MESMA regra dos pedidos (decisão do dono, 2026-10-07).
--
-- Antes (0078): cada visitante contava uma vez, pela origem da PRIMEIRA visita do período; os pedidos
-- usam a última origem não-direta do aparelho em 7 dias (lib/origem-visita.ts). A conversão por canal
-- misturava as duas regras. Agora cada visita é atribuída como o pedido seria naquele instante e conta
-- uma vez por sessão e canal. Só muda o bloco "origens"; o resto da função é o mesmo da 0078.
-- Sem dado novo nem convertido: a função recalcula a partir de vitrine_eventos.
-- Rollback: docs/rollback/0153_origem_visitas_mesma_regra.down.sql (recria a versão da 0078).

create or replace function painel_analytics_vitrine(p_inicio timestamptz, p_fim timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  loja as (select auth_restaurante_id() as id),
  janela as (
    select e.* from vitrine_eventos e, loja
    where e.restaurante_id = loja.id and e.criado_em >= p_inicio and e.criado_em < p_fim
  ),
  anterior as (
    select e.* from vitrine_eventos e, loja
    where e.restaurante_id = loja.id
      and e.criado_em >= p_inicio - (p_fim - p_inicio) and e.criado_em < p_inicio
  ),
  funil as (
    select tipo, count(distinct visitante_id) as qtd from janela where tipo <> 'clique' group by tipo
  ),
  funil_ant as (
    select tipo, count(distinct visitante_id) as qtd from anterior where tipo <> 'clique' group by tipo
  ),
  por_dia as (
    select (date_trunc('day', criado_em at time zone 'America/Sao_Paulo'))::date as dia, tipo,
           count(distinct visitante_id) as qtd
    from janela where tipo <> 'clique'
    group by 1, 2
  ),
  -- primeira vez de cada etapa em cada sessão, para medir o tempo entre elas
  marcos as (
    select sessao_id,
      min(criado_em) filter (where tipo = 'visita') as visita,
      min(criado_em) filter (where tipo = 'visualizacao') as visualizacao,
      min(criado_em) filter (where tipo = 'sacola') as sacola,
      min(criado_em) filter (where tipo = 'checkout') as checkout,
      min(criado_em) filter (where tipo = 'pedido') as pedido
    from janela group by sessao_id
  ),
  tempos as (
    -- pares acima de 1h são aba esquecida aberta, não decisão de compra
    select
      avg(extract(epoch from visualizacao - visita)) filter (where visualizacao >= visita and visualizacao - visita < interval '1 hour') as visita_visualizacao,
      avg(extract(epoch from sacola - visualizacao)) filter (where sacola >= visualizacao and sacola - visualizacao < interval '1 hour') as visualizacao_sacola,
      avg(extract(epoch from checkout - sacola)) filter (where checkout >= sacola and checkout - sacola < interval '1 hour') as sacola_checkout,
      avg(extract(epoch from pedido - checkout)) filter (where pedido >= checkout and pedido - checkout < interval '1 hour') as checkout_pedido
    from marcos
  ),
  primeira_visita as (
    select e.visitante_id, min(e.criado_em) as primeira
    from vitrine_eventos e, loja
    where e.restaurante_id = loja.id and e.visitante_id in (select visitante_id from janela)
    group by e.visitante_id
  ),
  cliques as (
    select alvo, count(*) as cliques, count(distinct visitante_id) as visitantes
    from janela where tipo = 'clique' and alvo is not null
    group by alvo order by 2 desc limit 30
  ),
  -- Origem das visitas (0153, 2026-10-07): a MESMA regra dos pedidos — cada visita vai para a última
  -- origem NÃO-direta daquele aparelho nos 7 dias anteriores (inclusive antes do período); sem nenhuma,
  -- Direto. Conta uma vez por sessão e canal: recarregar a página não infla; chegar por outro link conta.
  nao_diretas as (
    select e.visitante_id, e.criado_em, e.origem
    from vitrine_eventos e, loja
    where e.restaurante_id = loja.id and e.tipo = 'visita'
      and e.origem is not null and e.origem <> 'Direto'
      and e.criado_em >= p_inicio - interval '7 days' and e.criado_em < p_fim
      and e.visitante_id in (select visitante_id from janela)
  ),
  atribuida as (
    select j.tipo, j.visitante_id, j.sessao_id,
      coalesce((
        select n.origem from nao_diretas n
        where n.visitante_id = j.visitante_id and n.criado_em <= j.criado_em and n.criado_em > j.criado_em - interval '7 days'
        order by n.criado_em desc limit 1
      ), 'Direto') as origem
    from janela j where j.tipo in ('visita', 'pedido')
  ),
  origens as (
    select origem,
           count(distinct sessao_id) filter (where tipo = 'visita') as visitas,
           count(distinct sessao_id) filter (where tipo = 'pedido') as pedidos
    from atribuida group by origem order by 2 desc limit 20
  )
  select jsonb_build_object(
    'funil', coalesce((select jsonb_object_agg(tipo, qtd) from funil), '{}'::jsonb),
    'funilAnterior', coalesce((select jsonb_object_agg(tipo, qtd) from funil_ant), '{}'::jsonb),
    'porDia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'tipo', tipo, 'qtd', qtd)) from por_dia), '[]'::jsonb),
    'tempos', (select to_jsonb(t) from tempos t),
    'visitantes', jsonb_build_object(
      'total', (select count(*) from primeira_visita),
      'novos', (select count(*) from primeira_visita where primeira >= p_inicio)
    ),
    'cliques', coalesce((select jsonb_agg(to_jsonb(c)) from cliques c), '[]'::jsonb),
    'origens', coalesce((select jsonb_agg(to_jsonb(o)) from origens o), '[]'::jsonb)
  );
$$;

grant execute on function painel_analytics_vitrine(timestamptz, timestamptz) to authenticated;
