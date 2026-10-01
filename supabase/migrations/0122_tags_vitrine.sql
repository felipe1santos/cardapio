-- 0122 — Tags da vitrine repaginadas (2026-10-01). Substitui as regras de tags da 0117.
--
-- Topo (na linha do nome, máx. 2): Mais vendido (a estrela de sempre, mais_vendido) >
--   Combo especial (novo) > Oferta limitada (a antiga "Edição limitada": MESMA coluna
--   edicao_limitada, só muda o nome na tela — nenhum produto perde a marcação) > Novidade.
-- Utilitárias (abaixo da descrição): Serve até X pessoas · Item promocional · Tag personalizada
--   (texto livre da loja, até 24 caracteres, preta ou azul).
--
-- Aditiva; nenhum dado existente é convertido. Rollback: docs/rollback/0122_tags_vitrine.down.sql
alter table public.itens_cardapio
  add column if not exists combo_especial boolean not null default false,
  add column if not exists tag_personalizada text,
  add column if not exists tag_personalizada_cor text not null default 'preta';

alter table public.itens_cardapio drop constraint if exists itens_cardapio_tag_personalizada_check;
alter table public.itens_cardapio add constraint itens_cardapio_tag_personalizada_check check (
  (tag_personalizada is null or (char_length(tag_personalizada) between 1 and 24 and tag_personalizada !~ '[\r\n]'))
  and tag_personalizada_cor in ('preta', 'azul')
);

comment on column public.itens_cardapio.combo_especial is 'Tag de topo "Combo especial" (0122).';
comment on column public.itens_cardapio.tag_personalizada is 'Tag utilitária com texto livre da loja, até 24 caracteres (0122). Null = sem.';
comment on column public.itens_cardapio.tag_personalizada_cor is 'Cor da tag personalizada: preta | azul (0122).';
comment on column public.itens_cardapio.edicao_limitada is 'Tag de topo "Oferta limitada" (antes "Edição limitada", 0117/0122).';
