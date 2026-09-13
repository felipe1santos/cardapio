-- ============================================================================
-- Ponto de foco de imagem (capa da loja e foto de categoria) + foto de
-- categoria, que o modo de exibição "gaveta" consome.
--
-- O foco é um par de percentuais consumido como `object-position: X% Y%`.
-- 50/50 é exatamente o `object-cover` centralizado que a vitrine faz hoje,
-- então aplicar esta migration NÃO muda a aparência de nenhuma loja já
-- cadastrada. Quem arrastar a mira no painel é que muda.
--
-- `numeric(5,2)` porque o valor vem de uma fração da largura do elemento:
-- duas casas dão precisão de sub-pixel em qualquer tela e cabem folgado.
-- ============================================================================

alter table restaurantes
  add column if not exists banner_foco_x numeric(5,2) not null default 50,
  add column if not exists banner_foco_y numeric(5,2) not null default 50;

comment on column restaurantes.banner_foco_x is
  'Ponto de foco horizontal da capa, 0-100. 50 = centro (comportamento padrão).';
comment on column restaurantes.banner_foco_y is
  'Ponto de foco vertical da capa, 0-100. 50 = centro (comportamento padrão).';

-- Foto da categoria: só o modo "gaveta" exibe. NULL = categoria sem foto, que
-- é o que trava a escolha desse modo no painel.
alter table grupos_cardapio
  add column if not exists imagem_url text,
  add column if not exists imagem_foco_x numeric(5,2) not null default 50,
  add column if not exists imagem_foco_y numeric(5,2) not null default 50;

comment on column grupos_cardapio.imagem_url is
  'Foto do cartão da categoria no modo gaveta. NULL = sem foto.';
