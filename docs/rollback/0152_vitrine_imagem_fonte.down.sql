-- Rollback da 0152 (tamanho da imagem da lista e fonte da vitrine). Só depois que o código que
-- lê as colunas sair do ar (a vitrine e Ajustes leem as duas no select).
alter table public.restaurantes drop column if exists vitrine_fonte;
alter table public.restaurantes drop column if exists vitrine_imagem_tamanho;
delete from public.schema_migrations where name = '0152_vitrine_imagem_fonte.sql';
