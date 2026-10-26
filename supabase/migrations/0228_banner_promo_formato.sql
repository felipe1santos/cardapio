-- 0228 — Formato do banner promocional (26/10/2026, pedido do dono), em Ajustes › Banner promocional:
--   '3:2' (horizontal, o de sempre), '1:1' (quadrado), '4:5' (post) ou '9:16' (stories — vídeo em pé sem sobra).
-- Aditiva e neutra: default '3:2' = como hoje para todas as lojas. Nenhuma linha é convertida.
-- Rollback: alter table public.restaurantes drop column banner_promo_formato;

alter table public.restaurantes add column if not exists banner_promo_formato text not null default '3:2'
  check (banner_promo_formato in ('3:2', '1:1', '4:5', '9:16'));

-- restaurantes tem grant por coluna (0080): a vitrine (anon) lê; o painel (authenticated) grava a própria loja (RLS).
grant select (banner_promo_formato) on public.restaurantes to anon, authenticated;
grant update (banner_promo_formato) on public.restaurantes to authenticated;
