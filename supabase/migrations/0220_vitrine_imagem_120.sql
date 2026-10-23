-- 0220 — Foto do item na lista com 120 px (23/10/2026, pedido do dono: mesmo tamanho da referência Brendi,
-- 120×120). Aceita 120 além de 90/100/110; loja nova nasce com 120; as lojas que estavam no padrão 110
-- (todas as 10, colocado pela 0186) passam a 120. O dono de cada loja continua trocando em Ajustes › Aparência.
-- Valor numérico, mesmo formato: o código antigo lê 120 como "tamanho de antes" (120/140), sem quebrar.
-- Rollback: update restaurantes set vitrine_imagem_tamanho = 110 where vitrine_imagem_tamanho = 120;
--           alter column ... set default 110; recriar o CHECK com (90, 100, 110).

alter table public.restaurantes drop constraint if exists restaurantes_vitrine_imagem_tamanho_check;
alter table public.restaurantes add constraint restaurantes_vitrine_imagem_tamanho_check
  check (vitrine_imagem_tamanho is null or vitrine_imagem_tamanho in (90, 100, 110, 120));
alter table public.restaurantes alter column vitrine_imagem_tamanho set default 120;
update public.restaurantes set vitrine_imagem_tamanho = 120 where vitrine_imagem_tamanho = 110;
