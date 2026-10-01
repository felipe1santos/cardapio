-- Rollback da 0123. Voltar o CÓDIGO antes (ele seleciona as colunas novas).
alter table public.restaurantes drop constraint if exists restaurantes_aviso_cores_check;
alter table public.restaurantes
  drop column if exists aviso_cor_texto,
  drop column if exists aviso_cor_fundo,
  drop column if exists aviso_pulsar;
