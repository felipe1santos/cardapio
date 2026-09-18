-- Etapa G — disponibilidade por canal no MESMO item de cardápio.
--
-- Regra do projeto: **um catálogo só**. Mesa e delivery leem `itens_cardapio`,
-- `grupos_cardapio`, `item_complementos`, `tamanhos_item` e `pizza_sabores` — as mesmas
-- linhas. Nada é copiado, replicado nem sincronizado para tabela de mesa.
--
-- Quando a loja quiser separar (o combo de delivery que não faz sentido no salão, a
-- porção que só sai na mesa), o controle é uma coluna no PRÓPRIO item, não um cadastro
-- paralelo. Foto, nome, descrição, preço, promoção, complementos, obrigatórios,
-- tamanhos, sabores e dias continuam com uma fonte de verdade.
--
-- Default `true` nas duas colunas, de propósito: toda loja existente segue exibindo
-- todos os itens nos dois canais, sem recadastro e sem mudança silenciosa. Feature de
-- gating começa preservando o comportamento de quem já está rodando.

alter table public.itens_cardapio
  add column if not exists disponivel_delivery boolean not null default true;

alter table public.itens_cardapio
  add column if not exists disponivel_salao boolean not null default true;

comment on column public.itens_cardapio.disponivel_delivery is
  'Item aparece na vitrine /loja/[slug] e pode ser pedido no delivery/retirada. Default true: '
  'nenhum item existente sai do ar por causa desta coluna.';

comment on column public.itens_cardapio.disponivel_salao is
  'Item aparece em /mesa/[token] e pode ser lançado pelo garçom. Default true.';

-- Item fora dos dois canais não existe para ninguém e só geraria confusão ("cadastrei e
-- não aparece"). Quem quer tirar do ar usa `status` (pausado/esgotado), que é o controle
-- de disponibilidade de sempre.
alter table public.itens_cardapio drop constraint if exists itens_cardapio_canal_check;
alter table public.itens_cardapio add constraint itens_cardapio_canal_check
  check (disponivel_delivery or disponivel_salao);

-- Índices parciais: a vitrine e a mesa filtram por canal + status em toda carga.
create index if not exists idx_itens_canal_delivery
  on public.itens_cardapio (restaurante_id) where disponivel_delivery;
create index if not exists idx_itens_canal_salao
  on public.itens_cardapio (restaurante_id) where disponivel_salao;
