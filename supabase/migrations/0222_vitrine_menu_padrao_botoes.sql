-- 0222 — "Barra com 4 botões" vira o menu inferior padrão da vitrine (23/10/2026, pedido do dono).
-- Todas as lojas passam para 'botoes'; cada uma pode voltar para 'bolha' em Ajustes › Perfil da loja › Aparência › "Menu inferior".
-- Antes: 'botoes' só na menuzia; 'bolha' (o default da 0221, ninguém escolheu) em mama-pizza, ponto-400-hamburgueria,
-- db-doces, nossa-cozinha, w-lanches-reviver, villa-lanches, firehouse, pizza-do-rosa, estancia-burger.
-- Rollback: alter table public.restaurantes alter column vitrine_menu set default 'bolha';
--           update public.restaurantes set vitrine_menu = 'bolha' where slug <> 'menuzia';

alter table public.restaurantes alter column vitrine_menu set default 'botoes';
update public.restaurantes set vitrine_menu = 'botoes' where vitrine_menu <> 'botoes';
