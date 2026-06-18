-- ============================================================================
-- Tipos de item (Simples / Pizza / Marmita) — pizza tem catálogo de sabores
-- com preço por tamanho (matriz), bordas e massas; marmita reaproveita a
-- tabela genérica tamanhos_item já existente, mas a partir de um catálogo de
-- tamanhos padrão da loja (cada loja define o que é P/M/G).
-- ============================================================================

create type tipo_item_cardapio as enum ('simples', 'pizza', 'marmita');

alter table itens_cardapio
  add column tipo_item tipo_item_cardapio not null default 'simples';

-- Tamanhos padrão de pizza (por loja) — ex.: Pequena/4 fatias, Média/6, Grande/8
create table tamanhos_padrao_pizza (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  nome text not null,
  fatias int not null default 0,
  posicao int not null default 0
);

create index tamanhos_padrao_pizza_restaurante_id_idx on tamanhos_padrao_pizza (restaurante_id);

-- Tamanhos padrão de marmita (por loja) — ex.: Pequena/500g, Média/700g
create table tamanhos_padrao_marmita (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  nome text not null,
  peso text not null default '',
  posicao int not null default 0
);

create index tamanhos_padrao_marmita_restaurante_id_idx on tamanhos_padrao_marmita (restaurante_id);

-- Bordas de pizza (por loja) — preço extra fixo, oferecido em todas as pizzas
create table bordas_pizza (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  nome text not null,
  preco numeric(10, 2) not null default 0,
  posicao int not null default 0
);

create index bordas_pizza_restaurante_id_idx on bordas_pizza (restaurante_id);

-- Massas de pizza (por loja) — preço extra fixo, oferecido em todas as pizzas
create table massas_pizza (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  nome text not null,
  preco numeric(10, 2) not null default 0,
  posicao int not null default 0
);

create index massas_pizza_restaurante_id_idx on massas_pizza (restaurante_id);

-- Sabores de pizza (por item de tipo 'pizza')
create table pizza_sabores (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references itens_cardapio (id) on delete cascade,
  nome text not null,
  descricao text not null default '',
  imagem_url text,
  status status_item_cardapio not null default 'disponivel',
  posicao int not null default 0
);

create index pizza_sabores_item_id_idx on pizza_sabores (item_id);

-- Preço do sabor pra cada tamanho padrão de pizza da loja (a matriz das telas do concorrente)
create table pizza_sabor_precos (
  id uuid primary key default gen_random_uuid(),
  sabor_id uuid not null references pizza_sabores (id) on delete cascade,
  tamanho_padrao_id uuid not null references tamanhos_padrao_pizza (id) on delete cascade,
  preco numeric(10, 2) not null default 0,
  unique (sabor_id, tamanho_padrao_id)
);

create index pizza_sabor_precos_sabor_id_idx on pizza_sabor_precos (sabor_id);

-- Snapshot da escolha de pizza no pedido (preço já refletido em preco_unitario)
alter table pedido_itens
  add column sabor_nome text not null default '',
  add column borda_nome text not null default '',
  add column massa_nome text not null default '';

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table tamanhos_padrao_pizza enable row level security;
alter table tamanhos_padrao_marmita enable row level security;
alter table bordas_pizza enable row level security;
alter table massas_pizza enable row level security;
alter table pizza_sabores enable row level security;
alter table pizza_sabor_precos enable row level security;

create policy "Anyone can read pizza size catalog"
  on tamanhos_padrao_pizza for select using (true);
create policy "Tenant members manage their pizza size catalog"
  on tamanhos_padrao_pizza for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Anyone can read marmita size catalog"
  on tamanhos_padrao_marmita for select using (true);
create policy "Tenant members manage their marmita size catalog"
  on tamanhos_padrao_marmita for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Anyone can read pizza crust catalog"
  on bordas_pizza for select using (true);
create policy "Tenant members manage their pizza crust catalog"
  on bordas_pizza for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Anyone can read pizza dough catalog"
  on massas_pizza for select using (true);
create policy "Tenant members manage their pizza dough catalog"
  on massas_pizza for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Anyone can read pizza flavors"
  on pizza_sabores for select using (true);
create policy "Tenant members manage their pizza flavors"
  on pizza_sabores for all
  using (
    exists (select 1 from itens_cardapio i where i.id = pizza_sabores.item_id and i.restaurante_id = auth_restaurante_id())
  )
  with check (
    exists (select 1 from itens_cardapio i where i.id = pizza_sabores.item_id and i.restaurante_id = auth_restaurante_id())
  );

create policy "Anyone can read pizza flavor prices"
  on pizza_sabor_precos for select using (true);
create policy "Tenant members manage their pizza flavor prices"
  on pizza_sabor_precos for all
  using (
    exists (
      select 1 from pizza_sabores s
      join itens_cardapio i on i.id = s.item_id
      where s.id = pizza_sabor_precos.sabor_id and i.restaurante_id = auth_restaurante_id()
    )
  )
  with check (
    exists (
      select 1 from pizza_sabores s
      join itens_cardapio i on i.id = s.item_id
      where s.id = pizza_sabor_precos.sabor_id and i.restaurante_id = auth_restaurante_id()
    )
  );

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
grant select on tamanhos_padrao_pizza, tamanhos_padrao_marmita, bordas_pizza, massas_pizza, pizza_sabores, pizza_sabor_precos to anon, authenticated;
grant insert, update, delete on tamanhos_padrao_pizza, tamanhos_padrao_marmita, bordas_pizza, massas_pizza, pizza_sabores, pizza_sabor_precos to authenticated;
