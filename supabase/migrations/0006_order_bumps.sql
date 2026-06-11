-- Max order-bump items to show per restaurant (default 4)
alter table restaurantes add column order_bump_max int not null default 4;

-- Order bumps table: which items appear as suggestions in checkout
create table order_bumps (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  item_id uuid not null references itens_cardapio (id) on delete cascade,
  posicao int not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (restaurante_id, item_id)
);

create index order_bumps_restaurante_idx on order_bumps (restaurante_id);

alter table order_bumps enable row level security;

create policy "Anyone can read order bumps"
  on order_bumps for select
  using (true);

create policy "Tenant members manage order bumps"
  on order_bumps for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());
