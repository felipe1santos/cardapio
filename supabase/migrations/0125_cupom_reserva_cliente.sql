-- 0125 — Cupom de uso único por cliente: reserva ANTES do pedido (2026-10-01).
--
-- O "uso único por cliente" era conferido pelo histórico antes de gravar; dois pedidos
-- simultâneos do mesmo telefone (duas abas/aparelhos) passavam os dois — o índice único de
-- cupom_usos só pegava depois, com o pedido já criado. Agora o servidor reserva
-- (cupom, telefone) num INSERT atômico antes do pedido; se o pedido falhar, devolve.
-- Reserva parada há mais de 2 min (requisição que morreu no meio) é retomada.
-- Só o servidor (service_role) mexe. Aditiva. Rollback: docs/rollback/0125_cupom_reserva_cliente.down.sql
create table if not exists public.cupom_reservas_cliente (
  cupom_id uuid not null references public.cupons(id) on delete cascade,
  cliente_telefone text not null,
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (cupom_id, cliente_telefone)
);
alter table public.cupom_reservas_cliente enable row level security;
revoke all on public.cupom_reservas_cliente from anon, authenticated;

create or replace function public.cupom_reservar_cliente(p_cupom_id uuid, p_restaurante_id uuid, p_telefone text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Já usado (pedido concluído) por este telefone: não reserva.
  if exists (select 1 from public.cupom_usos where cupom_id = p_cupom_id and cliente_telefone = p_telefone) then
    return false;
  end if;
  delete from public.cupom_reservas_cliente
   where cupom_id = p_cupom_id and cliente_telefone = p_telefone and criado_em < now() - interval '2 minutes';
  insert into public.cupom_reservas_cliente (cupom_id, cliente_telefone, restaurante_id)
  values (p_cupom_id, p_telefone, p_restaurante_id)
  on conflict do nothing;
  return found;
end $$;

create or replace function public.cupom_liberar_cliente(p_cupom_id uuid, p_telefone text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.cupom_reservas_cliente where cupom_id = p_cupom_id and cliente_telefone = p_telefone;
$$;

revoke all on function public.cupom_reservar_cliente(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cupom_liberar_cliente(uuid, text) from public, anon, authenticated;
grant execute on function public.cupom_reservar_cliente(uuid, uuid, text) to service_role;
grant execute on function public.cupom_liberar_cliente(uuid, text) to service_role;
