-- Menu groups (categories), e.g. "Lanches", "Bebidas"
create table grupos_cardapio (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  nome text not null,
  posicao int not null default 0,
  criado_em timestamptz not null default now()
);

create index grupos_cardapio_restaurante_id_idx on grupos_cardapio (restaurante_id);

-- Menu items
create type status_item_cardapio as enum ('disponivel', 'pausado', 'esgotado');

create table itens_cardapio (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  grupo_id uuid references grupos_cardapio (id) on delete set null,
  nome text not null,
  descricao text not null default '',
  preco numeric(10, 2) not null default 0,
  imagem_url text,
  status status_item_cardapio not null default 'disponivel',
  dias_disponiveis smallint[] not null default '{0,1,2,3,4,5,6}',
  promocao_preco numeric(10, 2),
  promocao_inicio date,
  promocao_fim date,
  criado_em timestamptz not null default now()
);

create index itens_cardapio_restaurante_id_idx on itens_cardapio (restaurante_id);
create index itens_cardapio_grupo_id_idx on itens_cardapio (grupo_id);

-- Reusable complemento presets (e.g. "Adicionais de Burger"), imported into items
-- with one click and then adjusted per item without affecting the original preset
create table presets_complementos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now()
);

create index presets_complementos_restaurante_id_idx on presets_complementos (restaurante_id);

create table preset_complemento_itens (
  id uuid primary key default gen_random_uuid(),
  preset_id uuid not null references presets_complementos (id) on delete cascade,
  nome text not null,
  preco numeric(10, 2) not null default 0,
  posicao int not null default 0
);

create index preset_complemento_itens_preset_id_idx on preset_complemento_itens (preset_id);

-- Complementos attached to a specific item (copied from a preset or added loose)
create table item_complementos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references itens_cardapio (id) on delete cascade,
  nome text not null,
  preco numeric(10, 2) not null default 0,
  posicao int not null default 0,
  preset_origem_id uuid references presets_complementos (id) on delete set null
);

create index item_complementos_item_id_idx on item_complementos (item_id);

alter table grupos_cardapio enable row level security;
alter table itens_cardapio enable row level security;
alter table presets_complementos enable row level security;
alter table preset_complemento_itens enable row level security;
alter table item_complementos enable row level security;

-- Public storefront: anyone can read groups, items and their complementos
-- (the customer menu has no authentication), tenant members manage everything else
create policy "Anyone can read menu groups"
  on grupos_cardapio for select
  using (true);

create policy "Tenant members manage their menu groups"
  on grupos_cardapio for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Anyone can read menu items"
  on itens_cardapio for select
  using (true);

create policy "Tenant members manage their menu items"
  on itens_cardapio for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Tenant members manage their complemento presets"
  on presets_complementos for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Tenant members manage their preset complemento items"
  on preset_complemento_itens for all
  using (
    exists (
      select 1 from presets_complementos p
      where p.id = preset_complemento_itens.preset_id
        and p.restaurante_id = auth_restaurante_id()
    )
  )
  with check (
    exists (
      select 1 from presets_complementos p
      where p.id = preset_complemento_itens.preset_id
        and p.restaurante_id = auth_restaurante_id()
    )
  );

create policy "Anyone can read item complementos"
  on item_complementos for select
  using (true);

create policy "Tenant members manage their item complementos"
  on item_complementos for all
  using (
    exists (
      select 1 from itens_cardapio i
      where i.id = item_complementos.item_id
        and i.restaurante_id = auth_restaurante_id()
    )
  )
  with check (
    exists (
      select 1 from itens_cardapio i
      where i.id = item_complementos.item_id
        and i.restaurante_id = auth_restaurante_id()
    )
  );

-- Storage bucket for menu item photos: public read (the storefront shows them
-- to anonymous customers), tenant-scoped write under a `<restaurante_id>/...` path
insert into storage.buckets (id, name, public)
values ('cardapio', 'cardapio', true)
on conflict (id) do nothing;

create policy "Public read of menu photos"
  on storage.objects for select
  using (bucket_id = 'cardapio');

create policy "Tenant members upload their menu photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cardapio'
    and (storage.foldername(name)) [1] = auth_restaurante_id()::text
  );

create policy "Tenant members update their menu photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'cardapio'
    and (storage.foldername(name)) [1] = auth_restaurante_id()::text
  );

create policy "Tenant members delete their menu photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'cardapio'
    and (storage.foldername(name)) [1] = auth_restaurante_id()::text
  );
