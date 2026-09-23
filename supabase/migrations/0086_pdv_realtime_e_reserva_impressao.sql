-- ============================================================================
-- 0086 — PDV v2: tempo real das contas e reserva atômica da fila de impressão
--
-- 1. Realtime: `comandas` e `pagamentos_comanda` entram na publicação, para o PDV,
--    a Central de Balcão e o salão verem pagamento/fechamento/abertura de outra
--    tela sem recarregar. A RLS de SELECT (0062) continua valendo no Realtime.
--
-- 2. Fila de impressão com reserva (lógica de DISPARO — o recibo não muda):
--    · elegível: não cancelado, com pelo menos um item, e
--        - novo não impresso (recebido), ou
--        - em preparo OU PRONTO não impresso nas últimas 6h (antes o pronto ficava
--          de fora: pedido que pulou etapas nunca saía no papel), ou
--        - reimpressão pedida;
--    · a varredura RESERVA o que devolve por p_segundos, sob trava por loja: dois
--      Assistentes da mesma loja (ou dois ciclos) não recebem o mesmo pedido;
--    · reserva expirada volta para a fila (Assistente que caiu no meio não perde
--      pedido); a mesma instância revê a própria reserva (reenvia o "impresso");
--    · cancelado nunca é elegível (e a 0083 zera `reimprimir` ao cancelar).
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'comandas') then
      alter publication supabase_realtime add table public.comandas;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pagamentos_comanda') then
      alter publication supabase_realtime add table public.pagamentos_comanda;
    end if;
  end if;
end $$;

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

-- Confirmação do Assistente: impresso, reimpressão consumida, reserva liberada.
create or replace function public.impressao_confirmar(p_restaurante uuid, p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pedidos set impresso = true, reimprimir = false
   where id = p_pedido and restaurante_id = p_restaurante;
  delete from public.impressao_reservas where pedido_id = p_pedido and restaurante_id = p_restaurante;
end $$;

revoke execute on function public.impressao_reservar(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.impressao_confirmar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.impressao_reservar(uuid, text, int) to service_role;
grant execute on function public.impressao_confirmar(uuid, uuid) to service_role;
