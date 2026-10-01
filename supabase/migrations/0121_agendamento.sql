-- 0121 — Agendamento de pedidos (Fase 7, 2026-09-30).
--
-- Desligado por padrão em todas as lojas. Pedido agendado nasce 'recebido' com
-- pedidos.agendado_para preenchido e fica FORA do fluxo (Kanban, cozinha e fila de
-- impressão) até `agendamento_libera_min` minutos antes do horário — aí entra sozinho,
-- sem job: cada tela/consulta compara com o relógio. Status novo não foi criado de
-- propósito (todo o fluxo e os gatilhos de transição continuam valendo).
--
-- Impressão: só a LÓGICA DE DISPARO muda (quando o pedido entra na fila); o recibo não.
-- Aditiva. Rollback: docs/rollback/0121_agendamento.down.sql
alter table public.restaurantes
  add column if not exists agendamento_ativo boolean not null default false,
  add column if not exists agendamento_quando text not null default 'fechada',
  add column if not exists agendamento_dias smallint not null default 7,
  add column if not exists agendamento_antecedencia_min smallint not null default 60,
  add column if not exists agendamento_intervalo_min smallint not null default 30,
  add column if not exists agendamento_limite smallint,
  add column if not exists agendamento_entrega boolean not null default true,
  add column if not exists agendamento_retirada boolean not null default true,
  add column if not exists agendamento_libera_min smallint not null default 30;
alter table public.restaurantes drop constraint if exists restaurantes_agendamento_check;
alter table public.restaurantes add constraint restaurantes_agendamento_check check (
  agendamento_quando in ('fechada', 'sempre')
  and agendamento_dias between 1 and 30
  and agendamento_antecedencia_min between 0 and 1440
  and agendamento_intervalo_min in (10, 15, 20, 30, 45, 60)
  and (agendamento_limite is null or agendamento_limite between 1 and 999)
  and agendamento_libera_min between 0 and 240
);
grant select (agendamento_ativo, agendamento_quando, agendamento_dias, agendamento_antecedencia_min, agendamento_intervalo_min,
  agendamento_limite, agendamento_entrega, agendamento_retirada, agendamento_libera_min) on public.restaurantes to anon, authenticated;
grant update (agendamento_ativo, agendamento_quando, agendamento_dias, agendamento_antecedencia_min, agendamento_intervalo_min,
  agendamento_limite, agendamento_entrega, agendamento_retirada, agendamento_libera_min) on public.restaurantes to authenticated;

alter table public.pedidos add column if not exists agendado_para timestamptz;
create index if not exists pedidos_agendados_idx on public.pedidos (restaurante_id, agendado_para) where agendado_para is not null;
comment on column public.pedidos.agendado_para is 'Pedido agendado (0121): entra no fluxo X min antes (restaurantes.agendamento_libera_min).';

-- Pedido liberado para o fluxo? (sem agendamento: sempre)
create or replace function public.pedido_liberado(p_agendado timestamptz, p_restaurante uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_agendado is null or p_agendado - make_interval(mins => coalesce(
    (select agendamento_libera_min from public.restaurantes where id = p_restaurante), 30)) <= now()
$$;
grant execute on function public.pedido_liberado(timestamptz, uuid) to authenticated, service_role;

create or replace function public.impressao_elegiveis(p_restaurante uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.pedidos p
    left join public.impressao_reservas r on r.pedido_id = p.id
   where p.restaurante_id = p_restaurante
     and p.status <> 'cancelado'
     and exists (select 1 from public.pedido_itens i where i.pedido_id = p.id)
     -- 0121: agendado só entra na fila quando é liberado (a reimpressão pedida sempre sai).
     and (public.pedido_liberado(p.agendado_para, p.restaurante_id) or p.reimprimir = true)
     and (
           (p.impresso = false and p.status = 'recebido')
        or (p.impresso = false and p.status in ('preparando', 'pronto') and p.criado_em >= now() - interval '6 hours')
        or p.reimprimir = true
     )
     and (r.pedido_id is null or r.reservado_ate < now())
   order by p.criado_em
   limit 50
$$;

create or replace function public.impressao_reservar(p_restaurante uuid, p_instancia text, p_segundos int)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ate timestamptz := now() + make_interval(secs => greatest(coalesce(p_segundos, 90), 15));
  v_instancia text := nullif(btrim(coalesce(p_instancia, '')), '');
begin
  -- Uma varredura por loja de cada vez: a segunda espera a primeira gravar a reserva.
  perform pg_advisory_xact_lock(hashtextextended('impressao.fila:' || p_restaurante::text, 0));

  delete from public.impressao_reservas where restaurante_id = p_restaurante and reservado_ate < now() - interval '1 day';

  return query
  with alvo as (
    select p.id
      from public.pedidos p
      left join public.impressao_reservas r on r.pedido_id = p.id
     where p.restaurante_id = p_restaurante
       and p.status <> 'cancelado'
       and exists (select 1 from public.pedido_itens i where i.pedido_id = p.id)
       -- 0121: agendado só entra na fila quando é liberado (a reimpressão pedida sempre sai).
       and (public.pedido_liberado(p.agendado_para, p.restaurante_id) or p.reimprimir = true)
       and (
             (p.impresso = false and p.status = 'recebido')
          or (p.impresso = false and p.status in ('preparando', 'pronto') and p.criado_em >= now() - interval '6 hours')
          or p.reimprimir = true
       )
       and (r.pedido_id is null or r.reservado_ate < now()
            or (v_instancia is not null and r.reservado_por = v_instancia))
     order by p.criado_em
     limit 50
  ),
  gravado as (
    insert into public.impressao_reservas (pedido_id, restaurante_id, reservado_ate, reservado_por)
    select id, p_restaurante, v_ate, v_instancia from alvo
    on conflict (pedido_id) do update set reservado_ate = excluded.reservado_ate, reservado_por = excluded.reservado_por
    returning pedido_id
  )
  select pedido_id from gravado;
end $$;
