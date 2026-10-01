-- 0118 — Botões de link nas campanhas (Fase 4, 2026-09-30).
--
-- Até 2 botões {texto, url https}. Pela conexão das lojas (WhatsApp Web, QR Code) eles
-- saem como links no texto, um por linha — ver lib/mensageria/campanhas.ts. Aditiva.
-- Rollback: docs/rollback/0118_campanhas_botoes.down.sql
alter table public.campanhas add column if not exists botoes jsonb not null default '[]'::jsonb;
alter table public.campanhas drop constraint if exists campanhas_botoes_check;
alter table public.campanhas add constraint campanhas_botoes_check
  check (jsonb_typeof(botoes) = 'array' and jsonb_array_length(botoes) <= 2);
comment on column public.campanhas.botoes is 'Botões de link [{texto, url}] (máx. 2). Enviados como links no texto.';
