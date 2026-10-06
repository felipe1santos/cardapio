-- Rollback da 0151 (opção QR Code do cardápio). Só se o código que lê a coluna já tiver saído do ar.
alter table public.restaurantes drop column if exists impressao_qr;
delete from public.schema_migrations where name = '0151_impressao_qr.sql';
