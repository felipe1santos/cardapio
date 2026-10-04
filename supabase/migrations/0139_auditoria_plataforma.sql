-- 0139 — Auditoria das ações do superadmin (Painel da plataforma).
--
-- `eventos_auditoria` exige uma loja (restaurante_id NOT NULL) e o pré-cadastro de um cliente
-- ainda não tem loja. Esta tabela registra QUEM (e-mail do superadmin) fez O QUÊ na plataforma:
-- pré-cadastrar, remover pré-cadastro, bloquear/desbloquear, alterar validade, excluir dados,
-- piloto de impressão. Só o service_role lê e grava (sem políticas), pelas Server Actions do
-- /superadmin que conferem o superadmin no servidor.
--
-- Nada muda em contas existentes. `config_plataforma` (0040) fica como está: o cadastro
-- automático deixa de existir no código e a coluna só não é mais lida.

create table if not exists public.auditoria_plataforma (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  ator_email text not null check (length(ator_email) between 3 and 254),
  acao text not null check (acao ~ '^[a-z_]+\.[a-z_]+$' and length(acao) <= 60),
  restaurante_id uuid references public.restaurantes (id) on delete set null,
  usuario_id uuid,
  alvo text check (alvo is null or length(alvo) <= 200),
  dados jsonb not null default '{}'::jsonb
);
create index if not exists auditoria_plataforma_criado_em_idx on public.auditoria_plataforma (criado_em desc);
alter table public.auditoria_plataforma enable row level security;
revoke all on public.auditoria_plataforma from public, anon, authenticated;
