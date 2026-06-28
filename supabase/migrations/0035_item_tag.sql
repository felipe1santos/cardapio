-- Etiqueta de destaque por item (vitrine): "Mais pedido", "Edição limitada", etc.
-- Aditivo e idempotente. Null = item sem tag.

alter table itens_cardapio add column if not exists tag text;
