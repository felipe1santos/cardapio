-- Rollback do atendimento identificado, entrega manual, mesa em limpeza e fechamento
-- completo (0094–0096). NÃO apaga dado gravado: nomes, telefones, clientes vinculados,
-- endereços de entrega, pagamentos, cupons usados e auditoria ficam.
--
-- Preferível ao rollback de banco: desligar `pdv_v2` na loja. Sem a flag, a mesa não
-- exige nome, não entra em limpeza e o PDV volta ao fluxo antigo.
--
-- 1. Liberar mesas que ficaram em limpeza (senão elas não abrem atendimento):
update public.mesas set limpeza_desde = null, limpeza_comanda_id = null where limpeza_desde is not null;

-- 2. Tirar as guardas novas (mesa sem nome volta a abrir; limpeza deixa de bloquear):
drop trigger if exists comanda_validar_abertura on public.comandas;
drop trigger if exists sessoes_mesa_exige_disponivel on public.sessoes_mesa;
drop trigger if exists chamados_mesa_exige_disponivel on public.chamados_mesa;
drop trigger if exists comandas_troca_mesa_exige_disponivel on public.comandas;
drop trigger if exists comanda_cupom_consistente on public.comandas;

-- 3. Funções redefinidas: reexecutar os blocos das migrations anteriores, nesta ordem
--    (cada arquivo inteiro é idempotente):
--      · comanda_totais, comanda_lancar (7 args), comanda_balcao_abrir (6 args),
--        pedidos_exige_comanda_aberta, pedidos_transicao_valida → 0085 / 0083
--        (comanda_totais: 0072). Pedidos de entrega manual já gravados continuam
--        válidos; os que estiverem em rota terminam normalmente pela logística só se
--        a 0094 ainda estiver ativa — resolva-os antes do rollback.
--      · comanda_fechar_presencial, comanda_reabrir, comanda_pendencias → 0085
--      · itens_transferir → 0072
-- As funções novas (comanda_mesa_abrir, comanda_identificar, mesa_liberar,
-- comanda_fechar_completo, comanda_fechamento_simular, comanda_aplicar_decisoes,
-- comanda_cupom_aplicar/remover, comanda_fidelidade_marcar, cliente_vincular,
-- telefone_br_normalizar) podem ficar: nada antigo as chama. Para removê-las:
-- drop function if exists public.comanda_fechar_completo(uuid,uuid,jsonb,jsonb,uuid,text,text,text,text);
-- (idem para as demais, com a assinatura completa).
--
-- 4. As colunas novas FICAM (comandas.cliente_id/entrega*/taxa_entrega*/cupom_*/
--    chave_fechamento/fidelidade_processado, mesas.limpeza_*/liberada_*,
--    pedidos.lancado_via): são histórico e têm default neutro. Não derrubar.
