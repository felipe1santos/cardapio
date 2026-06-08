-- Restaurants (tenants)
create table restaurantes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  criado_em timestamptz not null default now()
);

-- App users: maps an auth.users row to a tenant + role
create type papel_usuario as enum ('dono', 'atendente', 'cozinha', 'logistica', 'entregador');

create table usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  papel papel_usuario not null,
  nome text not null,
  criado_em timestamptz not null default now()
);

create index usuarios_restaurante_id_idx on usuarios (restaurante_id);

-- Helper: current user's tenant id, used by every RLS policy in this and future migrations
create or replace function auth_restaurante_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select restaurante_id from usuarios where id = auth.uid()
$$;

alter table restaurantes enable row level security;
alter table usuarios enable row level security;

-- A user can read only their own tenant row
create policy "Tenant members can read their restaurant"
  on restaurantes for select
  using (id = auth_restaurante_id());

-- A user can read only co-workers within the same tenant
create policy "Tenant members can read co-workers"
  on usuarios for select
  using (restaurante_id = auth_restaurante_id());

-- A user can update only their own profile row
create policy "Users can update their own profile"
  on usuarios for update
  using (id = auth.uid());
