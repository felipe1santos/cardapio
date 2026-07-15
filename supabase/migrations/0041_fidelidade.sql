-- Fidelidade + Cupons: campanhas de meta (cliente acumula e ganha prêmio),
-- progresso por cliente, recompensas prontas pra resgatar e cupons de código
-- criados pelo admin. A vitrine acessa via service_role (bypassa RLS) através
-- das rotas /api/loja/[slug]/*, no mesmo padrão de clientes (0013). Estas
-- políticas valem para o painel admin (autenticado).

-- Campanhas de fidelidade: metas que o cliente completa pra ganhar prêmio.
create table campanhas_fidelidade (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  nome text not null,
  descricao text not null default '',
  ativa boolean not null default true,
  -- Meta: o que o cliente precisa acumular (pedidos entregues contam).
  tipo_meta text not null check (tipo_meta in ('valor_gasto', 'qtd_pedidos', 'qtd_itens')),
  meta_valor numeric(10,2), -- alvo em R$ quando tipo_meta = valor_gasto
  meta_quantidade integer,  -- alvo qtd quando qtd_pedidos/qtd_itens
  -- Dias da semana em que pedidos CONTAM pro progresso (0=dom..6=sab). Vazio = todos.
  dias_semana_contam smallint[] not null default '{}',
  -- Dias da semana em que o prêmio pode ser RESGATADO. Vazio = qualquer dia.
  dias_semana_resgate smallint[] not null default '{}',
  -- Prêmio
  premio_tipo text not null check (premio_tipo in ('item_gratis', 'desconto_percentual', 'desconto_valor', 'entrega_gratis')),
  premio_item_id uuid references itens_cardapio (id) on delete set null,
  premio_valor numeric(10,2), -- % ou R$ conforme premio_tipo
  -- true = cliente pode completar de novo depois de ganhar; false = uma única vez.
  repetivel boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index campanhas_fidelidade_restaurante_id_idx on campanhas_fidelidade (restaurante_id);

-- Progresso de cada cliente em cada campanha.
create table fidelidade_progresso (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  campanha_id uuid not null references campanhas_fidelidade (id) on delete cascade,
  cliente_telefone text not null,
  progresso_valor numeric(10,2) not null default 0,
  progresso_qtd integer not null default 0,
  ciclos_completados integer not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (campanha_id, cliente_telefone)
);

-- Prêmios ganhos, prontos pra resgatar (aparecem na aba Cupons da vitrine).
create table fidelidade_recompensas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  campanha_id uuid not null references campanhas_fidelidade (id) on delete cascade,
  cliente_telefone text not null,
  status text not null default 'disponivel' check (status in ('disponivel', 'resgatado', 'cancelado')),
  pedido_resgate_id uuid references pedidos (id) on delete set null,
  ganho_em timestamptz not null default now(),
  resgatado_em timestamptz
);
create index idx_fidelidade_recompensas_cliente on fidelidade_recompensas (restaurante_id, cliente_telefone, status);

-- Cupons de código criados pelo admin (desconto %, valor, entrega grátis, item grátis).
create table cupons (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  codigo text not null,
  descricao text not null default '',
  ativo boolean not null default true,
  tipo text not null check (tipo in ('desconto_percentual', 'desconto_valor', 'entrega_gratis', 'item_gratis')),
  valor numeric(10,2),
  item_id uuid references itens_cardapio (id) on delete set null,
  -- Público: todos | primeira_compra (nunca pediu) | recompra (só 1 pedido OU inativo há X dias)
  publico text not null default 'todos' check (publico in ('todos', 'primeira_compra', 'recompra')),
  dias_inatividade integer, -- usado quando publico = recompra
  -- Dias da semana em que o cupom vale (ex.: batata grátis na quarta). Vazio = todos.
  dias_semana smallint[] not null default '{}',
  validade_inicio date,
  validade_fim date,
  valor_minimo_pedido numeric(10,2), -- subtotal mínimo pra aplicar. null = sem mínimo
  uso_unico_por_cliente boolean not null default true,
  max_usos integer, -- teto global. null = ilimitado
  usos integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (restaurante_id, codigo)
);

-- Registro de uso de cupom (trava uso único por cliente).
create table cupom_usos (
  id uuid primary key default gen_random_uuid(),
  cupom_id uuid not null references cupons (id) on delete cascade,
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  cliente_telefone text not null,
  pedido_id uuid not null references pedidos (id) on delete cascade,
  usado_em timestamptz not null default now()
);
create index idx_cupom_usos_cliente on cupom_usos (cupom_id, cliente_telefone);

-- Pedido: desconto aplicado + vínculos + idempotência do motor de fidelidade.
alter table pedidos add column cupom_codigo text;
alter table pedidos add column desconto numeric(10,2) not null default 0;
alter table pedidos add column recompensa_id uuid references fidelidade_recompensas (id) on delete set null;
alter table pedidos add column fidelidade_processado boolean not null default false;

-- ----------------------------------------------------------------------------
-- RLS (mesmo padrão de 0021_campanhas.sql / 0013_clientes_vitrine.sql):
-- helper auth_restaurante_id() + policy única "for all" por tabela.
-- ----------------------------------------------------------------------------
alter table campanhas_fidelidade enable row level security;
alter table fidelidade_progresso enable row level security;
alter table fidelidade_recompensas enable row level security;
alter table cupons enable row level security;
alter table cupom_usos enable row level security;

create policy "Tenant members manage campanhas_fidelidade"
  on campanhas_fidelidade for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Tenant members manage fidelidade_progresso"
  on fidelidade_progresso for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Tenant members manage fidelidade_recompensas"
  on fidelidade_recompensas for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Tenant members manage cupons"
  on cupons for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

create policy "Tenant members manage cupom_usos"
  on cupom_usos for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select, insert, update, delete on
  campanhas_fidelidade, fidelidade_progresso, fidelidade_recompensas, cupons, cupom_usos
  to authenticated;
