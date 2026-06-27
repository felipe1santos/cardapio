-- PDV (serviço de mesa) — Fase 1. Tudo aditivo e idempotente.

-- Origem do pedido (rastreio de onde veio): 'cardapio' (vitrine/manual) | 'pdv'
alter table pedidos add column if not exists origem text not null default 'cardapio';

-- Mesa do pedido PDV (snapshot do nome da mesa no momento do lançamento)
alter table pedidos add column if not exists mesa text;

-- Cadastro de mesas por loja
create table if not exists mesas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create index if not exists idx_mesas_restaurante on mesas(restaurante_id);

alter table mesas enable row level security;

-- Acesso pela sessão do usuário dono do restaurante (mesmo padrão das demais tabelas do tenant).
drop policy if exists mesas_tenant_rw on mesas;
create policy mesas_tenant_rw on mesas
  for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select, insert, update, delete on mesas to authenticated;
