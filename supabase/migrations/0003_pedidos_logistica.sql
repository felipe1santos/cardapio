-- ============================================================================
-- Pipeline de pedidos: vitrine (cliente) -> Kanban -> Logística, em tempo real.
-- ============================================================================

-- Entregadores
create type status_entregador as enum ('online', 'ocupado', 'offline');

create table entregadores (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  nome text not null,
  telefone text not null default '',
  status status_entregador not null default 'offline',
  criado_em timestamptz not null default now()
);

create index entregadores_restaurante_id_idx on entregadores (restaurante_id);

-- Pedidos
create type tipo_pedido as enum ('entrega', 'retirada');
create type forma_pagamento as enum ('pix', 'cartao', 'dinheiro');
create type status_pedido as enum ('recebido', 'preparando', 'pronto', 'em_rota', 'entregue', 'cancelado');

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  numero int not null default 0, -- sequencial por loja, para exibição (#numero)
  tipo tipo_pedido not null default 'entrega',
  status status_pedido not null default 'recebido',
  cliente_nome text not null default '',
  cliente_telefone text not null default '',
  endereco_rua text not null default '',
  endereco_numero text not null default '',
  endereco_complemento text not null default '',
  endereco_bairro text not null default '',
  endereco_cep text not null default '',
  forma_pagamento forma_pagamento not null default 'pix',
  troco_para numeric(10, 2), -- preenchido só quando paga em dinheiro e precisa de troco
  pago boolean not null default false,
  subtotal numeric(10, 2) not null default 0,
  taxa_entrega numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  observacao text not null default '',
  entregador_id uuid references entregadores (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index pedidos_restaurante_id_idx on pedidos (restaurante_id);
create index pedidos_status_idx on pedidos (restaurante_id, status);

-- Numeração sequencial por loja
create or replace function set_pedido_numero()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null or new.numero = 0 then
    select coalesce(max(numero), 0) + 1 into new.numero
    from pedidos where restaurante_id = new.restaurante_id;
  end if;
  return new;
end;
$$;

create trigger pedidos_set_numero
  before insert on pedidos
  for each row execute function set_pedido_numero();

-- Mantém atualizado_em em dia (a timeline do cliente depende disso)
create or replace function touch_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create trigger pedidos_touch_atualizado_em
  before update on pedidos
  for each row execute function touch_atualizado_em();

-- Itens do pedido (snapshot do item no momento da compra)
create table pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos (id) on delete cascade,
  item_id uuid references itens_cardapio (id) on delete set null,
  nome text not null,
  preco_unitario numeric(10, 2) not null default 0,
  quantidade int not null default 1,
  observacao text not null default '',
  complementos jsonb not null default '[]'::jsonb -- [{ "nome": ..., "preco": ... }]
);

create index pedido_itens_pedido_id_idx on pedido_itens (pedido_id);

-- Fechamento de caixa por entregador/rota (conferência: esperado x declarado x diferença)
create table fechamentos_caixa (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  entregador_id uuid not null references entregadores (id) on delete cascade,
  valor_esperado numeric(10, 2) not null default 0, -- soma dos pedidos pagos em dinheiro
  troco_levado numeric(10, 2) not null default 0,
  valor_declarado numeric(10, 2) not null default 0, -- o que o entregador devolveu/declarou
  diferenca numeric(10, 2) not null default 0,
  observacao text not null default '',
  criado_em timestamptz not null default now(),
  fechado_em timestamptz
);

create index fechamentos_caixa_restaurante_id_idx on fechamentos_caixa (restaurante_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table entregadores enable row level security;
alter table pedidos enable row level security;
alter table pedido_itens enable row level security;
alter table fechamentos_caixa enable row level security;

create policy "Tenant members manage entregadores"
  on entregadores for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

-- A loja gerencia seus pedidos
create policy "Tenant members manage pedidos"
  on pedidos for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

-- A vitrine pública (cliente sem login) pode CRIAR pedidos
create policy "Anyone can create pedidos"
  on pedidos for insert to anon, authenticated
  with check (true);

create policy "Tenant members manage pedido_itens"
  on pedido_itens for all
  using (
    exists (
      select 1 from pedidos p
      where p.id = pedido_itens.pedido_id and p.restaurante_id = auth_restaurante_id()
    )
  )
  with check (
    exists (
      select 1 from pedidos p
      where p.id = pedido_itens.pedido_id and p.restaurante_id = auth_restaurante_id()
    )
  );

create policy "Anyone can create pedido_itens"
  on pedido_itens for insert to anon, authenticated
  with check (true);

create policy "Tenant members manage fechamentos"
  on fechamentos_caixa for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

-- A vitrine resolve a loja pelo slug de forma anônima — habilita leitura pública
-- da identidade da loja (nome/slug). 0001 só permitia membros da loja.
create policy "Anyone can read restaurant storefront"
  on restaurantes for select
  using (true);

-- ----------------------------------------------------------------------------
-- Grants para os papéis da Data API. Projetos novos do Supabase passaram a
-- revogar tabelas novas por padrão, então concedemos explicitamente.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- Leitura pública do cardápio + identidade da loja (vitrine anônima)
grant select on restaurantes, grupos_cardapio, itens_cardapio, item_complementos to anon, authenticated;

-- Vitrine cria pedidos
grant insert on pedidos, pedido_itens to anon;

-- Painel autenticado gerencia tudo da sua loja
grant select, insert, update, delete on
  restaurantes, usuarios, grupos_cardapio, itens_cardapio,
  presets_complementos, preset_complemento_itens, item_complementos,
  pedidos, pedido_itens, entregadores, fechamentos_caixa
  to authenticated;

-- ----------------------------------------------------------------------------
-- Realtime: o Kanban e a Logística assinam mudanças de pedidos/entregadores
-- (RLS continua valendo — cada loja só recebe os próprios registros).
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table pedidos;
alter publication supabase_realtime add table entregadores;
