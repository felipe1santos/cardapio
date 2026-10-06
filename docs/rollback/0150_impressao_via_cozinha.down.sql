-- Rollback da 0150 (impressão v3: via da cozinha). Só se o código que lê a coluna já tiver saído do ar.
alter table public.restaurantes drop column if exists impressao_via_cozinha;
delete from public.schema_migrations where name = '0150_impressao_via_cozinha.sql';
