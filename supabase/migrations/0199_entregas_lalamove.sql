-- 0199 — Entregas Lalamove (18/10/2026): chamar um entregador da Lalamove pelo Menuzia, para todas as lojas.
--
-- Estrutura por PROVEDOR de entrega (coluna `provedor`), para depois plugar outros (Borzo…) sem tabela nova.
-- Só a Lalamove existe agora.
--   · entregas_provedor_config: as chaves da conta Lalamove DA LOJA (cada loja paga a própria Lalamove), cifradas
--     com AES-256-GCM (lib/pagamentos/cripto.ts, chave PAGAMENTOS_CHAVE do Coolify). Sem policy para `authenticated`:
--     só o servidor lê; a tela recebe só os 4 últimos caracteres da chave.
--   · entregas_provedor: uma corrida por pedido (status, preço, entregador, link de rastreio, eventos do webhook).
--     O painel lê (realtime do Kanban); só o servidor escreve.
--   · módulo 'entregas_lalamove' em loja_modulos: liberado em todas as lojas (regra de 16/10: tudo para todas; o
--     Super Admin liga/desliga por loja).
-- O status do pedido NÃO ganha valor novo: a Lalamove move o pedido pelos status que já existem
-- (pronto → em_rota na coleta → entregue), sempre pelo webhook + consulta à API.

create table if not exists public.entregas_provedor_config (
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  provedor text not null default 'lalamove' check (provedor in ('lalamove')),
  ativo boolean not null default false,
  ambiente text not null default 'sandbox' check (ambiente in ('sandbox', 'producao')),
  api_key_cifrada text,
  api_secret_cifrada text,
  -- Só os 4 últimos da chave pública (pk_…), para a tela mostrar "••••abcd".
  api_key_final text not null default '',
  -- Cidade (UN/LOCODE devolvido por GET /v3/cities) e tipo de veículo escolhidos no "Testar conexão".
  cidade_locode text not null default '',
  cidade_nome text not null default '',
  servico text not null default 'MOTORCYCLE',
  -- Slug secreto na URL do webhook (identifica a loja). Nunca é regerado depois do 1º save.
  webhook_token text not null unique default gen_random_uuid()::text,
  webhook_registrado_em timestamptz,
  atualizado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (restaurante_id, provedor)
);
alter table public.entregas_provedor_config enable row level security;
revoke all on public.entregas_provedor_config from anon, authenticated;
create trigger entregas_provedor_config_touch before update on public.entregas_provedor_config
  for each row execute function touch_atualizado_em();

create table if not exists public.entregas_provedor (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  provedor text not null default 'lalamove',
  ambiente text not null default 'sandbox',
  -- orderId do lado da Lalamove; quotationId da cotação confirmada.
  externo_id text,
  cotacao_id text,
  -- Status da Lalamove: ASSIGNING_DRIVER, ON_GOING, PICKED_UP, COMPLETED, CANCELED, REJECTED, EXPIRED.
  status text not null default 'ASSIGNING_DRIVER',
  preco numeric(10, 2),
  moeda text not null default 'BRL',
  distancia_m integer,
  share_link text,
  motorista_id text,
  motorista_nome text,
  motorista_telefone text,
  motorista_placa text,
  -- Avisos ao cliente (link de rastreio) e lançamento no Financeiro: uma vez só.
  cliente_avisado_em timestamptz,
  custo_lancado_em timestamptz,
  cancelado_por_nome text,
  erro text,
  eventos jsonb not null default '[]'::jsonb,
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists entregas_provedor_loja_idx on public.entregas_provedor (restaurante_id, criado_em desc);
create index if not exists entregas_provedor_pedido_idx on public.entregas_provedor (pedido_id);
create unique index if not exists entregas_provedor_externo_idx on public.entregas_provedor (provedor, externo_id) where externo_id is not null;
-- No máximo UMA corrida ativa por pedido (dois cliques não viram duas corridas).
create unique index if not exists entregas_provedor_ativa_por_pedido on public.entregas_provedor (pedido_id)
  where status in ('ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP');
create trigger entregas_provedor_touch before update on public.entregas_provedor
  for each row execute function touch_atualizado_em();

alter table public.entregas_provedor enable row level security;
create policy "Loja lê as próprias corridas" on public.entregas_provedor for select to authenticated
  using (restaurante_id = auth_restaurante_id());
grant select on public.entregas_provedor to authenticated;
alter publication supabase_realtime add table public.entregas_provedor;

-- Módulo (0176): a lista fechada do CHECK ganha o novo módulo.
alter table public.loja_modulos drop constraint if exists loja_modulos_modulo_check;
alter table public.loja_modulos add constraint loja_modulos_modulo_check
  check (modulo in ('financeiro', 'agente_ia', 'disparos', 'entregas_lalamove'));
insert into public.loja_modulos (restaurante_id, modulo, liberado, alterado_por)
select r.id, 'entregas_lalamove', true, 'Migração 0199' from public.restaurantes r
on conflict (restaurante_id, modulo) do nothing;
