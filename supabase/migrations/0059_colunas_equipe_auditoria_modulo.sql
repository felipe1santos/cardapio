-- Colunas e tabelas que a etapa A precisa. Tudo aditivo e idempotente.
--
-- Vem ANTES das funções (0060) porque `auth_papel()` e `auth_restaurante_id()` leem
-- `usuarios.desativado_em`.

-- ── Equipe ───────────────────────────────────────────────────────────────────
-- `desativado_em` é a alavanca da LOJA. Não reuso `autorizado`, que é a alavanca da
-- PLATAFORMA (o superadmin corta loja inadimplente): misturar as duas autoridades no
-- mesmo booleano faria o dono reativar quem o superadmin bloqueou.
alter table public.usuarios add column if not exists desativado_em timestamptz;
alter table public.usuarios add column if not exists criado_por uuid references public.usuarios(id);

comment on column public.usuarios.desativado_em is
  'Desativação pelo próprio estabelecimento. `autorizado` continua sendo a alavanca da plataforma.';

-- ── Rastreabilidade do lançamento ────────────────────────────────────────────
-- `criado_por_nome` é snapshot: o nome tem que sobreviver à saída do funcionário.
-- Preenchidos pelas rotas autenticadas a partir da SESSÃO, nunca do corpo da requisição.
alter table public.pedidos add column if not exists criado_por uuid references public.usuarios(id);
alter table public.pedidos add column if not exists criado_por_nome text;

-- ── Feature flag do módulo ───────────────────────────────────────────────────
-- Default false: nenhuma loja percebe mudança até ligar manualmente. Governa SÓ a
-- superfície nova (seção Mesas e Comandas, /mesa/[token], painel do garçom) — o PDV
-- atual NÃO consulta esta flag e segue funcionando com ela em false, inclusive na loja
-- que já usa mesas e tem comandas abertas.
alter table public.restaurantes add column if not exists modulo_mesas_ativo boolean not null default false;

comment on column public.restaurantes.modulo_mesas_ativo is
  'Liga a seção Mesas e Comandas. Não afeta o PDV atual, que é independente desta flag.';

-- ── Auditoria ────────────────────────────────────────────────────────────────
create table if not exists public.eventos_auditoria (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  -- 'sistema' cobre evento sem pessoa por trás (cron, webhook) sem inventar usuário.
  ator text not null default 'usuario',
  usuario_id uuid references public.usuarios(id) on delete set null,
  usuario_nome text not null,
  acao text not null,
  entidade text not null,
  entidade_id uuid,
  dados jsonb,
  criado_em timestamptz not null default now()
);

alter table public.eventos_auditoria drop constraint if exists eventos_auditoria_ator_check;
alter table public.eventos_auditoria add constraint eventos_auditoria_ator_check
  check (ator in ('usuario', 'sistema'));

create index if not exists idx_auditoria_restaurante
  on public.eventos_auditoria (restaurante_id, criado_em desc);

alter table public.eventos_auditoria enable row level security;

comment on table public.eventos_auditoria is
  'Append-only para a aplicação: escrita só por service_role, leitura só de gestor (ver 0062).';
