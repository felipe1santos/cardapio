-- ============================================================================
-- 0079 — Entrega sem entregador
--
-- Loja que não quer cadastrar motoboy nem acompanhar rota: o pedido de entrega
-- sai do Kanban com um toque ("Saiu para entrega"), o cliente recebe a mensagem
-- de saída e o pedido fecha ali — sem a etapa "entregue", que ninguém teria como
-- confirmar.
--
-- Chave PRÓPRIA, e não `usa_logistica = false`: essa já existe e tem loja real
-- usando com o fluxo de duas etapas (saiu → entregue, cada uma com mensagem).
-- Reaproveitá-la mudaria a operação dessas lojas sem aviso. Default false: toda
-- loja existente continua exatamente como está.
-- ============================================================================

alter table restaurantes add column if not exists entrega_sem_entregador boolean not null default false;

comment on column restaurantes.entrega_sem_entregador is
  'true = entrega sem motoboy: "Saiu para entrega" no Kanban avisa o cliente e conclui o pedido (sem etapa entregue).';
