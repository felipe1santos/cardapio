-- Variante mobile da capa da loja.
--
-- A capa é o elemento de LCP da vitrine. Medido com throttling real na Estância
-- Burger: 190 KB levando 3,1 s para baixar, sendo que numa viewport de 390 px o
-- Lighthouse aponta 171 KB de desperdício — a imagem é servida em 1600 px para
-- ser exibida em 390.
--
-- Esta coluna guarda uma versão de ~800 px do mesmo banner, oferecida por
-- srcset. O desktop continua recebendo a de 1600 px.
--
-- Aditiva, nullable e idempotente. `banner_url` não muda de significado, e
-- enquanto esta coluna for NULL o srcset simplesmente não é emitido — a vitrine
-- serve a capa cheia, como sempre serviu.

alter table restaurantes add column if not exists banner_mobile_url text;

comment on column restaurantes.banner_mobile_url is
  'Capa ~800px em WebP para telas pequenas (srcset). NULL = servir só banner_url.';
