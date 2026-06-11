-- "Mais vendido" highlight flag, shown to customers as a highlight tag that
-- nudges them toward the items the restaurant most wants to sell.
alter table itens_cardapio add column mais_vendido boolean not null default false;

-- How the storefront presents the menu: big category-style item cards
-- ("categoria") or a compact list view ("lista").
alter table restaurantes
  add column layout_cardapio text not null default 'categoria'
  check (layout_cardapio in ('categoria', 'lista'));
