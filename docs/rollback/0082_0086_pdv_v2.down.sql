-- Rollback das migrations 0082–0086 (PDV v2).
--
-- ⚠ PRIMEIRO desligue o PDV v2 em todas as lojas e volte o código. O rollback de
-- banco só é necessário se alguma trigger bloquear um fluxo não mapeado — e aí o
-- caminho curto é o item 1, uma linha, sem mexer em dado.
--
-- Nada aqui apaga dado gravado pelo v2: comandas de balcão, pagamentos com canal e
-- colunas de atendimento FICAM (são aditivas e o código antigo as ignora). Remover
-- coluna com dado dentro seria perda de histórico financeiro.

-- 1. Destravar transições (se a trigger bloquear algo inesperado) -----------------
drop trigger if exists pedidos_transicao_valida on public.pedidos;

-- 2. Lançamento em comanda fechada volta a ser aceito pelo banco -----------------
drop trigger if exists pedidos_exige_comanda_aberta on public.pedidos;

-- 3. Fechamento e pagamento voltam ao corpo anterior (0072) ------------------------
--    Recriar a partir de supabase/migrations/0072_conta_desconto_numero_e_cancelamento.sql
--    as funções comanda_fechar e comanda_registrar_pagamento (copiar só os dois blocos
--    `create or replace function`). As funções novas podem ficar: nada as chama sem o
--    código novo.

-- 4. Flag desligada em todas as lojas (o PDV antigo volta na hora) -----------------
update public.restaurantes set pdv_v2 = false where pdv_v2;

-- 5. Realtime (opcional — só ruído a mais)
-- alter publication supabase_realtime drop table public.comandas, public.pagamentos_comanda;
