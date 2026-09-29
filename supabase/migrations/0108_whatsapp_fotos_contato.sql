-- 0108 — Foto de perfil dos contatos na central de atendimento do WhatsApp.
--
-- Tabela própria (e NÃO colunas em whatsapp_conversas): whatsapp_conversas está no
-- Realtime, e cada foto buscada viraria um aviso para todo painel aberto (contador e lista
-- recarregando à toa). Aqui fica só o LINK da foto (a imagem mora no WhatsApp) e quando
-- foi buscado — o servidor renova no máximo a cada 3 dias, e só para quem aparece na tela.
--
-- Só o servidor lê e grava (service_role): o navegador recebe a foto pela API da central.
-- Rollback: docs/rollback/0108_whatsapp_fotos_contato.down.sql

create table if not exists public.whatsapp_contato_fotos (
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  telefone text not null check (telefone ~ '^[0-9]{10,15}$'),
  -- null = contato sem foto (ou foto escondida pela privacidade dele).
  url text check (url is null or (url ~ '^https://' and char_length(url) <= 2000)),
  buscada_em timestamptz not null default now(),
  primary key (restaurante_id, telefone)
);

alter table public.whatsapp_contato_fotos enable row level security;
revoke all on public.whatsapp_contato_fotos from anon, authenticated;
