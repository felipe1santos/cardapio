-- 0138 — API de Conversões do Meta (token só no servidor) e navegador/aparelho no rastreio da vitrine.
--
-- 1. integracoes_segredos: o token da API de Conversões NÃO fica em `restaurantes` (cujas colunas
--    públicas a vitrine lê). Tabela sem nenhuma política: só o service_role lê e grava, pelas rotas
--    do painel que conferem a sessão (dono). O painel nunca recebe o token de volta, só "configurado".
-- 2. vitrine_eventos.navegador / sistema: em qual navegador o cliente estava (Instagram, Facebook,
--    WhatsApp, Chrome, Safari…) e o sistema (Android, iOS…). Só a categoria, nunca o user-agent inteiro.

create table if not exists public.integracoes_segredos (
  restaurante_id uuid primary key references public.restaurantes (id) on delete cascade,
  meta_capi_token text check (meta_capi_token is null or length(meta_capi_token) between 20 and 500),
  meta_test_event_code text check (meta_test_event_code is null or meta_test_event_code ~ '^[A-Za-z0-9]{3,20}$'),
  atualizado_em timestamptz not null default now(),
  atualizado_por_nome text
);
alter table public.integracoes_segredos enable row level security;
revoke all on public.integracoes_segredos from public, anon, authenticated;

alter table public.vitrine_eventos add column if not exists navegador text;
alter table public.vitrine_eventos add column if not exists sistema text;
alter table public.vitrine_eventos drop constraint if exists vitrine_eventos_navegador_check;
alter table public.vitrine_eventos add constraint vitrine_eventos_navegador_check check (navegador is null or length(navegador) <= 20);
alter table public.vitrine_eventos drop constraint if exists vitrine_eventos_sistema_check;
alter table public.vitrine_eventos add constraint vitrine_eventos_sistema_check check (sistema is null or length(sistema) <= 20);
