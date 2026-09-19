-- 0074 — Ordem das CATEGORIAS no cardápio da mesa (QR).
--
-- A gestão escolhe em Ajustes › Mesas a ordem em que as categorias aparecem no trilho
-- do cardápio da mesa. Vale só para a mesa: o delivery continua com `posicao`, que é
-- ajustada no Cardápio. Null = depois das ordenadas, na ordem de sempre.
--
-- Aditiva, sem mudar dado existente. (A `itens_cardapio.posicao_mesa` de 0073 deixa de
-- ser usada pela tela — a ordem pedida é a das categorias —, mas fica: nenhuma coluna é
-- removida em produção.)

alter table public.grupos_cardapio
  add column if not exists posicao_mesa integer;

comment on column public.grupos_cardapio.posicao_mesa is
  'Ordem da categoria no cardápio da mesa (QR). Null = depois das ordenadas, na ordem de sempre.';
