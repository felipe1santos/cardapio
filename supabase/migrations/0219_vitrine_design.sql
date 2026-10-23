-- 0219 — Dois designs da vitrine (23/10/2026, pedido do dono): o de hoje ('padrao') e um mais limpo ('simples':
-- cantos retos, sem sombra, sem gradiente, sem pulsar/balançar/confete). Escolhido em Ajustes › Aparência.
--
-- Aditiva e neutra: default 'padrao' = toda loja continua exatamente como está. Nenhuma linha é convertida.
-- APLICAR ANTES do deploy do código que lê a coluna (lib/queries/ajustes.ts e cardapio.ts).
-- Rollback: alter table public.restaurantes drop column vitrine_design;

alter table public.restaurantes add column if not exists vitrine_design text not null default 'padrao'
  check (vitrine_design in ('padrao', 'simples'));

-- restaurantes tem grant por coluna (0080): a vitrine (anon) lê; o painel (authenticated) grava a própria loja (RLS).
grant select (vitrine_design) on public.restaurantes to anon, authenticated;
grant update (vitrine_design) on public.restaurantes to authenticated;
