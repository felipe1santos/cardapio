-- Cadastro de clientes da vitrine (cliente final), autenticado por código de
-- verificação enviado via WhatsApp (Evolution API da loja). Guarda nome e
-- endereço para agilizar próximos pedidos e servir de base para o futuro
-- sistema de fidelidade.
create table clientes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  telefone text not null,
  nome text not null default '',
  endereco_rua text not null default '',
  endereco_numero text not null default '',
  endereco_complemento text not null default '',
  endereco_bairro text not null default '',
  endereco_cep text not null default '',
  token text not null default encode(gen_random_bytes(24), 'hex'),
  verificado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (restaurante_id, telefone)
);

create unique index clientes_token_idx on clientes (token);

-- Códigos de verificação (OTP) enviados por WhatsApp para confirmar o telefone.
create table cliente_codigos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  telefone text not null,
  codigo text not null,
  tentativas int not null default 0,
  expira_em timestamptz not null,
  criado_em timestamptz not null default now()
);

create index cliente_codigos_lookup_idx on cliente_codigos (restaurante_id, telefone);

alter table clientes enable row level security;
alter table cliente_codigos enable row level security;

-- A vitrine acessa via service_role (bypassa RLS) através das rotas
-- /api/loja/[slug]/conta/*. Estas políticas valem para o futuro painel admin
-- (lista de clientes / fidelidade).
create policy "Tenant members manage clientes"
  on clientes for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Tenant members manage cliente_codigos"
  on cliente_codigos for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select, insert, update, delete on clientes, cliente_codigos to authenticated;
