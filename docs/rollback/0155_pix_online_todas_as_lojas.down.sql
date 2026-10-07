-- Desfaz a 0155: volta a flag só para a Menuzia (estado de antes) e o padrão para desligado.
-- Lojas que conectaram a conta depois da 0155 perdem o Pix online até a flag voltar.
alter table public.restaurantes alter column pix_online_ativo set default false;
update public.restaurantes set pix_online_ativo = (slug = 'menuzia');
