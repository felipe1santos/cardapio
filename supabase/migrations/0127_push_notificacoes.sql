-- 0127 — Notificações push no app do cardápio (PWA), por loja (2026-10-01).
--
-- Flag por loja `restaurantes.push_liberado` (DESLIGADA por padrão em todas). Assinaturas por loja
-- (endpoint único por loja: a vitrine registra um service worker com escopo /loja/<slug>), fila +
-- histórico de envios, configuração e automações da loja, notificações avulsas.
-- Tudo só pelo servidor (service role): RLS ligado e sem políticas. O painel usa rotas de API que
-- conferem a loja do usuário.
-- Rollback: docs/rollback/0127_push_notificacoes.down.sql

alter table public.restaurantes
  add column if not exists push_liberado boolean not null default false;
comment on column public.restaurantes.push_liberado is
  'Notificações push do app do cardápio liberadas para a loja (0127). Desligado por padrão.';

create table public.push_config (
  restaurante_id uuid primary key references public.restaurantes (id) on delete cascade,
  limite_dia smallint not null default 1 check (limite_dia between 0 and 3),
  limite_semana smallint not null default 3 check (limite_semana between 0 and 10),
  -- Minutos antes de abrir em que o marketing já pode sair (0–120).
  antecedencia_min smallint not null default 30 check (antecedencia_min between 0 and 120),
  -- Botão "Enviar notificação de teste para mim": só para assinaturas deste telefone.
  telefone_teste text,
  -- Última foto do que dispara por mudança (frete grátis geral/bairros).
  estado jsonb not null default '{}'::jsonb,
  ultima_avaliacao timestamptz,
  atualizado_em timestamptz not null default now()
);

create table public.push_automacoes (
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  tipo text not null check (tipo in ('loja_abriu', 'recompra', 'inativo', 'item_novo', 'cupom_novo', 'frete_gratis', 'fidelidade', 'status_pedido')),
  ativo boolean not null default false,
  titulo text not null default '' check (char_length(titulo) <= 60),
  texto text not null default '' check (char_length(texto) <= 200),
  params jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (restaurante_id, tipo)
);

create table public.push_assinaturas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  cliente_id uuid references public.clientes (id) on delete set null,
  cliente_telefone text,
  endpoint text not null check (char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  plataforma text not null default 'outro' check (plataforma in ('android', 'ios', 'desktop', 'outro')),
  navegador text not null default '' check (char_length(navegador) <= 40),
  instalado boolean not null default false,
  categorias text[] not null default '{pedido,promocoes,novidades,fidelidade}',
  consentimento_em timestamptz not null default now(),
  ultimo_sucesso_em timestamptz,
  falhas_seguidas smallint not null default 0,
  status text not null default 'ativa' check (status in ('ativa', 'invalida', 'cancelada')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (restaurante_id, endpoint)
);
create index push_assinaturas_loja_tel_idx on public.push_assinaturas (restaurante_id, cliente_telefone) where status = 'ativa';

create table public.push_avulsas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 60),
  texto text not null check (char_length(texto) between 1 and 200),
  imagem_url text,
  -- {tipo: 'cardapio'|'produto'|'cupom'|'promocoes', id?, codigo?}
  destino jsonb not null default '{"tipo":"cardapio"}'::jsonb,
  -- {tipo: 'todos'|'recentes'|'inativos'|'fidelidade', dias?}
  publico jsonb not null default '{"tipo":"todos"}'::jsonb,
  agendado_em timestamptz,
  status text not null default 'agendada' check (status in ('agendada', 'enviando', 'concluida', 'cancelada')),
  total_previsto integer not null default 0,
  criado_por uuid,
  criado_por_nome text,
  criado_em timestamptz not null default now()
);
create index push_avulsas_pendentes_idx on public.push_avulsas (status, agendado_em) where status in ('agendada', 'enviando');

create table public.push_envios (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  assinatura_id uuid not null references public.push_assinaturas (id) on delete cascade,
  -- Quem conta para limite/dedup: o telefone do cliente ou, sem telefone, a própria assinatura.
  destinatario text not null,
  origem text not null check (origem in ('automacao', 'avulsa', 'status', 'teste')),
  tipo text not null,
  categoria text not null check (categoria in ('pedido', 'promocoes', 'novidades', 'fidelidade')),
  avulsa_id uuid references public.push_avulsas (id) on delete set null,
  chave_dedup text,
  payload jsonb not null,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'invalida', 'descartado')),
  tentativas smallint not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  erro text,
  enviado_em timestamptz,
  clicado_em timestamptz,
  pedido_id uuid references public.pedidos (id) on delete set null,
  pedido_em timestamptz,
  criado_em timestamptz not null default now()
);
create index push_envios_fila_idx on public.push_envios (status, proxima_tentativa_em) where status = 'pendente';
create index push_envios_dest_idx on public.push_envios (restaurante_id, destinatario, criado_em desc);
-- Sem WHERE: o insert usa ON CONFLICT (assinatura_id, chave_dedup) DO NOTHING. Chave nula não conflita.
create unique index push_envios_dedup_idx on public.push_envios (assinatura_id, chave_dedup);
create index push_envios_avulsa_idx on public.push_envios (avulsa_id) where avulsa_id is not null;

-- Reserva atômica de um lote da fila (vários crons ao mesmo tempo não pegam o mesmo envio):
-- empurra a próxima tentativa 5 min para frente e devolve os ids. Quem processa grava o resultado.
create or replace function public.push_reservar_envios(p_limite integer)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  update public.push_envios e
     set proxima_tentativa_em = now() + interval '5 minutes', tentativas = e.tentativas + 1
   where e.id in (
     select id from public.push_envios
      where status = 'pendente' and proxima_tentativa_em <= now()
      order by proxima_tentativa_em
      limit greatest(1, least(p_limite, 500))
      for update skip locked)
  returning e.id
$$;
revoke all on function public.push_reservar_envios(integer) from public, anon, authenticated;

alter table public.push_config enable row level security;
alter table public.push_automacoes enable row level security;
alter table public.push_assinaturas enable row level security;
alter table public.push_avulsas enable row level security;
alter table public.push_envios enable row level security;

-- Só o servidor: nenhuma permissão para anon/authenticated.
revoke all on public.push_config, public.push_automacoes, public.push_assinaturas, public.push_avulsas, public.push_envios from anon, authenticated;
