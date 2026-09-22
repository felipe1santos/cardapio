-- 0077 — Banner promocional: várias fotos em carrossel, ou um aviso em texto.
--
-- Até aqui o banner promocional era UMA imagem (`banner_promocional_url`). A loja que
-- quer anunciar duas promoções tinha de escolher uma, e a loja que só quer dar um recado
-- ("hoje fechamos às 22h", "pizza em dobro na terça") precisava desenhar uma imagem para
-- escrever uma frase.
--
-- Duas colunas novas, as duas opcionais:
--
--   banner_promo_urls  — lista de imagens. Com mais de uma, a vitrine passa sozinha.
--   banner_promo_texto — aviso em texto, para quem não quer imagem nenhuma.
--
-- ADITIVA, e de propósito: `banner_promocional_url` FICA e continua valendo. Loja que já
-- tem banner não precisa fazer nada — a vitrine lê a lista nova e, se estiver vazia, cai
-- na coluna antiga. Converter o dado aqui (mover a URL para o array e limpar a coluna)
-- derrubaria a vitrine de quem estivesse com a versão anterior do código no ar durante o
-- deploy, que é exatamente o erro que já nos custou uma loja fora do ar.
--
-- A precedência é resolvida no código (lib/banner-promocional.ts), não no banco: assim
-- ela é testável sem subir Postgres e vale igual na vitrine e no painel.

alter table public.restaurantes
  add column if not exists banner_promo_urls text[] not null default '{}',
  add column if not exists banner_promo_texto text;

comment on column public.restaurantes.banner_promo_urls is
  'Imagens do banner promocional da vitrine. Mais de uma = carrossel automático. Vazio = usa banner_promocional_url (legado) ou o texto.';
comment on column public.restaurantes.banner_promo_texto is
  'Aviso em texto no lugar do banner promocional, para quem não quer imagem. Null = sem aviso.';

-- Teto de imagens: o carrossel é uma faixa de ~140px no topo do cardápio, não uma
-- galeria. Mais que isso vira peso de download sem ninguém chegar a ver.
alter table public.restaurantes drop constraint if exists restaurantes_banner_promo_urls_max;
alter table public.restaurantes add constraint restaurantes_banner_promo_urls_max
  check (array_length(banner_promo_urls, 1) is null or array_length(banner_promo_urls, 1) <= 6);

-- O aviso é uma frase, não um texto corrido: cabe em duas linhas na faixa.
alter table public.restaurantes drop constraint if exists restaurantes_banner_promo_texto_tam;
alter table public.restaurantes add constraint restaurantes_banner_promo_texto_tam
  check (banner_promo_texto is null or char_length(banner_promo_texto) <= 140);

-- ═══ A vitrine precisa LER as colunas novas ═════════════════════════════════
-- Desde a 0055, `anon` não tem SELECT na tabela: tem SELECT em uma lista fechada
-- de colunas. Coluna nova que a vitrine lê precisa ser concedida aqui, senão o
-- cardápio quebra para o visitante não logado — e só para ele, o que é o tipo de
-- falha que passa despercebida em teste feito com sessão de admin.
grant select (banner_promo_urls, banner_promo_texto) on public.restaurantes to anon;
