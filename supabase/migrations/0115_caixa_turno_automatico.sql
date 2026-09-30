-- 0115 — Turno de caixa abre sozinho na primeira entrega.
--
-- Com a 0114 o turno era aberto à mão na Logística; sem turno aberto, a entrega em
-- dinheiro ficava "fora de turno" e não entrava em nenhum acerto. Agora, quando um
-- pedido com entregador vira 'entregue' e a loja não tem turno aberto, o turno abre
-- naquele instante (aberto_em = now(), o mesmo relógio que grava entregue_em na mesma
-- transação — a entrega já nasce dentro dele).
--
-- Vale para todo caminho que marca entregue (Kanban, Logística, app do entregador,
-- Nexta). Turno já aberto (inclusive esquecido de ontem) não é mexido: fechar é sempre
-- decisão de quem opera o caixa. Abrir à mão continua funcionando.
--
-- Rollback: docs/rollback/0115_caixa_turno_automatico.down.sql

create or replace function public.caixa_turno_abre_na_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'entregue' and old.status is distinct from 'entregue' and new.entregador_id is not null then
    insert into public.caixa_turnos (restaurante_id, aberto_em, aberto_por_nome)
    values (new.restaurante_id, now(), 'Automático (1ª entrega)')
    on conflict (restaurante_id) where fechado_em is null do nothing;
  end if;
  return null;
end $$;

revoke execute on function public.caixa_turno_abre_na_entrega() from public, anon, authenticated;

drop trigger if exists caixa_turno_abre_na_entrega on public.pedidos;
create trigger caixa_turno_abre_na_entrega
  after update of status on public.pedidos
  for each row execute function public.caixa_turno_abre_na_entrega();
