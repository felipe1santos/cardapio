-- 0211 — Cashback por item (20/10/2026, Etapa 7 do modo autônomo — SÓ LOCAL até o dono aprovar; tabelas aditivas e inertes).
-- O dono escolhe o lanche → quanto de cashback dá (R$ ou %) → por quantos dias o cliente pode usar em outro pedido.
-- O crédito nasce quando o pedido é ENTREGUE (mesmo motor da fidelidade), expira sozinho fora do prazo e é usado
-- automaticamente no checkout da vitrine e pela IA no WhatsApp (abate do subtotal, nunca do frete).
-- Tabelas só de servidor (API com service_role), como canais_config.
create table if not exists public.cashback_regras (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  item_id uuid not null references public.itens_cardapio (id) on delete cascade,
  tipo text not null check (tipo in ('valor', 'percentual')),
  valor numeric(10, 2) not null check (valor > 0),
  validade_dias integer not null default 30 check (validade_dias between 1 and 365),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (restaurante_id, item_id)
);
alter table public.cashback_regras enable row level security;
revoke all on public.cashback_regras from anon, authenticated;

create table if not exists public.cashback_creditos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  cliente_telefone text not null,
  pedido_origem_id uuid references public.pedidos (id) on delete set null,
  regra_id uuid references public.cashback_regras (id) on delete set null,
  item_nome text not null default '',
  valor numeric(10, 2) not null check (valor > 0),
  saldo numeric(10, 2) not null check (saldo >= 0),
  expira_em timestamptz not null,
  status text not null default 'disponivel' check (status in ('disponivel', 'usado', 'expirado', 'revertido')),
  pedido_uso_id uuid references public.pedidos (id) on delete set null,
  usado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists cashback_creditos_cliente on public.cashback_creditos (restaurante_id, cliente_telefone, status, expira_em);
create index if not exists cashback_creditos_pedido_origem on public.cashback_creditos (pedido_origem_id);
create index if not exists cashback_creditos_pedido_uso on public.cashback_creditos (pedido_uso_id);
alter table public.cashback_creditos enable row level security;
revoke all on public.cashback_creditos from anon, authenticated;

-- Quanto de cashback o pedido usou (já dentro de pedidos.desconto; aqui só para o relatório e para reverter no cancelamento).
alter table public.pedidos add column if not exists cashback_usado numeric(10, 2);
