-- Rollback da 0121. Voltar o CÓDIGO antes. As funções de fila voltam às versões 0086/0087.
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
drop function if exists public.pedido_liberado(timestamptz, uuid);
drop index if exists public.pedidos_agendados_idx;
alter table public.pedidos drop column if exists agendado_para;
alter table public.restaurantes drop constraint if exists restaurantes_agendamento_check;
alter table public.restaurantes
  drop column if exists agendamento_ativo, drop column if exists agendamento_quando, drop column if exists agendamento_dias,
  drop column if exists agendamento_antecedencia_min, drop column if exists agendamento_intervalo_min, drop column if exists agendamento_limite,
  drop column if exists agendamento_entrega, drop column if exists agendamento_retirada, drop column if exists agendamento_libera_min;
