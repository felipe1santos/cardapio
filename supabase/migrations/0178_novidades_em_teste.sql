-- 0178 — "Novidades em teste" por loja (10/10/2026, ordem do dono). Toda novidade visível nova fica atrás desta chave:
-- LIGADA só na Menuzia, DESLIGADA nas outras (que continuam exatamente como estavam). O Super Admin liga/desliga por
-- loja e tem "Liberar para todas as lojas". Rollback: alter table public.restaurantes drop column novidades_teste;
alter table public.restaurantes add column if not exists novidades_teste boolean not null default false;
update public.restaurantes set novidades_teste = true where slug = 'menuzia';
