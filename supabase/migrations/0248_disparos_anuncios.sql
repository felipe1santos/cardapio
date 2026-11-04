-- 0248 — Disparos v2: anúncios em Promoções e no Disparo personalizado; copies em rodízio na Recuperação (04/11/2026).
-- · Recuperação: até 5 copies (`mensagens`) em rodízio e até 6 imagens. Lista vazia = usa a `mensagem` antiga (card ligado
--   em produção segue igual).
-- · Promoções e Disparo personalizado (tipo 'nunca_compraram', só o rótulo muda): até 5 anúncios por card, cada um com a
--   sua agenda (dias + horário), copy, imagens (1 na promoção; até 5 em rodízio no personalizado) e, no personalizado,
--   públicos (13 opções, união). Duas promoções no mesmo dia saem no mesmo dia para PESSOAS DIFERENTES (ninguém entra em
--   duas rodadas no dia; 2 dias por pessoa continua valendo).
-- · Base de público: quem já tem conversa com a loja no WhatsApp (inclui quem recebeu avisos de pedido), fora SAIR e fora
--   quem já entrou em rodada hoje. Aquecimento (0247), teto diário, 60–150 s, janela 09:00–21:30: iguais.
-- · Agenda materializada por anúncio (`proximo_disparo_em`, índice parcial); o cron só lê vencidos (regra 12).
-- Aditiva. Rollback: docs/rollback/0248_disparos_anuncios.down.sql

-- ── 1. Recuperação: copies em rodízio, até 6 imagens ─────────────────────────────────────────────────────────────
alter table public.campanha_recorrentes
  add column if not exists mensagens jsonb not null default '[]'::jsonb,
  add column if not exists mensagem_indice integer not null default 0;
alter table public.campanha_recorrentes drop constraint if exists campanha_recorrentes_mensagens_check;
alter table public.campanha_recorrentes add constraint campanha_recorrentes_mensagens_check
  check (jsonb_typeof(mensagens) = 'array' and jsonb_array_length(mensagens) <= 5 and mensagem_indice >= 0);
alter table public.campanha_recorrentes drop constraint if exists campanha_recorrentes_imagens_check;
alter table public.campanha_recorrentes add constraint campanha_recorrentes_imagens_check
  check (jsonb_typeof(imagens) = 'array' and jsonb_array_length(imagens) <= 6);
grant update (mensagens) on public.campanha_recorrentes to authenticated;

-- ── 2. Anúncios ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.campanha_recorrente_anuncios (
  id uuid primary key default gen_random_uuid(),
  recorrente_id uuid not null references public.campanha_recorrentes(id) on delete cascade,
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  ordem smallint not null default 0 check (ordem between 0 and 4),
  nome text not null default '' check (length(nome) <= 60),
  cor text not null default '#2563eb' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  mensagem text not null default '' check (length(mensagem) <= 4096),
  imagens jsonb not null default '[]'::jsonb check (jsonb_typeof(imagens) = 'array' and jsonb_array_length(imagens) <= 5),
  imagem_indice integer not null default 0 check (imagem_indice >= 0),
  dias_semana smallint[] not null default '{0,1,2,3,4,5,6}' check (dias_semana <@ '{0,1,2,3,4,5,6}'::smallint[]),
  hora time not null default time '17:00',
  janela_fim time not null default time '19:00',
  publicos text[] not null default '{}' check (publicos <@ array[
    'compraram_3d', 'compraram_7d', 'sem_compra_3d', 'sem_compra_7d', 'sem_compra_15d', 'sem_compra_30d', 'sem_compra_60d',
    'recorrentes', 'nao_recorrentes', 'novos_30d', 'gastou_100', 'gastou_300', 'todos_clientes']::text[]),
  proximo_disparo_em timestamptz,
  ultima_rodada_em timestamptz,
  ultima_campanha_id uuid,
  ultima_rodada_motivo text check (ultima_rodada_motivo is null or ultima_rodada_motivo in ('ok', 'sem_publico', 'atrasado', 'limite_dia')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (janela_fim > hora)
);
comment on table public.campanha_recorrente_anuncios is 'Anúncios dos cards Promoções e Disparo personalizado (0248): agenda própria, até 5 por card.';
create index if not exists campanha_recorrente_anuncios_vencidos on public.campanha_recorrente_anuncios (proximo_disparo_em) where proximo_disparo_em is not null;
create index if not exists campanha_recorrente_anuncios_card on public.campanha_recorrente_anuncios (recorrente_id, ordem);

alter table public.campanha_recorrente_anuncios enable row level security;
drop policy if exists "Gestores gerenciam anuncios" on public.campanha_recorrente_anuncios;
create policy "Gestores gerenciam anuncios" on public.campanha_recorrente_anuncios
  for all to authenticated
  using (restaurante_id = (select public.auth_restaurante_id()) and (select public.auth_e_gestor()))
  with check (restaurante_id = (select public.auth_restaurante_id()) and (select public.auth_e_gestor()));
-- Agenda e última rodada são do cron (service_role): o painel não grava essas colunas.
grant select, insert, delete on public.campanha_recorrente_anuncios to authenticated;
grant update (ordem, nome, cor, mensagem, imagens, dias_semana, hora, janela_fim, publicos) on public.campanha_recorrente_anuncios to authenticated;

alter table public.campanhas add column if not exists anuncio_id uuid references public.campanha_recorrente_anuncios(id) on delete set null;
create index if not exists campanhas_anuncio_idx on public.campanhas (anuncio_id) where anuncio_id is not null;

-- Trigger do anúncio: dono do card, limite de 5, imagens https, agenda (só com o card ligado).
create or replace function public.campanha_recorrente_anuncios_fn()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_card record;
begin
  select id, restaurante_id, tipo, ativa into v_card from public.campanha_recorrentes where id = new.recorrente_id;
  if v_card.id is null or v_card.tipo not in ('promocoes', 'nunca_compraram') then
    raise exception 'anúncio só existe nos cards Promoções e Disparo personalizado' using errcode = '23514';
  end if;
  new.restaurante_id := v_card.restaurante_id;
  new.atualizado_em := now();
  if tg_op = 'INSERT' and (select count(*) from public.campanha_recorrente_anuncios a where a.recorrente_id = new.recorrente_id) >= 5 then
    raise exception 'até 5 anúncios por card' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.imagens) x where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^https://') then
    raise exception 'imagens: só URLs https' using errcode = '23514';
  end if;
  if v_card.tipo = 'promocoes' and jsonb_array_length(new.imagens) > 1 then
    raise exception 'cada promoção tem 1 imagem' using errcode = '23514';
  end if;
  -- Anúncio incompleto (sem imagem, copy, dia ou público no personalizado) fica SEM agenda: nunca sai pela metade,
  -- mesmo editado com o card ligado.
  new.proximo_disparo_em := case
    when v_card.ativa and cardinality(new.dias_semana) > 0 and jsonb_array_length(new.imagens) > 0 and btrim(new.mensagem) <> ''
         and (v_card.tipo <> 'nunca_compraram' or cardinality(new.publicos) > 0)
    then public.campanha_recorrente_proximo(new.dias_semana, new.hora, now()) else null end;
  return new;
end $$;
revoke all on function public.campanha_recorrente_anuncios_fn() from public, anon;
grant execute on function public.campanha_recorrente_anuncios_fn() to authenticated, service_role;
drop trigger if exists campanha_recorrente_anuncios_trg on public.campanha_recorrente_anuncios;
create trigger campanha_recorrente_anuncios_trg before insert or update of recorrente_id, ordem, nome, cor, mensagem, imagens, dias_semana, hora, janela_fim, publicos, atualizado_em
  on public.campanha_recorrente_anuncios for each row execute function public.campanha_recorrente_anuncios_fn();

-- ── 3. Card: pendências por tipo; ligar/desligar recalcula a agenda dos anúncios ─────────────────────────────────
create or replace function public.campanha_recorrentes_agenda_fn()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  if exists (select 1 from jsonb_array_elements(new.imagens) x
              where jsonb_typeof(x) <> 'object' or jsonb_typeof(x -> 'url') <> 'string' or (x ->> 'url') !~ '^https://'
                 or length(coalesce(x ->> 'mensagem', '')) > 4096) then
    raise exception 'imagens: cada uma precisa de URL https e mensagem de até 4096 caracteres' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.mensagens) x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 4096) then
    raise exception 'copies: texto de até 4096 caracteres' using errcode = '23514';
  end if;
  if new.ativa then
    if new.tipo = 'recuperacao' then
      if jsonb_array_length(new.imagens) = 0 then
        raise exception 'o card precisa de pelo menos 1 imagem para ligar' using errcode = '23514';
      end if;
      if btrim(new.mensagem) = '' and not exists (select 1 from jsonb_array_elements_text(new.mensagens) m where btrim(m) <> '') then
        raise exception 'o card precisa de pelo menos 1 copy para ligar' using errcode = '23514';
      end if;
    elsif tg_op = 'UPDATE' then
      -- Promoções / Personalizado: pelo menos 1 anúncio e todos prontos.
      if not exists (select 1 from public.campanha_recorrente_anuncios a where a.recorrente_id = new.id) then
        raise exception 'crie pelo menos 1 anúncio para ligar o card' using errcode = '23514';
      end if;
      if exists (select 1 from public.campanha_recorrente_anuncios a where a.recorrente_id = new.id
                  and (jsonb_array_length(a.imagens) = 0 or btrim(a.mensagem) = '' or cardinality(a.dias_semana) = 0
                       or (new.tipo = 'nunca_compraram' and cardinality(a.publicos) = 0))) then
        raise exception 'há anúncio incompleto: cada um precisa de imagem, copy, dia%', case when new.tipo = 'nunca_compraram' then ' e público' else '' end using errcode = '23514';
      end if;
    end if;
  end if;
  if not new.ativa or new.tipo <> 'recuperacao' then
    new.proximo_disparo_em := null;   -- Promoções/Personalizado: a agenda é de cada anúncio.
    return new;
  end if;
  new.proximo_disparo_em := public.campanha_recorrente_proximo(new.dias_semana, new.hora, now());
  if new.desligado_motivo is not null and (tg_op = 'INSERT' or old.ativa = false) then new.desligado_motivo := null; end if;
  return new;
end $$;
revoke all on function public.campanha_recorrentes_agenda_fn() from public, anon;
grant execute on function public.campanha_recorrentes_agenda_fn() to authenticated, service_role;

create or replace function public.campanha_recorrentes_anuncios_agenda_fn()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Ligou/desligou o card: os anúncios recalculam a agenda (a trigger do anúncio lê o card já gravado).
  update public.campanha_recorrente_anuncios set atualizado_em = now() where recorrente_id = new.id;
  if new.ativa and new.desligado_motivo is not null and old.ativa = false then
    update public.campanha_recorrentes set desligado_motivo = null where id = new.id;
  end if;
  return null;
end $$;
revoke all on function public.campanha_recorrentes_anuncios_agenda_fn() from public, anon;
grant execute on function public.campanha_recorrentes_anuncios_agenda_fn() to authenticated, service_role;
drop trigger if exists campanha_recorrentes_anuncios_agenda on public.campanha_recorrentes;
create trigger campanha_recorrentes_anuncios_agenda after update of ativa on public.campanha_recorrentes
  for each row when (new.tipo in ('promocoes', 'nunca_compraram') and old.ativa is distinct from new.ativa)
  execute function public.campanha_recorrentes_anuncios_agenda_fn();

-- ── 4. Públicos ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Base comum: conversa com a loja (qualquer troca, inclusive avisos de pedido), fora SAIR, fora quem já entrou em rodada
-- hoje, 1 telefone por telefone_chave. Pedidos agregados por chave para os públicos de compra.
create or replace function public.campanha_publico_base(p_restaurante uuid)
returns table (telefone text, k text, nome_cliente text, ultimo_em timestamptz, primeiro_em timestamptz, n_pedidos integer,
               n_30d integer, total numeric, ultimo_id uuid, ultimo_disparo_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with hoje as (
    select (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo' as inicio
  ), base as (
    select distinct on (public.telefone_chave(c.telefone)) c.telefone, public.telefone_chave(c.telefone) as k, c.nome_contato
      from public.whatsapp_conversas c
     where c.restaurante_id = p_restaurante
       and public.telefone_chave(c.telefone) is not null
       and not exists (select 1 from public.whatsapp_descadastros d
                        where d.restaurante_id = p_restaurante and d.telefone_chave = public.telefone_chave(c.telefone))
       and not exists (select 1 from public.campanha_envios e, hoje
                        where e.restaurante_id = p_restaurante and e.criado_em >= hoje.inicio
                          and e.chave_destino = public.telefone_chave(c.telefone))
     order by public.telefone_chave(c.telefone), c.ultima_atividade_em desc nulls last, length(c.telefone) desc, c.criado_em desc
  ), ped as (
    select public.telefone_chave(p.cliente_telefone) as k, max(p.criado_em) as ultimo_em, min(p.criado_em) as primeiro_em,
           count(*)::int as n_pedidos, count(*) filter (where p.criado_em >= now() - interval '30 days')::int as n_30d,
           sum(p.total) as total, (array_agg(p.id order by p.criado_em desc))[1] as ultimo_id
      from public.pedidos p
     where p.restaurante_id = p_restaurante and p.status <> 'cancelado' and public.telefone_chave(p.cliente_telefone) is not null
     group by 1
  ), nomes as (
    select distinct on (public.telefone_chave(cl.telefone)) public.telefone_chave(cl.telefone) as k, cl.nome
      from public.clientes cl
     where cl.restaurante_id = p_restaurante and nullif(btrim(cl.nome), '') is not null and public.telefone_chave(cl.telefone) is not null
     order by public.telefone_chave(cl.telefone), cl.criado_em
  ), ult as (
    select e.chave_destino as k, max(e.enviado_em) as ultimo
      from public.campanha_envios e
     where e.restaurante_id = p_restaurante and e.status in ('enviado', 'incerto')
     group by 1
  )
  select b.telefone, b.k, coalesce(n.nome, b.nome_contato, ''), ped.ultimo_em, ped.primeiro_em, coalesce(ped.n_pedidos, 0),
         coalesce(ped.n_30d, 0), coalesce(ped.total, 0), ped.ultimo_id, ult.ultimo
    from base b
    left join ped on ped.k = b.k
    left join nomes n on n.k = b.k
    left join ult on ult.k = b.k
$$;
revoke execute on function public.campanha_publico_base(uuid) from public, anon, authenticated;
grant execute on function public.campanha_publico_base(uuid) to service_role;

-- Um público bate com a linha? (13 públicos; a união é feita por quem chama.)
create or replace function public.campanha_publico_bate(p_publico text, p_ultimo timestamptz, p_primeiro timestamptz, p_n integer, p_n30 integer, p_total numeric)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_n > 0 and case p_publico
    when 'compraram_3d' then p_ultimo >= now() - interval '3 days'
    when 'compraram_7d' then p_ultimo >= now() - interval '7 days'
    when 'sem_compra_3d' then p_ultimo < now() - interval '3 days'
    when 'sem_compra_7d' then p_ultimo < now() - interval '7 days'
    when 'sem_compra_15d' then p_ultimo < now() - interval '15 days'
    when 'sem_compra_30d' then p_ultimo < now() - interval '30 days'
    when 'sem_compra_60d' then p_ultimo < now() - interval '60 days'
    when 'recorrentes' then p_n30 >= 2
    when 'nao_recorrentes' then p_n = 1
    when 'novos_30d' then p_primeiro >= now() - interval '30 days'
    when 'gastou_100' then p_total >= 100
    when 'gastou_300' then p_total >= 300
    when 'todos_clientes' then true
    else false end
$$;
revoke execute on function public.campanha_publico_bate(text, timestamptz, timestamptz, integer, integer, numeric) from public, anon;
grant execute on function public.campanha_publico_bate(text, timestamptz, timestamptz, integer, integer, numeric) to authenticated, service_role;

-- Público de cada card/anúncio. recuperacao = sem pedir há 30+ dias; promocoes = toda a base; personalizado = união dos públicos.
create or replace function public.campanha_recorrente_publico(p_restaurante uuid, p_tipo text, p_publicos text[] default null)
returns table (telefone text, nome_cliente text, ultimo_item text, ultimo_disparo_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.telefone, b.nome_cliente,
         case when p_tipo = 'recuperacao' then (select i.nome from public.pedido_itens i where i.pedido_id = b.ultimo_id order by i.id limit 1) end,
         b.ultimo_disparo_em
    from public.campanha_publico_base(p_restaurante) b
   where case p_tipo
           when 'recuperacao' then b.n_pedidos > 0 and b.ultimo_em <= now() - interval '30 days'
           when 'promocoes' then true
           when 'nunca_compraram' then exists (select 1 from unnest(coalesce(p_publicos, '{}')) pp
                                                where public.campanha_publico_bate(pp, b.ultimo_em, b.primeiro_em, b.n_pedidos, b.n_30d, b.total))
           else false
         end
$$;
revoke execute on function public.campanha_recorrente_publico(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.campanha_recorrente_publico(uuid, text, text[]) to service_role;
drop function if exists public.campanha_recorrente_publico(uuid, text);

-- Tela: tamanho de cada um dos 13 públicos, e da união escolhida. Pela sessão, só gestor.
create or replace function public.campanha_publicos_tamanhos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_loja uuid := public.auth_restaurante_id(); v_res jsonb;
begin
  if v_loja is null or not public.auth_e_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select jsonb_object_agg(p.chave, (select count(*) from public.campanha_publico_base(v_loja) b
                                      where public.campanha_publico_bate(p.chave, b.ultimo_em, b.primeiro_em, b.n_pedidos, b.n_30d, b.total)))
    into v_res
    from unnest(array['compraram_3d', 'compraram_7d', 'sem_compra_3d', 'sem_compra_7d', 'sem_compra_15d', 'sem_compra_30d', 'sem_compra_60d',
                      'recorrentes', 'nao_recorrentes', 'novos_30d', 'gastou_100', 'gastou_300', 'todos_clientes']) as p(chave);
  return v_res;
end $$;
revoke execute on function public.campanha_publicos_tamanhos() from public, anon;
grant execute on function public.campanha_publicos_tamanhos() to authenticated;

create or replace function public.campanha_publico_estimativa(p_publicos text[])
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_loja uuid := public.auth_restaurante_id();
begin
  if v_loja is null or not public.auth_e_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return (select count(*)::int from public.campanha_recorrente_publico(v_loja, 'nunca_compraram', p_publicos));
end $$;
revoke execute on function public.campanha_publico_estimativa(text[]) from public, anon;
grant execute on function public.campanha_publico_estimativa(text[]) to authenticated;

-- Estimativa do card (já existia): passa pela função nova.
create or replace function public.campanha_recorrente_estimativa(p_tipo text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_loja uuid := public.auth_restaurante_id();
begin
  if v_loja is null or not public.auth_e_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_tipo not in ('recuperacao', 'nunca_compraram', 'promocoes') then raise exception 'tipo inválido' using errcode = '22023'; end if;
  if p_tipo = 'nunca_compraram' then
    return (select count(*)::int from public.campanha_recorrente_publico(v_loja, 'nunca_compraram',
      (select coalesce(array_agg(distinct x), '{}') from public.campanha_recorrente_anuncios a, unnest(a.publicos) x
        where a.restaurante_id = v_loja and a.recorrente_id = (select id from public.campanha_recorrentes where restaurante_id = v_loja and tipo = 'nunca_compraram'))));
  end if;
  return (select count(*)::int from public.campanha_recorrente_publico(v_loja, p_tipo, null));
end $$;
revoke execute on function public.campanha_recorrente_estimativa(text) from public, anon;
grant execute on function public.campanha_recorrente_estimativa(text) to authenticated;

-- ── 5. Rodada (uma função para card de Recuperação e para anúncio) ───────────────────────────────────────────────
drop function if exists public.campanha_recorrente_criar_rodada(uuid, uuid, uuid, text, text[], text, text, text, time, time, boolean, integer, integer);
-- p_dividir: quantos disparos da loja ainda saem hoje (este incluso). A cota do aquecimento que resta é dividida entre
-- eles, para a 1ª promoção do dia não levar tudo e a 2ª ficar sem ninguém.
create or replace function public.campanha_recorrente_criar_rodada(
  p_restaurante uuid, p_recorrente uuid, p_anuncio uuid, p_tipo text, p_publicos text[], p_rotulo text, p_mensagem text,
  p_imagem text, p_hora time, p_janela_fim time, p_incluir_link boolean, p_prioridade integer, p_limite_loja integer,
  p_dividir integer default 1)
returns table (campanha_id uuid, destinatarios integer, motivo text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_hoje_inicio timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_limite integer;
  v_resta integer;
  v_campanha uuid;
  v_n integer;
begin
  -- Aquecimento do número (0247): o que as rodadas da loja já enfileiraram hoje sai do limite do dia.
  v_resta := public.campanha_recorrente_limite_aquecimento(p_restaurante)
           - (select count(*)::int from public.campanha_envios e join public.campanhas c on c.id = e.campanha_id
               where c.restaurante_id = p_restaurante and c.recorrente_id is not null and c.agendado_em >= v_hoje_inicio);
  if v_resta <= 0 then
    campanha_id := null; destinatarios := 0; motivo := 'limite_dia'; return next; return;
  end if;
  v_resta := ceil(v_resta::numeric / greatest(1, coalesce(p_dividir, 1)))::int;
  v_limite := least(v_resta, greatest(1, least(p_limite_loja, floor(extract(epoch from (p_janela_fim - p_hora)) / 105)::int)));

  insert into public.campanhas (restaurante_id, nome, status, tipo_mensagem, mensagem, imagem_url, filtro, agendado_em,
                                janela_inicio, janela_fim, incluir_link, incluir_descadastro, recorrente_id, anuncio_id)
  values (p_restaurante, p_rotulo || ' · ' || to_char(v_hoje, 'DD/MM'), 'agendada',
          case when p_imagem is not null then 'imagem' else 'texto' end, p_mensagem, p_imagem,
          jsonb_build_object('tipo', 'recorrente'), now() + make_interval(secs => p_prioridade),
          p_hora, p_janela_fim, p_incluir_link, true, p_recorrente, p_anuncio)
  returning id into v_campanha;

  insert into public.campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente, ultimo_item)
  select v_campanha, p_restaurante, p.telefone, coalesce(p.nome_cliente, ''), left(p.ultimo_item, 120)
    from public.campanha_recorrente_publico(p_restaurante, p_tipo, p_publicos) p
   order by p.ultimo_disparo_em nulls first, random()
   limit v_limite;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    delete from public.campanhas where id = v_campanha;
    campanha_id := null; destinatarios := 0; motivo := 'sem_publico'; return next; return;
  end if;
  update public.campanhas set total_destinatarios = v_n, atualizado_em = now() where id = v_campanha;
  campanha_id := v_campanha; destinatarios := v_n; motivo := 'ok'; return next;
end $$;
revoke execute on function public.campanha_recorrente_criar_rodada(uuid, uuid, uuid, text, text[], text, text, text, time, time, boolean, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.campanha_recorrente_criar_rodada(uuid, uuid, uuid, text, text[], text, text, text, time, time, boolean, integer, integer, integer) to service_role;

-- Quantos disparos da loja ainda saem hoje: anúncios completos de cards ligados com agenda hoje + Recuperação ligada
-- com agenda hoje. Só leitura; usa o índice parcial dos vencidos/agendados.
create or replace function public.campanha_recorrente_pendentes_hoje(p_restaurante uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*)::int from public.campanha_recorrente_anuncios a
            join public.campanha_recorrentes c on c.id = a.recorrente_id and c.ativa
           where a.restaurante_id = p_restaurante and a.proximo_disparo_em is not null
             and (a.proximo_disparo_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
             and jsonb_array_length(a.imagens) > 0 and btrim(a.mensagem) <> '')
       + (select count(*)::int from public.campanha_recorrentes c
           where c.restaurante_id = p_restaurante and c.tipo = 'recuperacao' and c.ativa and c.proximo_disparo_em is not null
             and (c.proximo_disparo_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date)
$$;
revoke execute on function public.campanha_recorrente_pendentes_hoje(uuid) from public, anon, authenticated;
grant execute on function public.campanha_recorrente_pendentes_hoje(uuid) to service_role;

create or replace function public.campanha_recorrentes_gerar_rodadas()
returns table (recorrente_id uuid, campanha_id uuid, destinatarios integer, motivo text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v record;
  r record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
  v_n_img integer;
  v_n_msg integer;
  v_imagem text;
  v_msg text;
  v_img_obj jsonb;
  v_dividir integer;
begin
  -- A. Recuperação (agenda no card): imagem da vez + copy da vez (rodízios independentes).
  for v in
    select c.*, l.disparo_limite_dia
      from public.campanha_recorrentes c
      join public.restaurantes l on l.id = c.restaurante_id
      join public.loja_modulos m on m.restaurante_id = c.restaurante_id and m.modulo = 'disparos' and m.liberado
     where c.tipo = 'recuperacao' and c.ativa and c.proximo_disparo_em <= now()
     order by c.restaurante_id
     for update of c skip locked
  loop
    v_dividir := public.campanha_recorrente_pendentes_hoje(v.restaurante_id);   -- antes de avançar a agenda: conta este
    update public.campanha_recorrentes set proximo_disparo_em = public.campanha_recorrente_proximo(dias_semana, hora, now() + interval '1 minute') where id = v.id;
    if (v.proximo_disparo_em at time zone 'America/Sao_Paulo')::date <> v_hoje or v_agora_sp::time > v.janela_fim then
      update public.campanha_recorrentes set ultima_rodada_em = now(), ultima_rodada_motivo = 'atrasado', ultima_campanha_id = null where id = v.id;
      recorrente_id := v.id; campanha_id := null; destinatarios := 0; motivo := 'atrasado'; return next; continue;
    end if;
    v_n_img := jsonb_array_length(v.imagens);
    v_img_obj := case when v_n_img > 0 then v.imagens -> (v.imagem_indice % v_n_img) else null end;
    v_imagem := v_img_obj ->> 'url';
    v_n_msg := (select count(*)::int from jsonb_array_elements_text(v.mensagens) m where btrim(m) <> '');
    v_msg := case
      when v_n_msg > 0 then (select m from jsonb_array_elements_text(v.mensagens) with ordinality t(m, o) where btrim(m) <> '' order by o offset (v.mensagem_indice % v_n_msg) limit 1)
      else coalesce(nullif(v_img_obj ->> 'mensagem', ''), v.mensagem) end;
    select * into r from public.campanha_recorrente_criar_rodada(v.restaurante_id, v.id, null, 'recuperacao', null, 'Recuperação de clientes',
      v_msg, v_imagem, v.hora, v.janela_fim, v.incluir_link, 0, v.disparo_limite_dia, v_dividir);
    update public.campanha_recorrentes
       set ultima_rodada_em = now(), ultima_rodada_motivo = r.motivo, ultima_campanha_id = r.campanha_id,
           imagem_indice = case when r.motivo = 'ok' and v_n_img > 0 then (imagem_indice + 1) % v_n_img else imagem_indice end,
           mensagem_indice = case when r.motivo = 'ok' and v_n_msg > 0 then (mensagem_indice + 1) % v_n_msg else mensagem_indice end
     where id = v.id;
    recorrente_id := v.id; campanha_id := r.campanha_id; destinatarios := r.destinatarios; motivo := r.motivo; return next;
  end loop;

  -- B. Anúncios (Promoções e Disparo personalizado): agenda própria de cada um.
  for v in
    select a.*, c.tipo, c.incluir_link, l.disparo_limite_dia
      from public.campanha_recorrente_anuncios a
      join public.campanha_recorrentes c on c.id = a.recorrente_id and c.ativa
      join public.restaurantes l on l.id = a.restaurante_id
      join public.loja_modulos m on m.restaurante_id = a.restaurante_id and m.modulo = 'disparos' and m.liberado
     where a.proximo_disparo_em <= now()
       and jsonb_array_length(a.imagens) > 0 and btrim(a.mensagem) <> ''
     order by a.restaurante_id, case c.tipo when 'nunca_compraram' then 1 else 2 end, a.ordem
     for update of a skip locked
  loop
    v_dividir := public.campanha_recorrente_pendentes_hoje(v.restaurante_id);   -- antes de avançar a agenda: conta este
    update public.campanha_recorrente_anuncios set proximo_disparo_em = public.campanha_recorrente_proximo(dias_semana, hora, now() + interval '1 minute') where id = v.id;
    if (v.proximo_disparo_em at time zone 'America/Sao_Paulo')::date <> v_hoje or v_agora_sp::time > v.janela_fim then
      update public.campanha_recorrente_anuncios set ultima_rodada_em = now(), ultima_rodada_motivo = 'atrasado', ultima_campanha_id = null where id = v.id;
      recorrente_id := v.recorrente_id; campanha_id := null; destinatarios := 0; motivo := 'atrasado'; return next; continue;
    end if;
    v_n_img := jsonb_array_length(v.imagens);
    v_imagem := case when v_n_img > 0 then v.imagens ->> (v.imagem_indice % v_n_img) else null end;
    select * into r from public.campanha_recorrente_criar_rodada(v.restaurante_id, v.recorrente_id, v.id, v.tipo,
      case when v.tipo = 'nunca_compraram' then v.publicos else null end,
      case when v.tipo = 'promocoes' then 'Promoção' else 'Disparo personalizado' end || case when btrim(v.nome) <> '' then ' — ' || v.nome else '' end,
      v.mensagem, v_imagem, v.hora, v.janela_fim, v.incluir_link, case when v.tipo = 'nunca_compraram' then 1 else 2 end, v.disparo_limite_dia, v_dividir);
    update public.campanha_recorrente_anuncios
       set ultima_rodada_em = now(), ultima_rodada_motivo = r.motivo, ultima_campanha_id = r.campanha_id,
           imagem_indice = case when r.motivo = 'ok' and v_n_img > 0 then (imagem_indice + 1) % v_n_img else imagem_indice end
     where id = v.id;
    recorrente_id := v.recorrente_id; campanha_id := r.campanha_id; destinatarios := r.destinatarios; motivo := r.motivo; return next;
  end loop;
end $$;
revoke execute on function public.campanha_recorrentes_gerar_rodadas() from public, anon, authenticated;
grant execute on function public.campanha_recorrentes_gerar_rodadas() to service_role;
