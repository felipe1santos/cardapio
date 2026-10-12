-- Rollback da 0186 (estado de 12/10/2026 antes da liberação, lido no banco de produção).
alter table public.restaurantes alter column vitrine_fonte set default 'atual';
alter table public.restaurantes alter column vitrine_imagem_tamanho drop default;
alter table public.restaurantes alter column vitrine_nova set default false;
alter table public.restaurantes alter column impressao_somente_nova set default false;
-- Antes: só a Menuzia tinha 'ifood'/110; todas as outras 'atual'/null.
update public.restaurantes set vitrine_fonte = 'atual', vitrine_imagem_tamanho = null where slug <> 'menuzia';
update public.restaurantes set vitrine_nova = false, impressao_somente_nova = false where slug = 'firehouse';
