-- 0104 — Campanhas: disparo confiável e métricas (entrega, leitura, clique, conversão em 12h).
--
-- Aditiva, com UMA mudança de dados combinada com o dono (2026-09-27):
--   · Campanhas presas em 'agendada'/'enviando' há mais de 24h do horário agendado viram
--     'cancelada', e os envios pendentes delas viram 'cancelado' — NADA é enviado. Em
--     produção são as 4 da Estância (15/08 e 15/09, 95 pendentes), que um bug do seletor
--     deixava paradas depois do 1º envio. O seletor novo (campanha_reservar_envios) andaria
--     com elas; este passo vem antes para que isso nunca aconteça.
--
--   campanha_envios  + token (link rastreável, aleatório, sem dado do cliente),
--                      chave_destino (telefone normalizado; único por campanha nas linhas
--                      novas), tentativas / próxima tentativa / trava, id do provedor,
--                      entregue_em, lido_em, cliques. Status novos: incerto, cancelado,
--                      expirado.
--   campanhas        + incluir_link (nasce false: campanhas antigas não mudam),
--                      duplicados_bloqueados.
--
--   telefone_chave(text)             DDD + 8 últimos dígitos (com/sem 55, com/sem o 9).
--   campanha_reservar_envios(n)      seletor do cron: expira > 24h, recupera trava vencida
--                                    como 'incerto' (sem reenviar), reserva com skip locked.
--   campanha_concluir_envio(...)     enviado / nova tentativa (transitório, até 3) / erro /
--                                    incerto; conclui a campanha quando a fila acaba.
--   campanha_registrar_status(...)   entregue/lido vindos do webhook; idempotente.
--   campanha_registrar_clique(token) clique no link; devolve o slug para o redirecionamento.
--   campanhas_metricas(de, ate, c)   painel (dono/gerente da própria loja).
--   campanha_destinatarios(c)        detalhe de uma campanha (dono/gerente).
--
-- Conversão (calculada na leitura, nada gravado em pedidos): pedido NÃO cancelado do
-- mesmo telefone (telefone_chave) nas 12h seguintes ao envio. Cada pedido conta para UM
-- envio só — o mais recente antes dele (último toque). Com clique antes do pedido:
-- 'clique' (confirmada); sem clique: 'provavel'.
--
-- Rollback: docs/rollback/0104_campanhas_metricas.down.sql

-- ─── telefone normalizado ─────────────────────────────────────────────────────
create or replace function public.telefone_chave(p text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) in (12, 13) and left(d, 2) = '55' then d := substr(d, 3); end if;
  if length(d) not in (10, 11) then return null; end if;
  return left(d, 2) || right(d, 8);
end $$;

-- ─── colunas novas ────────────────────────────────────────────────────────────
alter table public.campanhas
  add column if not exists incluir_link boolean not null default false,
  add column if not exists duplicados_bloqueados integer not null default 0;

alter table public.campanha_envios
  add column if not exists token text,
  add column if not exists chave_destino text,
  add column if not exists tentativas integer not null default 0,
  add column if not exists proxima_tentativa_em timestamptz,
  add column if not exists travado_ate timestamptz,
  add column if not exists id_externo text,
  add column if not exists entregue_em timestamptz,
  add column if not exists lido_em timestamptz,
  add column if not exists cliques integer not null default 0,
  add column if not exists clicado_em timestamptz,
  add column if not exists ultimo_clique_em timestamptz;

-- Token só nas linhas novas (default); as antigas ficam sem link rastreável.
alter table public.campanha_envios alter column token set default encode(gen_random_bytes(12), 'hex');
create unique index if not exists campanha_envios_token_uidx on public.campanha_envios (token) where token is not null;
create index if not exists campanha_envios_externo_idx on public.campanha_envios (restaurante_id, id_externo) where id_externo is not null;
create index if not exists campanha_envios_enviado_idx on public.campanha_envios (restaurante_id, enviado_em) where enviado_em is not null;

-- Um destino por campanha (linhas novas: o gatilho preenche a chave). As antigas ficam
-- com chave nula — em produção há um par repetido já enviado que não é reescrito.
create or replace function public.campanha_envios_chave_destino()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.chave_destino := coalesce(public.telefone_chave(new.telefone), regexp_replace(new.telefone, '\D', '', 'g'));
  return new;
end $$;
drop trigger if exists campanha_envios_chave_destino on public.campanha_envios;
create trigger campanha_envios_chave_destino before insert on public.campanha_envios
  for each row execute function public.campanha_envios_chave_destino();
create unique index if not exists campanha_envios_destino_uidx
  on public.campanha_envios (campanha_id, chave_destino) where chave_destino is not null;

alter table public.campanha_envios drop constraint if exists campanha_envios_status_check;
alter table public.campanha_envios add constraint campanha_envios_status_check
  check (status in ('pendente', 'reservado', 'enviado', 'erro', 'incerto', 'cancelado', 'expirado'));

-- ─── dados: fila antiga encerrada SEM enviar (autorizado pelo dono) ─────────────
update public.campanha_envios e
   set status = 'cancelado', erro = 'Encerrada sem envio (fila parada há mais de 24h)'
  from public.campanhas c
 where c.id = e.campanha_id
   and c.status in ('agendada', 'enviando')
   and c.agendado_em < now() - interval '24 hours'
   and e.status in ('pendente', 'reservado');

update public.campanhas
   set status = 'cancelada', atualizado_em = now()
 where status in ('agendada', 'enviando')
   and agendado_em < now() - interval '24 hours';

-- ─── seletor do cron ──────────────────────────────────────────────────────────
create or replace function public.campanha_reservar_envios(p_limite integer)
returns table (
  id uuid, campanha_id uuid, restaurante_id uuid, telefone text, nome_cliente text, token text,
  tipo_mensagem text, mensagem text, imagem_url text, audio_url text, incluir_link boolean,
  evolution_instance text, slug text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- Nada sai com mais de 24h de atraso sobre o horário agendado.
  update public.campanha_envios e set status = 'expirado', erro = 'Expirado: mais de 24h após o horário agendado'
    from public.campanhas c
   where c.id = e.campanha_id and e.status = 'pendente' and c.status in ('agendada', 'enviando')
     and c.agendado_em < now() - interval '24 hours';

  -- Trava vencida (o processo caiu no meio): pode ter saído — nunca reenviar sozinho.
  update public.campanha_envios e set status = 'incerto', erro = 'Envio interrompido: pode ter sido entregue'
   where e.status = 'reservado' and e.travado_ate is not null and e.travado_ate < now();

  -- Campanha sem mais nada na fila: concluída.
  update public.campanhas c set status = 'concluida', atualizado_em = now()
   where c.status in ('agendada', 'enviando')
     and c.agendado_em <= now()
     and exists (select 1 from public.campanha_envios x where x.campanha_id = c.id)
     and not exists (select 1 from public.campanha_envios x where x.campanha_id = c.id and x.status in ('pendente', 'reservado'));

  return query
  with alvo as (
    select e.id
      from public.campanha_envios e
      join public.campanhas c on c.id = e.campanha_id
     where e.status = 'pendente'
       and c.status in ('agendada', 'enviando')
       and c.agendado_em is not null
       and c.agendado_em <= now()
       and (e.proxima_tentativa_em is null or e.proxima_tentativa_em <= now())
     order by e.criado_em
     limit greatest(1, least(coalesce(p_limite, 5), 50))
     for update of e skip locked
  ), reservados as (
    update public.campanha_envios e
       set status = 'reservado', travado_ate = now() + interval '5 minutes', tentativas = e.tentativas + 1
      from alvo where e.id = alvo.id
    returning e.*
  ), marcadas as (
    update public.campanhas c set status = 'enviando', atualizado_em = now()
     where c.id in (select r.campanha_id from reservados r) and c.status = 'agendada'
    returning c.id
  )
  select r.id, r.campanha_id, r.restaurante_id, r.telefone, r.nome_cliente, r.token,
         c.tipo_mensagem, c.mensagem, c.imagem_url, c.audio_url, c.incluir_link,
         l.evolution_instance, l.slug
    from reservados r
    join public.campanhas c on c.id = r.campanha_id
    join public.restaurantes l on l.id = r.restaurante_id
   order by r.criado_em;
end $$;

-- p_resultado: 'enviado' | 'transitorio' | 'definitivo' | 'incerto'
create or replace function public.campanha_concluir_envio(p_id uuid, p_resultado text, p_id_externo text, p_erro text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare e public.campanha_envios%rowtype; v_final text;
begin
  select * into e from public.campanha_envios where id = p_id for update;
  if not found or e.status <> 'reservado' then return 'ignorado'; end if;

  if p_resultado = 'enviado' then
    update public.campanha_envios set status = 'enviado', enviado_em = now(), id_externo = left(p_id_externo, 200),
           erro = null, travado_ate = null where id = p_id;
    update public.campanhas set total_enviados = total_enviados + 1, atualizado_em = now() where id = e.campanha_id;
    v_final := 'enviado';
  elsif p_resultado = 'transitorio' and e.tentativas < 3 then
    update public.campanha_envios set status = 'pendente', travado_ate = null, erro = left(p_erro, 300),
           proxima_tentativa_em = now() + (case e.tentativas when 1 then interval '1 minute' else interval '5 minutes' end)
     where id = p_id;
    v_final := 'nova_tentativa';
  elsif p_resultado = 'incerto' then
    update public.campanha_envios set status = 'incerto', travado_ate = null, erro = left(p_erro, 300) where id = p_id;
    v_final := 'incerto';
  else
    update public.campanha_envios set status = 'erro', travado_ate = null, erro = left(p_erro, 300) where id = p_id;
    update public.campanhas set total_erros = total_erros + 1, atualizado_em = now() where id = e.campanha_id;
    v_final := 'erro';
  end if;

  update public.campanhas c set status = 'concluida', atualizado_em = now()
   where c.id = e.campanha_id and c.status in ('agendada', 'enviando')
     and not exists (select 1 from public.campanha_envios x where x.campanha_id = c.id and x.status in ('pendente', 'reservado'));
  return v_final;
end $$;

-- p_status: 'entregue' | 'lido'. Retorna 'ok' | 'repetido' | 'desconhecido'.
create or replace function public.campanha_registrar_status(p_restaurante uuid, p_id_externo text, p_status text, p_em timestamptz default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare e public.campanha_envios%rowtype; v_em timestamptz := coalesce(p_em, now());
begin
  if p_id_externo is null or p_status not in ('entregue', 'lido') then return 'desconhecido'; end if;
  select * into e from public.campanha_envios
   where restaurante_id = p_restaurante and id_externo = p_id_externo
   order by criado_em desc limit 1 for update;
  if not found then return 'desconhecido'; end if;

  if (p_status = 'entregue' and e.entregue_em is not null) or (p_status = 'lido' and e.lido_em is not null) then
    update public.campanhas set duplicados_bloqueados = duplicados_bloqueados + 1 where id = e.campanha_id;
    return 'repetido';
  end if;
  update public.campanha_envios
     set entregue_em = coalesce(entregue_em, v_em),
         lido_em = case when p_status = 'lido' then coalesce(lido_em, v_em) else lido_em end
   where id = e.id;
  return 'ok';
end $$;

-- Clique no link. Repetido em menos de 10s (duplo toque, pré-carregamento): não conta.
create or replace function public.campanha_registrar_clique(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare e public.campanha_envios%rowtype; v_slug text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{24}$' then return null; end if;
  select * into e from public.campanha_envios where token = p_token for update;
  if not found then return null; end if;
  select slug into v_slug from public.restaurantes where id = e.restaurante_id;
  if e.status <> 'enviado' then return v_slug; end if;
  if e.ultimo_clique_em is not null and e.ultimo_clique_em > now() - interval '10 seconds' then
    update public.campanhas set duplicados_bloqueados = duplicados_bloqueados + 1 where id = e.campanha_id;
    return v_slug;
  end if;
  update public.campanha_envios
     set cliques = cliques + 1, clicado_em = coalesce(clicado_em, now()), ultimo_clique_em = now()
   where id = e.id;
  return v_slug;
end $$;

-- ─── atribuição (interna) ─────────────────────────────────────────────────────
-- Cada pedido não cancelado da loja vai para o envio mais recente do mesmo telefone
-- feito até 12h antes dele.
create or replace function public.campanha_atribuicoes(p_restaurante uuid, p_de timestamptz, p_ate timestamptz)
returns table (envio_id uuid, pedido_id uuid, numero integer, total numeric, criado_em timestamptz, via_clique boolean)
language sql
stable
security definer
set search_path = public
as $$
  with env as (
    select e.id, e.enviado_em, e.clicado_em, public.telefone_chave(e.telefone) k
      from public.campanha_envios e
     where e.restaurante_id = p_restaurante and e.status = 'enviado' and e.enviado_em is not null
       and e.enviado_em >= p_de - interval '12 hours' and e.enviado_em <= p_ate
  ), ped as (
    select p.id, p.numero, p.total, p.criado_em, public.telefone_chave(p.cliente_telefone) k
      from public.pedidos p
     where p.restaurante_id = p_restaurante and p.status <> 'cancelado'
       and p.criado_em >= p_de and p.criado_em <= p_ate + interval '12 hours'
  )
  select distinct on (ped.id) env.id, ped.id, ped.numero, ped.total, ped.criado_em,
         (env.clicado_em is not null and env.clicado_em <= ped.criado_em)
    from ped
    join env on env.k = ped.k and ped.k is not null
            and ped.criado_em >= env.enviado_em and ped.criado_em < env.enviado_em + interval '12 hours'
   order by ped.id, env.enviado_em desc
$$;

-- ─── métricas do painel ───────────────────────────────────────────────────────
create or replace function public.campanhas_metricas(p_de timestamptz, p_ate timestamptz, p_campanha uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_loja uuid := public.auth_restaurante_id(); v_res jsonb;
begin
  if v_loja is null or not public.auth_e_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'período inválido' using errcode = '22023'; end if;

  with camp as (
    select c.* from public.campanhas c
     where c.restaurante_id = v_loja
       and (p_campanha is null or c.id = p_campanha)
       and coalesce(c.agendado_em, c.criado_em) between p_de and p_ate
  ), env as (
    select e.* from public.campanha_envios e join camp on camp.id = e.campanha_id
  ), atr as (
    select a.* from public.campanha_atribuicoes(v_loja, p_de, p_ate + interval '12 hours') a
     where a.envio_id in (select id from env)
  ), resp as (
    select e.id envio_id
      from env e
     where e.status = 'enviado' and exists (
       select 1 from public.whatsapp_conversas cv
         join public.whatsapp_mensagens m on m.conversa_id = cv.id and m.direcao = 'entrada'
        where cv.restaurante_id = v_loja
          and public.telefone_chave(cv.telefone) = public.telefone_chave(e.telefone)
          and m.criado_em > e.enviado_em and m.criado_em < e.enviado_em + interval '12 hours')
  ), por as (
    select camp.id, camp.nome, camp.status, camp.tipo_mensagem, camp.incluir_link,
           coalesce(camp.agendado_em, camp.criado_em) quando, camp.duplicados_bloqueados,
           (select count(*) from env where env.campanha_id = camp.id) destinatarios,
           (select count(*) from env where env.campanha_id = camp.id and env.status = 'enviado') enviadas,
           (select count(*) from env where env.campanha_id = camp.id and (env.entregue_em is not null or env.lido_em is not null)) entregues,
           (select count(*) from env where env.campanha_id = camp.id and env.lido_em is not null) lidas,
           (select count(*) from resp join env on env.id = resp.envio_id where env.campanha_id = camp.id) respondidas,
           (select count(*) from env where env.campanha_id = camp.id and env.clicado_em is not null) clicaram,
           (select coalesce(sum(env.cliques), 0) from env where env.campanha_id = camp.id) cliques,
           (select count(*) from atr join env on env.id = atr.envio_id where env.campanha_id = camp.id) pedidos,
           (select count(*) from atr join env on env.id = atr.envio_id where env.campanha_id = camp.id and atr.via_clique) pedidos_clique,
           (select count(distinct atr.envio_id) from atr join env on env.id = atr.envio_id where env.campanha_id = camp.id) convertidos,
           (select coalesce(sum(atr.total), 0) from atr join env on env.id = atr.envio_id where env.campanha_id = camp.id) faturamento,
           (select count(*) from env where env.campanha_id = camp.id and env.status = 'erro') falhas,
           (select count(*) from env where env.campanha_id = camp.id and env.status = 'incerto') incertos,
           (select count(*) from env where env.campanha_id = camp.id and env.status in ('expirado', 'cancelado')) nao_enviadas,
           (select count(*) from env where env.campanha_id = camp.id and env.status in ('pendente', 'reservado')) na_fila,
           (select coalesce(sum(env.tentativas), 0) from env where env.campanha_id = camp.id) tentativas,
           (select coalesce(sum(greatest(env.tentativas - 1, 0)), 0) from env where env.campanha_id = camp.id) retries,
           exists (select 1 from env where env.campanha_id = camp.id and env.id_externo is not null) rastreada
      from camp
  )
  select jsonb_build_object(
    'campanhas', coalesce((select jsonb_agg(to_jsonb(por) order by por.quando desc) from por), '[]'::jsonb),
    'totais', (select jsonb_build_object(
        'campanhas', count(*), 'destinatarios', coalesce(sum(destinatarios), 0), 'enviadas', coalesce(sum(enviadas), 0),
        'entregues', coalesce(sum(entregues), 0), 'lidas', coalesce(sum(lidas), 0), 'respondidas', coalesce(sum(respondidas), 0),
        'clicaram', coalesce(sum(clicaram), 0), 'cliques', coalesce(sum(cliques), 0), 'pedidos', coalesce(sum(pedidos), 0),
        'pedidos_clique', coalesce(sum(pedidos_clique), 0), 'convertidos', coalesce(sum(convertidos), 0),
        'faturamento', coalesce(sum(faturamento), 0), 'falhas', coalesce(sum(falhas), 0), 'incertos', coalesce(sum(incertos), 0),
        'nao_enviadas', coalesce(sum(nao_enviadas), 0), 'na_fila', coalesce(sum(na_fila), 0), 'tentativas', coalesce(sum(tentativas), 0),
        'retries', coalesce(sum(retries), 0), 'duplicados_bloqueados', coalesce(sum(duplicados_bloqueados), 0),
        'rastreadas', count(*) filter (where rastreada)) from por)
  ) into v_res;
  return v_res;
end $$;

-- Destinatários de uma campanha, com o que aconteceu com cada um. Telefone mascarado.
create or replace function public.campanha_destinatarios(p_campanha uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_loja uuid := public.auth_restaurante_id(); v_c public.campanhas%rowtype;
begin
  if v_loja is null or not public.auth_e_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select * into v_c from public.campanhas where id = p_campanha and restaurante_id = v_loja;
  if not found then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'nome', e.nome_cliente,
      'telefone', case when length(regexp_replace(e.telefone, '\D', '', 'g')) >= 8
                       then '•••• ' || right(regexp_replace(e.telefone, '\D', '', 'g'), 4) else '••••' end,
      'status', e.status, 'erro', e.erro, 'tentativas', e.tentativas,
      'enviado_em', e.enviado_em, 'entregue_em', coalesce(e.entregue_em, e.lido_em), 'lido_em', e.lido_em,
      'clicado_em', e.clicado_em, 'cliques', e.cliques,
      'pedido', (select jsonb_build_object('numero', a.numero, 'total', a.total, 'criado_em', a.criado_em, 'via_clique', a.via_clique)
                   from public.campanha_atribuicoes(v_loja, coalesce(e.enviado_em, now()), coalesce(e.enviado_em, now()) + interval '12 hours') a
                  where a.envio_id = e.id order by a.criado_em limit 1),
      'respondeu', (e.enviado_em is not null and exists (
         select 1 from public.whatsapp_conversas cv join public.whatsapp_mensagens m on m.conversa_id = cv.id and m.direcao = 'entrada'
          where cv.restaurante_id = v_loja and public.telefone_chave(cv.telefone) = public.telefone_chave(e.telefone)
            and m.criado_em > e.enviado_em and m.criado_em < e.enviado_em + interval '12 hours'))
    ) order by e.enviado_em desc nulls last, e.criado_em)
    from public.campanha_envios e where e.campanha_id = p_campanha
  ), '[]'::jsonb);
end $$;

-- ─── permissões ───────────────────────────────────────────────────────────────
revoke execute on function public.campanha_reservar_envios(integer) from public, anon, authenticated;
revoke execute on function public.campanha_concluir_envio(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.campanha_registrar_status(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.campanha_registrar_clique(text) from public, anon, authenticated;
revoke execute on function public.campanha_atribuicoes(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.campanhas_metricas(timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.campanha_destinatarios(uuid) from public, anon;
revoke execute on function public.campanha_envios_chave_destino() from public, anon, authenticated;
grant execute on function public.campanha_reservar_envios(integer) to service_role;
grant execute on function public.campanha_concluir_envio(uuid, text, text, text) to service_role;
grant execute on function public.campanha_registrar_status(uuid, text, text, timestamptz) to service_role;
grant execute on function public.campanha_registrar_clique(text) to service_role;
grant execute on function public.campanha_atribuicoes(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.campanhas_metricas(timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.campanha_destinatarios(uuid) to authenticated, service_role;
grant execute on function public.telefone_chave(text) to authenticated, service_role;

-- O painel lê campanha_envios pela policy de 0066 (dono/gerente); as colunas novas
-- (token) só são úteis a quem já vê a linha. Escrita do cron/webhook: service_role.
