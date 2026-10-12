-- Rollback da 0189: volta ao padrão desligado e deixa ligado só na Menuzia.
alter table public.restaurantes alter column cartao_online_ativo set default false;
update public.restaurantes set cartao_online_ativo = (slug = 'menuzia');
