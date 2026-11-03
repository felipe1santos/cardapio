-- 0245 — Disparos recorrentes de WhatsApp (03/11/2026).
-- Desenho: docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md
-- Plano:   docs/superpowers/plans/2026-11-03-disparos-recorrentes.md
--
-- 1. campanha_recorrentes: os 3 cards por loja (Recuperação, Nunca compraram, Promoções) — programação, galeria de
--    até 5 imagens em rodízio, toggle, "pular hoje". Nascem DESLIGADOS. `proximo_disparo_em` é materializado por trigger:
--    o cron só lê "vencidos" por índice parcial, nunca recalcula agenda a cada tique.
-- 2. campanhas.recorrente_id: uma rodada de card é uma linha comum de `campanhas` (entra na fila e nas métricas de sempre).
-- 3. Frequência por cliente: 3 → 2 dias (pedido do dono). O Super Admin segue podendo mudar.
-- 4. (Tarefas 2–4 do plano acrescentam abaixo: público em SQL, geração de rodadas, reserva com 60–150 s.)
--
-- Aditiva. Nenhuma mensagem sai por causa dela. Rollback: docs/rollback/0245_disparos_recorrentes.down.sql

-- ── Tabela dos cards ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.campanha_recorrentes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  tipo text not null check (tipo in ('recuperacao', 'nunca_compraram', 'promocoes')),
  ativa boolean not null default false,
  mensagem text not null default '' check (length(mensagem) <= 4096),
  incluir_link boolean not null default true,
  imagens jsonb not null default '[]'::jsonb check (jsonb_typeof(imagens) = 'array' and jsonb_array_length(imagens) <= 5),
  imagem_indice integer not null default 0 check (imagem_indice >= 0),
  dias_semana smallint[] not null default '{0,1,2,3,4,5,6}',
  hora time not null default time '17:00',
  janela_fim time not null default time '19:00',
  pular_ate date,
  proximo_disparo_em timestamptz,
  ultima_rodada_em timestamptz,
  ultima_campanha_id uuid,
  ultima_rodada_motivo text check (ultima_rodada_motivo is null or ultima_rodada_motivo in ('ok', 'sem_publico', 'pulado')),
  desligado_motivo text check (desligado_motivo is null or length(desligado_motivo) <= 40),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (restaurante_id, tipo)
);
comment on table public.campanha_recorrentes is 'Cards de disparo recorrente (0245): 3 por loja, sempre ligados quando ativa. proximo_disparo_em vem da trigger.';
create index if not exists campanha_recorrentes_vencidos on public.campanha_recorrentes (proximo_disparo_em) where ativa;

alter table public.campanha_recorrentes enable row level security;
drop policy if exists "Gestores gerenciam cards recorrentes" on public.campanha_recorrentes;
create policy "Gestores gerenciam cards recorrentes" on public.campanha_recorrentes
  for all to authenticated
  using (restaurante_id = (select public.auth_restaurante_id()) and (select public.auth_e_gestor()))
  with check (restaurante_id = (select public.auth_restaurante_id()) and (select public.auth_e_gestor()));
-- Sem delete: os 3 cards são fixos (liga/desliga, nunca apaga).
grant select, insert, update on public.campanha_recorrentes to authenticated;

-- ── Rodada de card é uma campanha comum ──────────────────────────────────────────────────────────────────────────
alter table public.campanhas add column if not exists recorrente_id uuid references public.campanha_recorrentes(id) on delete set null;
create index if not exists campanhas_recorrente_idx on public.campanhas (recorrente_id) where recorrente_id is not null;

-- ── Frequência por cliente: 2 dias ───────────────────────────────────────────────────────────────────────────────
update public.plataforma_config set valor = '2'::jsonb, atualizado_em = now(), atualizado_por = 'migração 0245'
 where chave = 'disparo_frequencia_dias' and valor = '3'::jsonb;

-- ── Agenda: próximo instante (Brasília) em que o card dispara ────────────────────────────────────────────────────
-- p_dias vazio = todos os dias. Devolve o primeiro instante >= p_a_partir cujo dia da semana está em p_dias, às p_hora.
create or replace function public.campanha_recorrente_proximo(p_dias smallint[], p_hora time, p_a_partir timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_local timestamp := p_a_partir at time zone 'America/Sao_Paulo';
  v_dia date := v_local::date;
  v_cand timestamp;
  i integer;
begin
  if p_hora is null then return null; end if;
  for i in 0..7 loop
    v_cand := (v_dia + i) + p_hora;
    if v_cand >= v_local and (p_dias is null or cardinality(p_dias) = 0 or extract(dow from (v_dia + i))::smallint = any (p_dias)) then
      return v_cand at time zone 'America/Sao_Paulo';
    end if;
  end loop;
  return null;
end $$;

create or replace function public.campanha_recorrentes_agenda_fn()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_base timestamptz := now();
begin
  new.atualizado_em := now();
  if not new.ativa then
    new.proximo_disparo_em := null;
    return new;
  end if;
  -- "Pular hoje": a agenda recomeça amanhã 00:00 (Brasília).
  if new.pular_ate is not null and new.pular_ate >= v_hoje then
    v_base := greatest(v_base, ((new.pular_ate + 1)::timestamp) at time zone 'America/Sao_Paulo');
  end if;
  new.proximo_disparo_em := public.campanha_recorrente_proximo(new.dias_semana, new.hora, v_base);
  if new.desligado_motivo is not null and (tg_op = 'INSERT' or old.ativa = false) then new.desligado_motivo := null; end if;
  return new;
end $$;

-- Puras e sem efeito fora da linha: a trigger dispara em updates do painel (authenticated) e do cron (service_role).
revoke all on function public.campanha_recorrente_proximo(smallint[], time, timestamptz) from public, anon;
grant execute on function public.campanha_recorrente_proximo(smallint[], time, timestamptz) to authenticated, service_role;
revoke all on function public.campanha_recorrentes_agenda_fn() from public, anon;
grant execute on function public.campanha_recorrentes_agenda_fn() to authenticated, service_role;

drop trigger if exists campanha_recorrentes_agenda on public.campanha_recorrentes;
create trigger campanha_recorrentes_agenda before insert or update of ativa, dias_semana, hora, pular_ate
  on public.campanha_recorrentes for each row execute function public.campanha_recorrentes_agenda_fn();

-- ── Público de cada card (Tarefa 2) ──────────────────────────────────────────────────────────────────────────────
-- Base (regra geral do dono): só quem já MANDOU mensagem para a loja (whatsapp_mensagens.direcao = 'entrada'), nunca quem
-- pediu SAIR, e nunca quem já entrou em alguma rodada da loja hoje (prioridade entre cards: decisão 1 do plano).
-- Um telefone por telefone_chave (com/sem 55, com/sem o 9): fica a conversa mais recente.
--   recuperacao     = tem pedido não cancelado e o último foi há 30 dias ou mais (mesmo corte da visão geral).
--   nunca_compraram = nenhum pedido não cancelado.
--   promocoes       = a base inteira.
-- ultimo_disparo_em (nulo = nunca recebeu) deixa a rodada priorizar quem ainda não foi alcançado (decisão 3).
create or replace function public.campanha_recorrente_publico(p_restaurante uuid, p_tipo text)
returns table (telefone text, nome_cliente text, ultimo_item text, ultimo_disparo_em timestamptz)
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
       and exists (select 1 from public.whatsapp_mensagens m where m.conversa_id = c.id and m.direcao = 'entrada')
       and not exists (select 1 from public.whatsapp_descadastros d
                        where d.restaurante_id = p_restaurante and d.telefone_chave = public.telefone_chave(c.telefone))
       and not exists (select 1 from public.campanha_envios e, hoje
                        where e.restaurante_id = p_restaurante and e.criado_em >= hoje.inicio
                          and public.telefone_chave(e.telefone) = public.telefone_chave(c.telefone))
     order by public.telefone_chave(c.telefone), c.ultima_atividade_em desc nulls last, length(c.telefone) desc, c.criado_em desc
  ), ped as (
    select public.telefone_chave(p.cliente_telefone) as k, max(p.criado_em) as ultimo_em,
           (array_agg(p.id order by p.criado_em desc))[1] as ultimo_id
      from public.pedidos p
     where p.restaurante_id = p_restaurante and p.status <> 'cancelado' and public.telefone_chave(p.cliente_telefone) is not null
     group by 1
  )
  select b.telefone,
         coalesce((select cl.nome from public.clientes cl
                    where cl.restaurante_id = p_restaurante and public.telefone_chave(cl.telefone) = b.k and nullif(btrim(cl.nome), '') is not null
                    order by cl.criado_em limit 1), b.nome_contato, '') as nome_cliente,
         case when p_tipo = 'recuperacao'
              then (select i.nome from public.pedido_itens i where i.pedido_id = ped.ultimo_id order by i.id limit 1) end as ultimo_item,
         (select max(e.enviado_em) from public.campanha_envios e
           where e.restaurante_id = p_restaurante and e.status in ('enviado', 'incerto')
             and public.telefone_chave(e.telefone) = b.k) as ultimo_disparo_em
    from base b
    left join ped on ped.k = b.k
   where case p_tipo
           when 'recuperacao' then ped.ultimo_em is not null and ped.ultimo_em <= now() - interval '30 days'
           when 'nunca_compraram' then ped.k is null
           when 'promocoes' then true
           else false
         end
$$;
revoke execute on function public.campanha_recorrente_publico(uuid, text) from public, anon, authenticated;
grant execute on function public.campanha_recorrente_publico(uuid, text) to service_role;

-- Quantas pessoas o card pegaria agora (tela). Pela sessão: só gestor da própria loja.
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
  return (select count(*)::int from public.campanha_recorrente_publico(v_loja, p_tipo));
end $$;
revoke execute on function public.campanha_recorrente_estimativa(text) from public, anon;
grant execute on function public.campanha_recorrente_estimativa(text) to authenticated;

-- ── Rodadas (Tarefa 3): card vencido vira UMA campanha comum + fila ─────────────────────────────────────────────
-- Chamada pelo cron de campanhas no máximo a cada 10 min. Zero cards vencidos = uma leitura do índice parcial e nada mais.
-- Trava contra rodada dupla: a agenda (proximo_disparo_em) avança na MESMA transação, antes de criar a campanha, e a
-- leitura é `for update skip locked` — outra chamada simultânea não encontra o card vencido.
-- Casos cobertos pelo e2e (scripts/seguranca/e2e-campanhas-metricas.mjs, seção recorrentes):
--   · duas chamadas seguidas → 1 rodada;  · 0 imagens → tipo texto e índice parado;  · descadastro sem 55 × conversa com 55 → fora.
create or replace function public.campanha_recorrentes_gerar_rodadas()
returns table (recorrente_id uuid, campanha_id uuid, destinatarios integer, motivo text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_campanha uuid;
  v_n integer;
  v_n_img integer;
  v_imagem text;
  v_limite integer;
  v_rotulo text;
begin
  for v in
    select r.id, r.restaurante_id, r.tipo, r.mensagem, r.incluir_link, r.imagens, r.imagem_indice, r.hora, r.janela_fim, r.pular_ate,
           l.disparo_limite_dia,
           case r.tipo when 'recuperacao' then 0 when 'nunca_compraram' then 1 else 2 end as prioridade
      from public.campanha_recorrentes r
      join public.restaurantes l on l.id = r.restaurante_id
      join public.loja_modulos m on m.restaurante_id = r.restaurante_id and m.modulo = 'disparos' and m.liberado
     where r.ativa and r.proximo_disparo_em <= now()
     order by r.restaurante_id, case r.tipo when 'recuperacao' then 0 when 'nunca_compraram' then 1 else 2 end
     for update of r skip locked
  loop
    -- 1. Trava: a agenda avança antes de qualquer outra coisa.
    update public.campanha_recorrentes
       set proximo_disparo_em = public.campanha_recorrente_proximo(dias_semana, hora, now() + interval '1 minute')
     where id = v.id;

    -- 2. "Pular hoje" (defesa: a trigger já empurra a agenda para amanhã ao marcar).
    if v.pular_ate is not null and v.pular_ate = v_hoje then
      update public.campanha_recorrentes set ultima_rodada_motivo = 'pulado' where id = v.id;
      recorrente_id := v.id; campanha_id := null; destinatarios := 0; motivo := 'pulado';
      return next;
      continue;
    end if;

    -- 3. Imagem da vez (rodízio) e quanto cabe na janela com 60–150 s por mensagem (média 105 s).
    v_n_img := jsonb_array_length(v.imagens);
    v_imagem := case when v_n_img > 0 then v.imagens ->> (v.imagem_indice % v_n_img) else null end;
    v_limite := greatest(1, least(v.disparo_limite_dia, floor(extract(epoch from (v.janela_fim - v.hora)) / 105)::int));
    v_rotulo := case v.tipo when 'recuperacao' then 'Recuperação de clientes' when 'nunca_compraram' then 'Quem nunca comprou' else 'Promoções' end;

    -- 4. A rodada é uma campanha comum: entra na fila (reserva, teto, freio, pausa) e nas métricas de sempre.
    --    agendado_em escalonado por prioridade: a reserva ordena por agendado_em (Recuperação antes de Promoções).
    insert into public.campanhas (restaurante_id, nome, status, tipo_mensagem, mensagem, imagem_url, filtro, agendado_em,
                                  janela_inicio, janela_fim, incluir_link, incluir_descadastro, recorrente_id)
    values (v.restaurante_id, v_rotulo || ' · ' || to_char(v_hoje, 'DD/MM'), 'agendada',
            case when v_imagem is not null then 'imagem' else 'texto' end, v.mensagem, v_imagem,
            jsonb_build_object('tipo', 'recorrente'), now() + make_interval(secs => v.prioridade),
            v.hora, v.janela_fim, v.incluir_link, true, v.id)
    returning id into v_campanha;

    -- 5. Público: quem nunca recebeu primeiro, depois quem recebeu há mais tempo; só o que cabe na janela.
    insert into public.campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente, ultimo_item)
    select v_campanha, v.restaurante_id, p.telefone, coalesce(p.nome_cliente, ''), left(p.ultimo_item, 120)
      from public.campanha_recorrente_publico(v.restaurante_id, v.tipo) p
     order by p.ultimo_disparo_em nulls first, random()
     limit v_limite;
    get diagnostics v_n = row_count;

    -- 6. Sem público: não fica campanha vazia para trás.
    if v_n = 0 then
      delete from public.campanhas where id = v_campanha;
      update public.campanha_recorrentes
         set ultima_rodada_em = now(), ultima_rodada_motivo = 'sem_publico', ultima_campanha_id = null
       where id = v.id;
      recorrente_id := v.id; campanha_id := null; destinatarios := 0; motivo := 'sem_publico';
      return next;
      continue;
    end if;

    -- 7. Rodada criada: totais e rodízio da imagem.
    update public.campanhas set total_destinatarios = v_n, atualizado_em = now() where id = v_campanha;
    update public.campanha_recorrentes
       set ultima_rodada_em = now(), ultima_campanha_id = v_campanha, ultima_rodada_motivo = 'ok',
           imagem_indice = case when v_n_img > 0 then (imagem_indice + 1) % v_n_img else imagem_indice end
     where id = v.id;
    recorrente_id := v.id; campanha_id := v_campanha; destinatarios := v_n; motivo := 'ok';
    return next;
  end loop;
end $$;
revoke execute on function public.campanha_recorrentes_gerar_rodadas() from public, anon, authenticated;
grant execute on function public.campanha_recorrentes_gerar_rodadas() to service_role;

-- ── Reserva da fila (Tarefa 4): cópia da 0190 com duas mudanças ──────────────────────────────────────────────────
--   (a) próxima mensagem da LOJA em 60–150 s aleatórios (era 25–90 s) — pedido do dono, anti-bloqueio;
--   (b) rodada de card (recorrente_id) expira no fim da janela do próprio dia: amanhã nasce outra, com a próxima imagem.
--       Agendamentos continuam expirando 7 dias depois do horário marcado.
-- O resto (janela 09:00–21:30, teto diário, 1 por loja por chamada, frequência por cliente, trava de 5 min) é igual.
drop function if exists public.campanha_reservar_envios(integer);
create function public.campanha_reservar_envios(p_limite integer)
returns table (
  id uuid, campanha_id uuid, restaurante_id uuid, telefone text, nome_cliente text, token text,
  tipo_mensagem text, mensagem text, imagem_url text, audio_url text, incluir_link boolean,
  evolution_instance text, slug text, incluir_descadastro boolean, ultimo_item text, nome_loja text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
  v_hoje_inicio timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_teto integer := public.plataforma_int('disparo_teto_dia', 150);
  v_freq integer := greatest(public.plataforma_int('disparo_frequencia_dias', 2), 0);
  v_loja record;
  v_envio uuid;
  v_ids uuid[] := '{}';
begin
  update public.campanha_envios e set status = 'expirado', erro = 'Expirado: mais de 7 dias após o horário agendado'
    from public.campanhas c
   where c.id = e.campanha_id and e.status = 'pendente' and c.status in ('agendada', 'enviando', 'pausada')
     and c.recorrente_id is null
     and c.agendado_em < now() - interval '7 days';

  -- Rodada de card: o que não saiu até o fim da janela do dia expira (0245).
  update public.campanha_envios e set status = 'expirado', erro = 'Rodada do dia encerrada'
    from public.campanhas c
   where c.id = e.campanha_id and e.status = 'pendente' and c.status in ('agendada', 'enviando', 'pausada')
     and c.recorrente_id is not null
     and v_agora_sp > ((c.agendado_em at time zone 'America/Sao_Paulo')::date + coalesce(c.janela_fim, time '21:30'));

  update public.campanha_envios e set status = 'cancelado', erro = 'Cliente pediu para não receber (SAIR)'
   where e.status = 'pendente'
     and exists (select 1 from public.whatsapp_descadastros d
                  where d.restaurante_id = e.restaurante_id and d.telefone_chave = public.telefone_chave(e.telefone));

  update public.campanha_envios e set status = 'incerto', erro = 'Envio interrompido: pode ter sido entregue'
   where e.status = 'reservado' and e.travado_ate is not null and e.travado_ate < now();

  update public.campanhas c set status = 'concluida', atualizado_em = now(), pausada_em = null, pausa_motivo = null
   where c.status in ('agendada', 'enviando', 'pausada')
     and c.agendado_em <= now()
     and exists (select 1 from public.campanha_envios x where x.campanha_id = c.id)
     and not exists (select 1 from public.campanha_envios x where x.campanha_id = c.id and x.status in ('pendente', 'reservado'));

  -- Nunca fora de 09:00–21:30 (Brasília), qualquer que seja a janela da campanha.
  if v_agora_sp::time < time '09:00' or v_agora_sp::time > time '21:30' then return; end if;

  for v_loja in
    select l.id, least(l.disparo_limite_dia, v_teto) limite
      from public.restaurantes l
     where (l.disparo_proximo_em is null or l.disparo_proximo_em <= now())
       and exists (select 1 from public.campanhas c
                    where c.restaurante_id = l.id and c.status in ('agendada', 'enviando')
                      and c.agendado_em is not null and c.agendado_em <= now()
                      and v_agora_sp::time between coalesce(c.janela_inicio, time '09:00') and coalesce(c.janela_fim, time '21:30'))
     limit greatest(1, least(coalesce(p_limite, 5), 50))
  loop
    -- Limite do dia (o que saiu hoje + o que está saindo agora).
    if (select count(*) from public.campanha_envios x
         where x.restaurante_id = v_loja.id
           and ((x.status in ('enviado', 'incerto') and x.enviado_em >= v_hoje_inicio) or x.status = 'reservado')) >= v_loja.limite then
      continue;
    end if;

    -- Frequência: quem recebeu outro disparo desta loja há menos de N dias fica de fora (não reenvia depois).
    if v_freq > 0 then
      update public.campanha_envios e set status = 'cancelado', erro = format('Recebeu outro disparo há menos de %s dias', v_freq)
        from public.campanhas c
       where c.id = e.campanha_id and e.restaurante_id = v_loja.id and e.status = 'pendente'
         and c.status in ('agendada', 'enviando')
         and exists (select 1 from public.campanha_envios y
                      where y.restaurante_id = v_loja.id and y.campanha_id <> e.campanha_id and y.status in ('enviado', 'incerto')
                        and y.enviado_em > now() - make_interval(days => v_freq)
                        and public.telefone_chave(y.telefone) = public.telefone_chave(e.telefone));
    end if;

    select e.id into v_envio
      from public.campanha_envios e
      join public.campanhas c on c.id = e.campanha_id
     where e.restaurante_id = v_loja.id and e.status = 'pendente'
       and c.status in ('agendada', 'enviando') and c.agendado_em is not null and c.agendado_em <= now()
       and v_agora_sp::time between coalesce(c.janela_inicio, time '09:00') and coalesce(c.janela_fim, time '21:30')
       and (e.proxima_tentativa_em is null or e.proxima_tentativa_em <= now())
     order by c.agendado_em, e.criado_em
     limit 1
     for update of e skip locked;
    if v_envio is null then continue; end if;

    update public.campanha_envios set status = 'reservado', travado_ate = now() + interval '5 minutes', tentativas = tentativas + 1 where id = v_envio;
    update public.campanhas set status = 'enviando', atualizado_em = now()
     where id = (select x.campanha_id from public.campanha_envios x where x.id = v_envio) and status = 'agendada';
    -- Próxima mensagem desta loja: entre 60 e 150 segundos, nunca o mesmo intervalo (0245).
    update public.restaurantes set disparo_proximo_em = now() + make_interval(secs => 60 + floor(random() * 91)::int) where id = v_loja.id;
    v_ids := v_ids || v_envio;
    v_envio := null;
  end loop;

  return query
  select r.id, r.campanha_id, r.restaurante_id, r.telefone, r.nome_cliente, r.token,
         c.tipo_mensagem, c.mensagem, c.imagem_url, c.audio_url, c.incluir_link,
         l.evolution_instance, l.slug, c.incluir_descadastro, r.ultimo_item, l.nome
    from public.campanha_envios r
    join public.campanhas c on c.id = r.campanha_id
    join public.restaurantes l on l.id = r.restaurante_id
   where r.id = any (v_ids)
   order by r.criado_em;
end $$;
revoke execute on function public.campanha_reservar_envios(integer) from public, anon, authenticated;
grant execute on function public.campanha_reservar_envios(integer) to service_role;

-- ── Métricas detalhadas em 72 h (Tarefa 4): mesma janela da visão geral (0129) ───────────────────────────────────
-- Cópia da 0104 trocando só '12 hours' por '72 hours' (atribuição e "respondidas"), para os dois relatórios baterem.
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
       and e.enviado_em >= p_de - interval '72 hours' and e.enviado_em <= p_ate
  ), ped as (
    select p.id, p.numero, p.total, p.criado_em, public.telefone_chave(p.cliente_telefone) k
      from public.pedidos p
     where p.restaurante_id = p_restaurante and p.status <> 'cancelado'
       and p.criado_em >= p_de and p.criado_em <= p_ate + interval '72 hours'
  )
  select distinct on (ped.id) env.id, ped.id, ped.numero, ped.total, ped.criado_em,
         (env.clicado_em is not null and env.clicado_em <= ped.criado_em)
    from ped
    join env on env.k = ped.k and ped.k is not null
            and ped.criado_em >= env.enviado_em and ped.criado_em < env.enviado_em + interval '72 hours'
   order by ped.id, env.enviado_em desc
$$;

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
    select a.* from public.campanha_atribuicoes(v_loja, p_de, p_ate + interval '72 hours') a
     where a.envio_id in (select id from env)
  ), resp as (
    select e.id envio_id
      from env e
     where e.status = 'enviado' and exists (
       select 1 from public.whatsapp_conversas cv
         join public.whatsapp_mensagens m on m.conversa_id = cv.id and m.direcao = 'entrada'
        where cv.restaurante_id = v_loja
          and public.telefone_chave(cv.telefone) = public.telefone_chave(e.telefone)
          and m.criado_em > e.enviado_em and m.criado_em < e.enviado_em + interval '72 hours')
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
                   from public.campanha_atribuicoes(v_loja, coalesce(e.enviado_em, now()), coalesce(e.enviado_em, now()) + interval '72 hours') a
                  where a.envio_id = e.id order by a.criado_em limit 1),
      'respondeu', (e.enviado_em is not null and exists (
         select 1 from public.whatsapp_conversas cv join public.whatsapp_mensagens m on m.conversa_id = cv.id and m.direcao = 'entrada'
          where cv.restaurante_id = v_loja and public.telefone_chave(cv.telefone) = public.telefone_chave(e.telefone)
            and m.criado_em > e.enviado_em and m.criado_em < e.enviado_em + interval '72 hours'))
    ) order by e.enviado_em desc nulls last, e.criado_em)
    from public.campanha_envios e where e.campanha_id = p_campanha
  ), '[]'::jsonb);
end $$;
-- Permissões iguais às da 0104 (create or replace preserva, mas a guarda B7 exige dizer quem executa).
revoke execute on function public.campanha_atribuicoes(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.campanhas_metricas(timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.campanha_destinatarios(uuid) from public, anon;
grant execute on function public.campanha_atribuicoes(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.campanhas_metricas(timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.campanha_destinatarios(uuid) to authenticated, service_role;
