-- Rollback da 0117. Voltar o CÓDIGO antes (ele seleciona as colunas novas).
-- A `tag` antiga nunca foi alterada, então nada se perde. Os itens que ganharam
-- mais_vendido=true por terem tag 'mais_pedido'/'favorito' continuam com a estrela.
alter table public.itens_cardapio drop constraint if exists itens_cardapio_serve_pessoas_check;
alter table public.itens_cardapio
  drop column if exists novidade_ate,
  drop column if exists edicao_limitada,
  drop column if exists item_promocional,
  drop column if exists entrega_gratis,
  drop column if exists serve_pessoas;
