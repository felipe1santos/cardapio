-- PDV Fase 2 — comandas de mesa. Aditivo e idempotente.

create table if not exists comandas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  mesa_id uuid not null references mesas(id) on delete cascade,
  status text not null default 'aberta',   -- 'aberta' | 'fechada'
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz
);

create index if not exists idx_comandas_restaurante on comandas(restaurante_id);
create index if not exists idx_comandas_mesa on comandas(mesa_id);

-- No máximo 1 comanda aberta por mesa (resolve corrida do find-or-create).
create unique index if not exists comandas_mesa_aberta_unq
  on comandas (restaurante_id, mesa_id) where status = 'aberta';

-- Liga cada pedido à sua comanda (null = pedido avulso: balcão ou vitrine).
alter table pedidos add column if not exists comanda_id uuid references comandas(id);
create index if not exists idx_pedidos_comanda on pedidos(comanda_id);

alter table comandas enable row level security;

drop policy if exists comandas_tenant_rw on comandas;
create policy comandas_tenant_rw on comandas
  for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select, insert, update, delete on comandas to authenticated;
