-- Entrega por raio (faixas de km) + coordenadas da loja para o cálculo por linha reta.

-- Coordenadas da loja (geocodificadas do CEP/endereço, cacheadas).
alter table restaurantes
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- Faixas de distância: até X km custa R$ Y. O bairro tem prioridade; o raio é o
-- segundo critério quando o bairro do cliente não bate com nenhuma taxa cadastrada.
create table if not exists taxas_entrega_raio (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  ate_km numeric(6, 2) not null,
  taxa numeric(10, 2) not null default 0,
  posicao int not null default 0,
  criado_em timestamptz not null default now()
);

create index if not exists taxas_entrega_raio_restaurante_id_idx on taxas_entrega_raio (restaurante_id);

alter table taxas_entrega_raio enable row level security;

-- A vitrine pública precisa ler as faixas para calcular o frete no checkout.
create policy "Anyone can read radius fees"
  on taxas_entrega_raio for select
  using (true);

create policy "Tenant members manage radius fees"
  on taxas_entrega_raio for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select on taxas_entrega_raio to anon, authenticated;
grant select, insert, update, delete on taxas_entrega_raio to authenticated;
