-- Rollback da 0097. Só remove o que a 0097 criou; nenhum dado de cardápio é tocado.
-- ATENÇÃO: derrubar a coluna antes de voltar o código faz a vitrine/PDV falharem
-- no select. Ordem: 1) voltar o código; 2) rodar este arquivo.
drop index if exists tamanhos_padrao_pizza_nome_unico;
drop index if exists tamanhos_padrao_marmita_nome_unico;
drop index if exists bordas_pizza_nome_unico;
drop index if exists massas_pizza_nome_unico;
drop index if exists tamanhos_item_nome_unico;
drop index if exists pizza_sabores_nome_unico;
alter table itens_cardapio drop column if exists pizza_tamanhos_ocultos;
