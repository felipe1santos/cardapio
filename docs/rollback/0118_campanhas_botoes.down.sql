-- Rollback da 0118. Voltar o CÓDIGO antes (ele lê/grava a coluna).
alter table public.campanhas drop constraint if exists campanhas_botoes_check;
alter table public.campanhas drop column if exists botoes;
