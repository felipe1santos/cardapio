-- 0187 — Configuração da plataforma (12/10/2026): valores que o Super Admin edita, começando pela cotação do dólar da tela
-- "Gasto por loja". Só o servidor (service_role) lê e grava: RLS ligada e nenhuma política para anon/authenticated.
-- Rollback: drop table public.plataforma_config;
create table if not exists public.plataforma_config (
  chave text primary key check (chave ~ '^[a-z_]{2,60}$'),
  valor jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.plataforma_config enable row level security;
revoke all on table public.plataforma_config from anon, authenticated;
