-- 0152 — Vitrine estilo iFood (pendência 9, 2026-10-06): tamanho da imagem da lista e fonte
-- da vitrine, escolhidos em Ajustes › Apresentação do cardápio.
--
-- Aditiva e neutra para quem já existe:
--   vitrine_imagem_tamanho  null = como hoje (120 px, ou 140 com "imagem grande");
--                           90 | 100 | 110 = o lado da foto do item na lista, em px.
--   vitrine_fonte           'atual' (Montserrat, como hoje) | 'ifood' (Figtree, peso até 600).
-- Nenhuma linha é convertida. O modo "Gaveta" saiu da tela, mas o valor 'gaveta' continua
-- válido no CHECK e a vitrine o mostra como "Lista" (nenhuma loja usa em 2026-10-06).
--
-- APLICAR ANTES do deploy do código que lê as colunas (lib/queries/ajustes.ts e cardapio.ts).

alter table public.restaurantes add column if not exists vitrine_imagem_tamanho smallint
  check (vitrine_imagem_tamanho is null or vitrine_imagem_tamanho in (90, 100, 110));
alter table public.restaurantes add column if not exists vitrine_fonte text not null default 'atual'
  check (vitrine_fonte in ('atual', 'ifood'));

-- restaurantes tem grant por coluna: a vitrine (anon) lê; o painel (authenticated) grava a própria loja (RLS).
grant select (vitrine_imagem_tamanho, vitrine_fonte) on public.restaurantes to anon, authenticated;
grant update (vitrine_imagem_tamanho, vitrine_fonte) on public.restaurantes to authenticated;
