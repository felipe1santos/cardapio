-- Miniatura do item de cardápio.
--
-- A listagem (vitrine, PDV, gestor) exibe a foto num card de ~100 px, mas baixa
-- a imagem full de 1200 px — média de 208 KB medida na Estância Burger. Esta
-- coluna guarda uma versão de 400 px do mesmo produto, gerada no upload.
--
-- Aditiva, nullable e idempotente. `imagem_url` continua sendo a FULL e não é
-- tocada. Enquanto `imagem_thumb_url` for NULL o frontend cai no fallback
-- `imagem_thumb_url ?? imagem_url`, então itens antigos seguem funcionando e o
-- rollback é simplesmente parar de preencher a coluna.

alter table itens_cardapio add column if not exists imagem_thumb_url text;

comment on column itens_cardapio.imagem_thumb_url is
  'Miniatura ~400px em WebP para listagens. NULL = usar imagem_url como fallback.';
