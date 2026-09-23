-- ============================================================================
-- 0078 — Analytics da vitrine + horário de cada etapa do pedido
--
-- 1) vitrine_eventos: o que o cliente faz no cardápio público (abriu a loja,
--    abriu um item, pôs na sacola, abriu o checkout, fechou o pedido, clicou em
--    algo). É daí que sai o funil Visitas → Visualizações → Sacola → Checkout →
--    Pedidos do Dashboard. Quem escreve é só a rota /api/loja/[slug]/eventos,
--    com a chave de serviço — anon NÃO tem policy de insert, então ninguém
--    enche a tabela de outra loja pelo PostgREST.
--
-- 2) pedidos.{preparando_em, pronto_em, em_rota_em, entregue_em}: o banco só
--    guardava o status ATUAL, então não dava pra saber quanto tempo a entrega
--    levou. Um gatilho carimba a hora na primeira vez que o pedido entra em
--    cada etapa — vale para kanban, app do entregador, Nexta e o que vier.
--    Colunas novas e nulas: pedidos antigos ficam sem tempo (não inventamos),
--    e o código antigo não lê nada disso — pode aplicar antes do deploy.
-- ============================================================================

create table if not exists vitrine_eventos (
  id bigint generated always as identity primary key,
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  -- id anônimo guardado no aparelho (localStorage); não é pessoa identificada
  visitante_id text not null,
  -- uma "ida" à loja; expira com 30 min parado
  sessao_id text not null,
  tipo text not null check (tipo in ('visita', 'visualizacao', 'sacola', 'checkout', 'pedido', 'clique')),
  item_id uuid references itens_cardapio (id) on delete set null,
  -- rótulo do clique ("Adicionar à sacola", "Promoções"…); curto, sem dados do cliente
  alvo text,
  -- domínio de quem mandou o visitante ("instagram.com", "Direto"); só na visita
  origem text,
  criado_em timestamptz not null default now()
);

create index if not exists vitrine_eventos_loja_tempo_idx on vitrine_eventos (restaurante_id, criado_em);
create index if not exists vitrine_eventos_loja_visitante_idx on vitrine_eventos (restaurante_id, visitante_id, criado_em);

alter table vitrine_eventos enable row level security;

drop policy if exists "Tenant members read vitrine_eventos" on vitrine_eventos;
create policy "Tenant members read vitrine_eventos"
  on vitrine_eventos for select
  using (restaurante_id = auth_restaurante_id());

-- ----------------------------------------------------------------------------
-- Horário de cada etapa do pedido
-- ----------------------------------------------------------------------------
alter table pedidos add column if not exists preparando_em timestamptz;
alter table pedidos add column if not exists pronto_em timestamptz;
alter table pedidos add column if not exists em_rota_em timestamptz;
alter table pedidos add column if not exists entregue_em timestamptz;

create or replace function carimbar_etapa_pedido()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    -- Só a PRIMEIRA entrada em cada etapa: voltar o card no kanban e avançar de
    -- novo não pode encurtar o tempo medido.
    if new.status = 'preparando' and new.preparando_em is null then new.preparando_em = now(); end if;
    if new.status = 'pronto' and new.pronto_em is null then new.pronto_em = now(); end if;
    if new.status = 'em_rota' and new.em_rota_em is null then new.em_rota_em = now(); end if;
    if new.status = 'entregue' and new.entregue_em is null then new.entregue_em = now(); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_carimbar_etapa on pedidos;
create trigger pedidos_carimbar_etapa
  before update of status on pedidos
  for each row execute function carimbar_etapa_pedido();

-- ----------------------------------------------------------------------------
-- Agregado do Dashboard
--
-- Tudo contado no banco: a tabela cresce a cada clique e o PostgREST corta em
-- 1000 linhas, então mandar evento cru pro navegador daria número errado.
-- SECURITY INVOKER: a RLS acima já limita à loja de quem chama.
-- ----------------------------------------------------------------------------
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
  origem_visitante as (
    select distinct on (visitante_id) visitante_id, coalesce(origem, 'Direto') as origem
    from janela where tipo = 'visita' order by visitante_id, criado_em
  ),
  origens as (
    select o.origem,
           count(*) as visitas,
           count(*) filter (where exists (
             select 1 from janela j where j.visitante_id = o.visitante_id and j.tipo = 'pedido'
           )) as pedidos
    from origem_visitante o group by o.origem order by 2 desc limit 20
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
