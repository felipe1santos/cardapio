-- ============================================================================
-- Pizza meio a meio: quantos sabores cabem em cada tamanho e como a loja
-- calcula o preço quando o cliente escolhe mais de um.
--
-- Aditiva e idempotente. `max_sabores` nasce 1 — exatamente o que o Menuzia
-- faz hoje (um sabor por pizza) — então nenhuma loja já cadastrada muda de
-- comportamento ao aplicar esta migration. Quem quiser meio a meio sobe o
-- número no admin, tamanho a tamanho.
-- ============================================================================

alter table tamanhos_padrao_pizza
  add column if not exists max_sabores int not null default 1;

comment on column tamanhos_padrao_pizza.max_sabores is
  'Quantos sabores o cliente pode escolher nesse tamanho. 1 = sem meio a meio.';

-- Regra de preço quando há mais de um sabor:
--   media = média aritmética dos sabores escolhidos (padrão de mercado)
--   maior = o preço do sabor mais caro
alter table restaurantes
  add column if not exists pizza_calculo_preco text not null default 'media';

alter table restaurantes
  drop constraint if exists restaurantes_pizza_calculo_preco_check;

alter table restaurantes
  add constraint restaurantes_pizza_calculo_preco_check
  check (pizza_calculo_preco in ('media', 'maior'));
