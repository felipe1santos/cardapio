-- 0123 — Aviso em texto da vitrine com cor e efeito (retoque visual, 2026-10-01).
-- Nulo = visual de sempre (cor do tema da loja, sem efeito). Aditiva; lojas atuais ficam no
-- padrão. Rollback: docs/rollback/0123_aviso_vitrine_cores.down.sql
alter table public.restaurantes
  add column if not exists aviso_cor_texto text,
  add column if not exists aviso_cor_fundo text,
  add column if not exists aviso_pulsar boolean not null default false;
alter table public.restaurantes drop constraint if exists restaurantes_aviso_cores_check;
alter table public.restaurantes add constraint restaurantes_aviso_cores_check check (
  (aviso_cor_texto is null or aviso_cor_texto ~ '^#[0-9A-Fa-f]{6}$')
  and (aviso_cor_fundo is null or aviso_cor_fundo ~ '^#[0-9A-Fa-f]{6}$')
);
-- restaurantes tem grant por coluna: a vitrine (anon) lê; o painel (authenticated) grava a própria loja (RLS).
grant select (aviso_cor_texto, aviso_cor_fundo, aviso_pulsar) on public.restaurantes to anon, authenticated;
grant update (aviso_cor_texto, aviso_cor_fundo, aviso_pulsar) on public.restaurantes to authenticated;
