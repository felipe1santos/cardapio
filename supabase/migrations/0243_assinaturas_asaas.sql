-- Assinatura paga via Asaas (02/11/2026, docs/ASSINATURA-ASAAS.md).
-- Uma assinatura por usuário dono. Só o service role lê/grava: nenhuma policy nem grant para anon/authenticated
-- (o painel do lojista não lê isto; o Super Admin e o webhook usam a chave de serviço). Aditivo e idempotente.

create table if not exists public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references public.usuarios(id) on delete cascade,
  restaurante_id uuid references public.restaurantes(id) on delete set null,
  plano text not null check (plano in ('basico', 'completo')),
  valor numeric(10,2) not null check (valor > 0),
  documento text not null,
  asaas_cliente_id text not null,
  asaas_assinatura_id text not null unique,
  -- aguardando = criada, 1ª cobrança não paga; em_dia; atrasada = cobrança vencida; cancelada = removida/estornada no Asaas.
  status text not null default 'aguardando' check (status in ('aguardando', 'em_dia', 'atrasada', 'cancelada')),
  ultima_cobranca_id text,
  ultima_fatura_url text,
  proximo_vencimento date,
  pago_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table public.assinaturas is 'Assinatura Asaas do lojista (docs/ASSINATURA-ASAAS.md). Só service role.';
alter table public.assinaturas enable row level security;
revoke all on public.assinaturas from anon, authenticated;

-- Idempotência do webhook: o id do evento (evt_...) entra aqui ANTES de qualquer efeito; repetido = 23505 = ignorar.
create table if not exists public.asaas_eventos (
  id text primary key,
  evento text not null,
  cobranca_id text,
  assinatura_id text,
  resultado text,
  recebido_em timestamptz not null default now()
);
alter table public.asaas_eventos enable row level security;
revoke all on public.asaas_eventos from anon, authenticated;

-- Retenção: eventos com mais de 90 dias podem ser apagados pelo cron de retenção (lib/retencao). Índice para isso.
create index if not exists asaas_eventos_recebido_em_idx on public.asaas_eventos (recebido_em);
