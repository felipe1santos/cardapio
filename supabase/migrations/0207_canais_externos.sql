-- 0207 — Canais externos: marketplaces que mandam pedidos para o Kanban (19/10/2026, Etapa 2 do modo autônomo).
-- Camada comum para Open Delivery (Keeta, 99Food) e iFood. aiqfome não tem API pública (fica só o selo).
-- Tudo INERTE até o Super Admin liberar o módulo na loja E a loja colar as credenciais em Integrações.

-- Módulos novos (desligados por padrão: sem linha = bloqueado). Etapa 3 já entra aqui para não mexer duas vezes.
alter table public.loja_modulos drop constraint if exists loja_modulos_modulo_check;
alter table public.loja_modulos add constraint loja_modulos_modulo_check
  check (modulo in ('financeiro', 'agente_ia', 'disparos', 'entregas_lalamove', 'canal_opendelivery', 'canal_ifood', 'entregas_ifood', 'entregas_foody'));

-- Credenciais e estado da conexão de cada canal, por loja. Segredos cifrados (lib/pagamentos/cripto, PAGAMENTOS_CHAVE).
create table if not exists public.canais_config (
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  canal text not null check (canal in ('keeta', '99food', 'ifood')),
  ativo boolean not null default false,
  ambiente text not null default 'sandbox' check (ambiente in ('sandbox', 'producao')),
  -- Open Delivery: URL base da API do app (ex.: https://open.mykeeta.com/api/open/opendelivery). iFood: vazio (fixa).
  base_url text not null default '',
  client_id_cifrado text,
  client_secret_cifrado text,
  client_id_final text not null default '',
  -- Id da loja DENTRO do app (merchantId da Keeta/99Food/iFood).
  merchant_id_externo text not null default '',
  -- Open Delivery: X-App-Id que o app manda no webhook (confere com o cabeçalho). iFood: não usa.
  app_id_externo text not null default '',
  -- iFood distribuído: código de autorização do lojista (userCode → authorizationCode) e refresh token cifrado.
  refresh_token_cifrado text,
  access_token_cifrado text,
  token_expira_em timestamptz,
  webhook_token text not null unique default gen_random_uuid()::text,
  polling_ultimo_em timestamptz,
  polling_ultimo_erro text,
  ultimo_pedido_em timestamptz,
  atualizado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (restaurante_id, canal)
);
alter table public.canais_config enable row level security;
revoke all on public.canais_config from anon, authenticated;

-- Um pedido do app ↔ um pedido Menuzia. Idempotente por (canal, externo_id).
create table if not exists public.pedidos_externos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  canal text not null check (canal in ('keeta', '99food', 'ifood')),
  externo_id text not null,
  display_id text not null default '',
  pedido_id uuid references public.pedidos (id) on delete set null,
  -- Último status do app que recebemos e último status NOSSO que já mandamos ao app (a sincronização compara com pedidos.status).
  status_externo text not null default '',
  status_enviado text,
  status_enviado_em timestamptz,
  erro_envio text,
  bruto jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (canal, externo_id)
);
create index if not exists pedidos_externos_pedido on public.pedidos_externos (pedido_id);
create index if not exists pedidos_externos_loja on public.pedidos_externos (restaurante_id, criado_em desc);
alter table public.pedidos_externos enable row level security;
revoke all on public.pedidos_externos from anon, authenticated;

-- Eventos já tratados (o app pode reentregar o mesmo evento).
create table if not exists public.canal_eventos (
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  canal text not null,
  evento_id text not null,
  tipo text not null default '',
  externo_id text,
  processado_em timestamptz not null default now(),
  primary key (canal, evento_id)
);
alter table public.canal_eventos enable row level security;
revoke all on public.canal_eventos from anon, authenticated;

-- Vínculo item do app ↔ item do cardápio Menuzia. Sem vínculo o pedido entra mesmo assim (nome e preço do app);
-- com vínculo, o KDS/relatórios enxergam o item certo.
create table if not exists public.canal_itens_vinculo (
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  canal text not null,
  codigo_externo text not null,
  nome_externo text not null default '',
  item_id uuid references public.itens_cardapio (id) on delete set null,
  visto_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  primary key (restaurante_id, canal, codigo_externo)
);
alter table public.canal_itens_vinculo enable row level security;
revoke all on public.canal_itens_vinculo from anon, authenticated;
