-- Rollback da 0122. Voltar o CÓDIGO antes (ele seleciona as colunas novas).
-- edicao_limitada não foi alterada (só o comentário), então nada se perde além das tags novas.
alter table public.itens_cardapio drop constraint if exists itens_cardapio_tag_personalizada_check;
alter table public.itens_cardapio
  drop column if exists combo_especial,
  drop column if exists tag_personalizada,
  drop column if exists tag_personalizada_cor;
comment on column public.itens_cardapio.edicao_limitada is 'Etiqueta principal "Edição limitada".';
