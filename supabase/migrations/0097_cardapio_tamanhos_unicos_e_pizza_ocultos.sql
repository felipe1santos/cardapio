-- ============================================================================
-- 0097 — Cardápio: nomes de tamanho sem repetição + tamanhos ocultos na pizza
--
-- 1) Nome repetido. O servidor casa tamanho, borda, massa e tamanho de item PELO
--    NOME na hora de montar o pedido (lib/queries/pedidos.ts). Duas "Grande" na
--    mesma loja fariam o pedido pegar a errada sem ninguém perceber. A tela e a
--    camada de consulta já recusam o repetido; aqui o banco garante o mesmo.
--
--    Índice CONDICIONAL: só nasce se a tabela não tiver repetido hoje. Havendo,
--    a migration NÃO apaga nem renomeia nada — avisa (notice) e segue sem o
--    índice daquela tabela. Nada de conversão ou exclusão de dado.
--
-- 2) Liga/desliga de tamanho por pizza. Coluna aditiva `pizza_tamanhos_ocultos`
--    com os tamanhos da loja que ESTA pizza não vende. Default vazio: toda
--    pizza existente continua mostrando exatamente o que mostra hoje (a regra
--    "tamanho com preço em algum sabor" segue valendo). Desligar um tamanho não
--    apaga nem zera preço — religar devolve tudo como estava.
--
-- Rollback: docs/rollback/0097_cardapio_tamanhos.down.sql
-- ============================================================================

alter table itens_cardapio
  add column if not exists pizza_tamanhos_ocultos uuid[] not null default '{}';

comment on column itens_cardapio.pizza_tamanhos_ocultos is
  'Tamanhos da loja (tamanhos_padrao_pizza.id) que esta pizza não vende. Vazio = regra antiga (tamanho com preço em algum sabor).';

do $$
declare
  alvo record;
  repetidos int;
begin
  for alvo in
    select * from (values
      ('tamanhos_padrao_pizza',   'restaurante_id', 'tamanhos_padrao_pizza_nome_unico'),
      ('tamanhos_padrao_marmita', 'restaurante_id', 'tamanhos_padrao_marmita_nome_unico'),
      ('bordas_pizza',            'restaurante_id', 'bordas_pizza_nome_unico'),
      ('massas_pizza',            'restaurante_id', 'massas_pizza_nome_unico'),
      ('tamanhos_item',           'item_id',        'tamanhos_item_nome_unico'),
      ('pizza_sabores',           'item_id',        'pizza_sabores_nome_unico')
    ) as t(tabela, dono, indice)
  loop
    execute format(
      'select count(*) from (select 1 from %I group by %I, lower(btrim(nome)) having count(*) > 1) d',
      alvo.tabela, alvo.dono
    ) into repetidos;

    if repetidos > 0 then
      raise notice '0097: % tem % nome(s) repetido(s); índice % NÃO criado. Nada foi alterado.',
        alvo.tabela, repetidos, alvo.indice;
    else
      execute format(
        'create unique index if not exists %I on %I (%I, lower(btrim(nome)))',
        alvo.indice, alvo.tabela, alvo.dono
      );
    end if;
  end loop;
end $$;
