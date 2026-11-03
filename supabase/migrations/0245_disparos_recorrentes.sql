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
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor())
  with check (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());
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
immutable
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
     order by public.telefone_chave(c.telefone), c.ultima_atividade_em desc nulls last, c.criado_em desc
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
