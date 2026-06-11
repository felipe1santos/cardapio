-- ============================================================================
-- Configurações da loja (Ajustes), taxas de entrega por bairro e integrações
-- (Facebook Pixel / Google Tag) — cada loja com os seus próprios.
-- ============================================================================

alter table restaurantes
  add column logo_url text,
  add column telefone text not null default '',
  add column endereco text not null default '',
  add column taxa_entrega_padrao numeric(10, 2) not null default 0,
  add column facebook_pixel_id text,
  add column google_tag_id text;

-- Taxa de entrega por bairro (exceções sobre a taxa padrão)
create table taxas_entrega_bairro (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  bairro text not null,
  taxa numeric(10, 2) not null default 0,
  criado_em timestamptz not null default now()
);

create index taxas_entrega_bairro_restaurante_id_idx on taxas_entrega_bairro (restaurante_id);

alter table taxas_entrega_bairro enable row level security;

-- A vitrine pública precisa ler as taxas para calcular o frete no checkout
create policy "Anyone can read delivery fees"
  on taxas_entrega_bairro for select
  using (true);

create policy "Tenant members manage delivery fees"
  on taxas_entrega_bairro for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select on taxas_entrega_bairro to anon, authenticated;
grant select, insert, update, delete on taxas_entrega_bairro to authenticated;
