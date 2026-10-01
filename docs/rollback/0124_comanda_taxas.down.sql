-- Rollback da 0124. Voltar o CÓDIGO antes. A soma das taxas continua em comandas.taxa_extra_valor
-- (0106), então os totais das contas não mudam ao remover o detalhamento.
drop function if exists public.comanda_taxas_definir(uuid, uuid, jsonb, uuid, text);
drop table if exists public.comanda_taxas;
alter table public.restaurantes drop constraint if exists restaurantes_taxas_padrao_mesa_check;
alter table public.restaurantes drop column if exists taxas_padrao_mesa;
