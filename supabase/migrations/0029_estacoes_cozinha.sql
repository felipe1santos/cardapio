-- supabase/migrations/0029_estacoes_cozinha.sql
-- ============================================================================
-- Estações de cozinha: acesso restrito por token (link/QR), sem login.
-- Cada estação tem um modo que define o que vê e quais ações pode executar.
-- Validação do token é server-side (admin client), igual ao portal do entregador.
-- ============================================================================

create table estacoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  nome text not null,
  modo text not null check (modo in ('producao','expedicao','completa')),
  token uuid not null unique default gen_random_uuid(),
  ativo boolean not null default true,
  ultimo_visto_em timestamptz,
  criado_em timestamptz not null default now()
);

create index estacoes_restaurante_id_idx on estacoes (restaurante_id);

alter table estacoes enable row level security;

-- O tenant gerencia (CRUD) só as estações da própria loja, pelo painel.
create policy "Tenant manages own stations"
  on estacoes for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());
