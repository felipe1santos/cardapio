-- ============================================================================
-- 0097 — Cardápio: nomes de tamanho sem repetição + tamanhos ocultos na pizza
--
-- 1) Nome repetido. O servidor casa tamanho, borda, massa e tamanho de item PELO
--    NOME na hora de montar o pedido (lib/queries/pedidos.ts). Duas "Grande" na
--    mesma loja fariam o pedido pegar a errada sem ninguém perceber. A tela e a
--    camada de consulta já recusam o repetido; aqui o banco garante o mesmo.
--
--    PREFLIGHT PRIMEIRO: antes de qualquer alteração, a migration conta os nomes
--    repetidos nas 6 tabelas. Havendo qualquer um, ela ABORTA com a lista (tabela,
--    dono e nome) e nada é criado nem alterado — nenhum dado é apagado, renomeado
--    ou convertido. Quem for publicar resolve os repetidos à mão (renomear no
--    painel) e roda de novo. O mesmo levantamento, só leitura, está em
--    scripts/seguranca/preflight-tamanhos.mjs.
--
-- 2) Liga/desliga de tamanho por pizza. Coluna aditiva `pizza_tamanhos_ocultos`
--    com os tamanhos da loja que ESTA pizza não vende. Default vazio: toda pizza
--    existente continua mostrando exatamente o que mostra hoje. Desligar um
--    tamanho não apaga nem zera preço — religar devolve tudo como estava.
--
-- Pode rodar de novo sem efeito (if not exists).
-- Rollback: docs/rollback/0097_cardapio_tamanhos.down.sql
-- ============================================================================

do $$
declare
  alvo record;
  achado record;
  problemas text := '';
begin
  for alvo in
    select * from (values
      ('tamanhos_padrao_pizza',   'restaurante_id'),
      ('tamanhos_padrao_marmita', 'restaurante_id'),
      ('bordas_pizza',            'restaurante_id'),
      ('massas_pizza',            'restaurante_id'),
      ('tamanhos_item',           'item_id'),
      ('pizza_sabores',           'item_id')
    ) as t(tabela, dono)
  loop
    for achado in execute format(
      'select %I::text as dono, lower(btrim(nome)) as chave, count(*) as n
         from %I group by 1, 2 having count(*) > 1 order by 1, 2',
      alvo.dono, alvo.tabela
    ) loop
      problemas := problemas || format(E'\n  %s: %s=%s nome "%s" aparece %s vezes',
        alvo.tabela, alvo.dono, achado.dono, achado.chave, achado.n);
    end loop;
  end loop;

  if problemas <> '' then
    raise exception using
      message = '0097 abortada: há nomes repetidos. Nada foi alterado.' || problemas,
      hint = 'Renomeie os repetidos no painel (Cardápio › Tamanhos ou no item) e rode de novo. Nenhum dado é apagado ou convertido por esta migration.';
  end if;
end $$;

alter table itens_cardapio
  add column if not exists pizza_tamanhos_ocultos uuid[] not null default '{}';

comment on column itens_cardapio.pizza_tamanhos_ocultos is
  'Tamanhos da loja (tamanhos_padrao_pizza.id) que esta pizza não vende. Vazio = regra antiga (tamanho com preço em algum sabor).';

create unique index if not exists tamanhos_padrao_pizza_nome_unico   on tamanhos_padrao_pizza   (restaurante_id, lower(btrim(nome)));
create unique index if not exists tamanhos_padrao_marmita_nome_unico on tamanhos_padrao_marmita (restaurante_id, lower(btrim(nome)));
create unique index if not exists bordas_pizza_nome_unico            on bordas_pizza            (restaurante_id, lower(btrim(nome)));
create unique index if not exists massas_pizza_nome_unico            on massas_pizza            (restaurante_id, lower(btrim(nome)));
create unique index if not exists tamanhos_item_nome_unico           on tamanhos_item           (item_id, lower(btrim(nome)));
create unique index if not exists pizza_sabores_nome_unico           on pizza_sabores           (item_id, lower(btrim(nome)));
