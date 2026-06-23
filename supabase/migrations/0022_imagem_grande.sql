-- Imagem grande na visualização em lista do cardápio do cliente:
-- quando true, as miniaturas dos itens na lista ficam 100x100 (em vez de 76).
alter table restaurantes
  add column imagem_grande boolean not null default false;
