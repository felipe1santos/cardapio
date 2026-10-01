-- 0117 — Etiquetas do produto (vitrine, 2026-09-30).
--
-- Antes: uma etiqueta só por item (`tag`) + a estrela "Favorito" (`mais_vendido`).
-- Agora as etiquetas têm hierarquia:
--   principais (pílulas acima do nome, máx. 2): Mais pedido (= estrela, mais_vendido),
--     Novidade (novidade_ate: some sozinha depois da data), Edição limitada;
--   utilitárias (linha discreta acima do preço): Item promocional, Entrega grátis,
--     Serve X pessoas.
--
-- Aditiva: `tag` continua existindo e NÃO é alterada (o código lê as colunas novas e,
-- sem elas, ainda entende a etiqueta antiga). As colunas novas são preenchidas a partir
-- da `tag` de quem já tinha. `mais_vendido` também é marcada para quem tinha a etiqueta
-- 'mais_pedido' ou 'favorito' (o "Mais pedido 🔥" substitui o "Favorito").
-- Rollback: docs/rollback/0117_etiquetas_produto.down.sql

alter table public.itens_cardapio
  add column if not exists novidade_ate timestamptz,
  add column if not exists edicao_limitada boolean not null default false,
  add column if not exists item_promocional boolean not null default false,
  add column if not exists entrega_gratis boolean not null default false,
  add column if not exists serve_pessoas smallint;

alter table public.itens_cardapio drop constraint if exists itens_cardapio_serve_pessoas_check;
alter table public.itens_cardapio add constraint itens_cardapio_serve_pessoas_check
  check (serve_pessoas is null or serve_pessoas between 1 and 50);

comment on column public.itens_cardapio.novidade_ate is 'Etiqueta "Novidade" até esta data (padrão: 30 dias após marcar). Null = não é novidade.';
comment on column public.itens_cardapio.edicao_limitada is 'Etiqueta principal "Edição limitada".';
comment on column public.itens_cardapio.item_promocional is 'Etiqueta utilitária "Item promocional".';
comment on column public.itens_cardapio.entrega_gratis is 'Etiqueta utilitária "Entrega grátis" (o valor mínimo vem da regra da loja).';
comment on column public.itens_cardapio.serve_pessoas is 'Etiqueta utilitária "Serve X pessoas" (opcional).';

-- Quem já tinha etiqueta passa para as novas (sem mexer na `tag`).
update public.itens_cardapio set novidade_ate = now() + interval '30 days'
 where tag = 'novo' and novidade_ate is null;
update public.itens_cardapio set edicao_limitada = true where tag = 'edicao_limitada' and not edicao_limitada;
update public.itens_cardapio set item_promocional = true where tag = 'promocao' and not item_promocional;
update public.itens_cardapio set mais_vendido = true where tag in ('mais_pedido', 'favorito') and not mais_vendido;
