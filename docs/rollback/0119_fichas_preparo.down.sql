-- Rollback da 0119. Voltar o CÓDIGO antes. Apaga as fichas cadastradas (fazer backup antes).
drop trigger if exists fichas_preparo_mesma_loja on public.fichas_preparo;
drop function if exists public.fichas_preparo_mesma_loja();
drop table if exists public.fichas_preparo;
