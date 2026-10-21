-- 0213 — Vídeo em loop na vitrine (21/10/2026).
-- itens_cardapio.video: {url, capa, home, carrossel, posicao} — card da home e/ou carrossel da ficha. itens_cardapio
--   tem grant de tabela para anon/authenticated (0003), então a coluna já vale para a vitrine e o painel.
-- restaurantes.banner_promo_video: {url, capa, posicao} — slide do banner promocional. restaurantes tem grant POR
--   COLUNA (0055/0080): anon lê (vitrine), authenticated lê e grava (Perfil). Sem isso a vitrine e o painel quebram.
-- Aditiva. Rollback: alter table … drop column video / banner_promo_video.

alter table public.itens_cardapio add column if not exists video jsonb;
alter table public.itens_cardapio drop constraint if exists itens_cardapio_video_check;
alter table public.itens_cardapio add constraint itens_cardapio_video_check
  check (video is null or (jsonb_typeof(video) = 'object' and video ? 'url' and video ? 'capa'));

alter table public.restaurantes add column if not exists banner_promo_video jsonb;
alter table public.restaurantes drop constraint if exists restaurantes_banner_promo_video_check;
alter table public.restaurantes add constraint restaurantes_banner_promo_video_check
  check (banner_promo_video is null or (jsonb_typeof(banner_promo_video) = 'object' and banner_promo_video ? 'url' and banner_promo_video ? 'capa'));

grant select (banner_promo_video) on public.restaurantes to anon, authenticated;
grant update (banner_promo_video) on public.restaurantes to authenticated;
