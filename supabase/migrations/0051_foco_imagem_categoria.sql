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
comment on column grupos_cardapio.imagem_foco_x is
  'Ponto de foco horizontal da foto da categoria, 0-100. 50 = centro (comportamento padrão).';
comment on column grupos_cardapio.imagem_foco_y is
  'Ponto de foco vertical da foto da categoria, 0-100. 50 = centro (comportamento padrão).';

-- ----------------------------------------------------------------------------
-- Terceiro modo de exibição do cardápio: 'gaveta'.
--
-- A 0007 criou `check (layout_cardapio in ('categoria','lista'))` e essa
-- constraint está viva em produção. Sem derrubá-la, salvar 'gaveta' é rejeitado
-- pelo Postgres com 23514 e o modo fica inalcançável — o lojista veria um erro
-- genérico de conexão e perderia as outras edições não salvas do formulário,
-- porque `layout_cardapio` viaja no mesmo `atualizarConfigLoja` que nome,
-- endereço, horários, banners e taxas.
--
-- Mesmo padrão de drop+add já usado na 0044 (status_loja) e na 0050
-- (pizza_calculo_preco): idempotente e sem janela em que a coluna fica sem
-- validação de valor.
-- ----------------------------------------------------------------------------
alter table restaurantes
  drop constraint if exists restaurantes_layout_cardapio_check;

alter table restaurantes
  add constraint restaurantes_layout_cardapio_check
  check (layout_cardapio in ('categoria', 'lista', 'gaveta'));
