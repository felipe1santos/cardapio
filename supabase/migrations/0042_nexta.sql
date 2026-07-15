-- Integração Nexta Delivery (padrão Open Delivery / ABRASEL v1.7.0 — módulo Logistics).
--
-- O Nexta é um operador logístico: nós cotamos/criamos/cancelamos entregas na API
-- REST deles e recebemos os eventos de status de volta por webhook. O pedido continua
-- 100% dono do fluxo Menuzia (kanban → logística) — o Nexta entra como um "entregador
-- virtual" adicional no painel de despacho.
--
-- Feature 100% aditiva: com `nexta_config.ativo = false` (default) nada muda no fluxo atual.
-- Plano completo: docs/NEXTA-INTEGRACAO-PLANO.md

-- ── Config por loja (1:1 com restaurantes) ───────────────────────────────────
-- Credenciais são POR ESTABELECIMENTO (o Nexta emite 1 par client_id/secret por loja),
-- por isso nada aqui é global/env — tudo é config de tenant.
create table nexta_config (
  restaurante_id uuid primary key references restaurantes (id) on delete cascade,
  ativo boolean not null default false,
  base_url text not null default '',
  client_id text not null default '',
  -- Segredo em coluna text: mesmo padrão já usado para a Evolution API. Nunca é lido
  -- pelo client — `nexta_config` não tem policy de RLS para `authenticated` (ver abaixo),
  -- então só o service_role (route handlers) enxerga esta tabela.
  client_secret text not null default '',
  -- ID estável do estabelecimento no padrão Open Delivery (mín. 36 chars), gerado por
  -- nós 1x e reusado com qualquer operador logístico. Formato `CNPJ-UUID` quando a loja
  -- informa CNPJ; só o UUID (36 chars) quando não informa.
  merchant_id text not null default '',
  merchant_name text not null default '',
  cnpj text not null default '',
  -- Slug aleatório que identifica a loja na URL pública do webhook. 2ª camada de defesa
  -- além do HMAC. Nunca é regerado depois do 1º save (a URL fica registrada no Nexta).
  webhook_token text not null unique default gen_random_uuid()::text,

  -- Endereço de coleta (a loja). O Open Delivery exige endereço ESTRUTURADO, mas
  -- `restaurantes.endereco` é texto livre e não temos cidade/UF separados — por isso
  -- os campos moram aqui, preenchidos uma vez na tela de Integrações.
  pickup_rua text not null default '',
  pickup_numero text not null default '',
  pickup_complemento text not null default '',
  pickup_bairro text not null default '',
  pickup_cidade text not null default '',
  pickup_uf text not null default '',
  pickup_cep text not null default '',
  pickup_latitude double precision,
  pickup_longitude double precision,

  -- Preferências de despacho
  vehicle_type text not null default 'MOTORBIKE_BAG',
  container text not null default 'THERMIC',
  container_size text not null default 'MEDIUM',
  pickup_limit_min int not null default 30,
  delivery_limit_min int not null default 60,
  -- Flag de compatibilidade: a spec manda `limitTimes` em MINUTOS, mas o backend do
  -- Nexta (Xano) rejeitou minutos no sandbox pedindo timestamp. Alterna sem redeploy
  -- enquanto a homologação (Fase 4) não define o formato oficial.
  limit_times_as_datetime boolean not null default false,
  peso_padrao_g int not null default 1500,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ── Entregas solicitadas ao Nexta ────────────────────────────────────────────
-- N:1 com pedidos: a spec só permite reenviar o mesmo orderId se o último evento foi
-- REJECTED. Retentativa depois de um cancelamento exige orderId novo ⇒ linha nova.
create table nexta_entregas (
  id uuid primary key default gen_random_uuid(), -- = orderId enviado ao Nexta
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  pedido_id uuid not null references pedidos (id) on delete cascade,
  delivery_id text, -- id do lado do Nexta (chega no 202 da criação e nos webhooks)
  status text not null default 'PENDING', -- enum de eventos Open Delivery (aceita valores novos)
  preco numeric(10, 2),
  cotacao jsonb, -- resposta de /availability usada no despacho (auditoria de preço)
  eta_coleta timestamptz,
  eta_entrega timestamptz,
  entregador_nome text,
  entregador_telefone text,
  entregador_foto_url text,
  tracking_url text,
  rejeicao_motivo text,
  problema jsonb,
  eventos jsonb not null default '[]'::jsonb, -- histórico append-only dos webhooks recebidos
  cancel_additional_charges boolean,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index nexta_entregas_restaurante_idx on nexta_entregas (restaurante_id, criado_em desc);
create index nexta_entregas_pedido_idx on nexta_entregas (pedido_id);

-- No máximo UMA entrega ativa por pedido — trava de duplicidade no banco, não só na UI.
create unique index nexta_entregas_ativa_por_pedido
  on nexta_entregas (pedido_id)
  where status not in ('REJECTED', 'CANCELLED', 'DELIVERY_FINISHED', 'ORDER_DELIVERED', 'RETURNED_TO_MERCHANT');

create trigger nexta_config_touch_atualizado_em
  before update on nexta_config
  for each row execute function touch_atualizado_em();

create trigger nexta_entregas_touch_atualizado_em
  before update on nexta_entregas
  for each row execute function touch_atualizado_em();

-- ── Pedido: vínculo com a solicitação ativa + cache de geocode ───────────────
-- O enum de status do pedido NÃO muda: o Nexta só move o pedido pelos status que já
-- existem (pronto → em_rota → entregue), via webhook.
alter table pedidos add column nexta_entrega_id uuid references nexta_entregas (id) on delete set null;

-- Coordenadas do endereço de entrega. O Open Delivery pede lat/lng no payload e o
-- checkout não persistia o geocode — estas colunas guardam o resultado da primeira
-- cotação para não pagar Google Geocoding a cada recotação. Nullable: pedido sem
-- coordenadas ainda é cotado pelo endereço completo.
alter table pedidos add column entrega_latitude double precision;
alter table pedidos add column entrega_longitude double precision;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table nexta_config enable row level security;
alter table nexta_entregas enable row level security;

-- nexta_config: SEM policy para `authenticated` — a tabela guarda o client_secret e é
-- acessada exclusivamente pelos route handlers (service_role, que ignora RLS). O painel
-- lê/escreve via /api/admin/nexta/config, que nunca devolve o segredo.

-- nexta_entregas: o painel PRECISA de select (realtime do despacho assina esta tabela).
-- Escrita é só do servidor (webhook/rotas admin), por isso a policy é só de leitura.
create policy "Tenant members read nexta_entregas"
  on nexta_entregas for select
  using (restaurante_id = auth_restaurante_id());

grant select on nexta_entregas to authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Mesma publicação de pedidos/entregadores (0003): a RLS acima garante que cada loja
-- só recebe os próprios eventos.
alter publication supabase_realtime add table nexta_entregas;
