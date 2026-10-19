-- 0200 — Edição de pedido pelo painel + solicitações do cliente pelo WhatsApp (18/10/2026).
-- Plano: docs/superpowers/plans/2026-10-18-edicao-pedido.md · decisões: docs/superpowers/specs/2026-10-18-edicao-pedido-decisoes.md
--
-- Tudo aditivo e com default seguro: pedido antigo não muda de comportamento (editado_em nulo, edicoes vazio,
-- diferenca_a_receber nulo). Item removido numa edição vira `pedido_itens.cancelado_em` (coluna da 0067), nunca delete.

-- ── Pedido: rastro das edições ─────────────────────────────────────────────────
alter table public.pedidos add column if not exists editado_em timestamptz;
alter table public.pedidos add column if not exists editado_por_nome text;
-- Histórico curto, append-only: [{ em, por, origem: 'painel'|'solicitacao', mudancas: ['−1× Coca 2L', ...] }]
alter table public.pedidos add column if not exists edicoes jsonb not null default '[]'::jsonb;
-- Pago online e o total subiu: a loja escolheu receber a diferença na entrega (R$). Nulo = nada a receber.
alter table public.pedidos add column if not exists diferenca_a_receber numeric(10,2);
-- A observação original do cliente, antes do bloco "PEDIDO ALTERADO" que a edição coloca na frente de `observacao`
-- (é esse campo que a comanda do Alfa 1 e o KDS já mostram — por isso o bloco vai nele, sem mexer no Assistente).
alter table public.pedidos add column if not exists observacao_original text;

-- ── Estorno parcial (Mercado Pago aceita `amount` no refund) ──────────────────
alter table public.pagamentos_online add column if not exists devolucao_valor numeric(10,2);
alter table public.pagamentos_online drop constraint if exists pagamentos_online_status_check;
-- A lista da 0148 + 'devolvido_parcial' (estorno de parte do valor; o pagamento continua "pago" pelo resto).
alter table public.pagamentos_online add constraint pagamentos_online_status_check
  check (status in ('pendente', 'pago', 'expirado', 'cancelado', 'a_devolver', 'devolvido', 'devolvido_parcial', 'verificacao_pendente', 'erro'));

-- ── Solicitações do cliente (robô e Agente de IA) ─────────────────────────────
create table if not exists public.pedido_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  origem text not null check (origem in ('robo', 'ia')),
  tipo text not null check (tipo in ('alterar', 'cancelar')),
  -- O que o cliente escreveu (acrescentado a cada mensagem nova enquanto a solicitação está pendente).
  texto text not null default '',
  -- Proposta estruturada pela IA (itens reais do cardápio, preço do servidor): o mesmo corpo que /editar aceita.
  proposta jsonb,
  status text not null default 'pendente' check (status in ('pendente', 'aplicada', 'recusada', 'cancelada')),
  motivo_recusa text,
  decidido_por_nome text,
  decidido_em timestamptz,
  -- 5 min sem resposta da loja: a conversa foi para o atendente (cron whatsapp).
  escalada_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists pedido_solicitacoes_loja_idx on public.pedido_solicitacoes (restaurante_id, status, criado_em desc);
create unique index if not exists pedido_solicitacoes_pendente_por_pedido on public.pedido_solicitacoes (pedido_id) where status = 'pendente';
create trigger pedido_solicitacoes_touch before update on public.pedido_solicitacoes
  for each row execute function touch_atualizado_em();

alter table public.pedido_solicitacoes enable row level security;
create policy "Loja lê as próprias solicitações" on public.pedido_solicitacoes for select to authenticated
  using (restaurante_id = auth_restaurante_id());
grant select on public.pedido_solicitacoes to authenticated;
alter publication supabase_realtime add table public.pedido_solicitacoes;
