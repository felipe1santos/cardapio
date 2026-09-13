-- ============================================================================
-- Segunda foto da categoria: a que abre no topo da ficha do produto.
--
-- A `imagem_url` da 0051 é a foto do CARTÃO da categoria na grade do modo
-- gaveta — um recorte 5:2, largo e baixo. Quando a categoria tem um item só, a
-- vitrine abre a ficha direto e usava essa mesma imagem no topo, que ali é um
-- retrato (≈1,1:1 no celular). A mesma arte não serve bem às duas formas, e o
-- ponto de foco sozinho não resolve: o que sobra de um 5:2 esticado num
-- retrato é sempre pouco.
--
-- Então a ficha ganha foto e foco próprios. NULL = sem foto própria, e a ficha
-- cai na foto do cartão exatamente como faz hoje — aplicar esta migration não
-- muda a aparência de nenhuma loja.
-- ============================================================================

alter table grupos_cardapio
  add column if not exists imagem_ficha_url text,
  add column if not exists imagem_ficha_foco_x numeric(5,2) not null default 50,
  add column if not exists imagem_ficha_foco_y numeric(5,2) not null default 50;

comment on column grupos_cardapio.imagem_ficha_url is
  'Foto do topo da ficha quando a categoria abre direto (modo gaveta, categoria de 1 item). NULL = usa imagem_url.';
comment on column grupos_cardapio.imagem_ficha_foco_x is
  'Ponto de foco horizontal da foto da ficha, 0-100. 50 = centro (comportamento padrão).';
comment on column grupos_cardapio.imagem_ficha_foco_y is
  'Ponto de foco vertical da foto da ficha, 0-100. 50 = centro (comportamento padrão).';
