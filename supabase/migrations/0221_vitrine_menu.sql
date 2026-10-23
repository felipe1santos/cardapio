-- 0221 — Menu inferior da vitrine (23/10/2026, pedido do dono): 'bolha' = o de hoje (barra na cor da loja com a bolha);
-- 'botoes' = barra branca com 4 botões (Início, Promoções, Desconto, Pedidos), cópia da referência pedido.takeat.app.
-- Escolhido em Ajustes › Perfil da loja › Aparência › "Menu inferior".
-- Aditiva e neutra: default 'bolha' = toda loja continua igual. Nenhuma linha é convertida.
-- Rollback: alter table public.restaurantes drop column vitrine_menu;

alter table public.restaurantes add column if not exists vitrine_menu text not null default 'bolha'
  check (vitrine_menu in ('bolha', 'botoes'));

-- restaurantes tem grant por coluna (0080): a vitrine (anon) lê; o painel (authenticated) grava a própria loja (RLS).
grant select (vitrine_menu) on public.restaurantes to anon, authenticated;
grant update (vitrine_menu) on public.restaurantes to authenticated;
