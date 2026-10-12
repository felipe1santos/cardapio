-- 0186 — Liberação para todas as lojas (12/10/2026, decisão do Felipe sobre docs/auditoria-so-menuzia.md, itens 1, 2, 3, 26).
--  * Letra "iFood" (vitrine_fonte='ifood') e foto da lista 110 px em TODAS as lojas com vitrine nova; loja nova já nasce assim.
--    O dono continua trocando em Ajustes › Aparência.
--  * Vitrine nova na firehouse; loja nova nasce com a vitrine nova.
--  * Impressão nova (impressao_somente_nova) na firehouse — conferido antes: 0 Assistentes e 0 pedidos, não fica sem imprimir;
--    loja nova nasce só no Assistente novo (o antigo já é recusado pelo servidor desde 12/10).
-- Só mexe nessas 4 colunas. Rollback: docs/rollback/0186_liberacao_todas_vitrine_impressao.down.sql.

alter table public.restaurantes alter column vitrine_fonte set default 'ifood';
alter table public.restaurantes alter column vitrine_imagem_tamanho set default 110;
alter table public.restaurantes alter column vitrine_nova set default true;
alter table public.restaurantes alter column impressao_somente_nova set default true;

update public.restaurantes set vitrine_nova = true where slug = 'firehouse';
update public.restaurantes set impressao_somente_nova = true where slug = 'firehouse'
  and not exists (select 1 from public.impressao_agentes a where a.restaurante_id = restaurantes.id and a.revogado_em is null);

update public.restaurantes set vitrine_fonte = 'ifood', vitrine_imagem_tamanho = 110
  where vitrine_nova = true and (vitrine_fonte is distinct from 'ifood' or vitrine_imagem_tamanho is distinct from 110);
