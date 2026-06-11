-- Add selection rules to complement presets
alter table presets_complementos
  add column obrigatorio boolean not null default false,
  add column min_escolhas int not null default 0,
  add column max_escolhas int not null default 1;

-- Complement groups per item (defines selection rules for a set of complementos)
create table grupos_item_complementos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references itens_cardapio (id) on delete cascade,
  preset_origem_id uuid references presets_complementos (id) on delete set null,
  nome text not null,
  obrigatorio boolean not null default false,
  min_escolhas int not null default 0,
  max_escolhas int not null default 1,
  posicao int not null default 0
);

create index grupos_item_complementos_item_id_idx on grupos_item_complementos (item_id);

-- Add group FK to item_complementos (null = loose complemento, not in a group)
alter table item_complementos
  add column grupo_id uuid references grupos_item_complementos (id) on delete cascade;

create index item_complementos_grupo_id_idx on item_complementos (grupo_id);

alter table grupos_item_complementos enable row level security;

create policy "Anyone can read item complement groups"
  on grupos_item_complementos for select
  using (true);

create policy "Tenant members manage their item complement groups"
  on grupos_item_complementos for all
  using (
    exists (
      select 1 from itens_cardapio i
      where i.id = grupos_item_complementos.item_id
        and i.restaurante_id = auth_restaurante_id()
    )
  )
  with check (
    exists (
      select 1 from itens_cardapio i
      where i.id = grupos_item_complementos.item_id
        and i.restaurante_id = auth_restaurante_id()
    )
  );
