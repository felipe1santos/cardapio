-- ============================================================================
-- Reimpressão manual: o operador pode pedir pra imprimir de novo um pedido
-- (ex.: faltou papel na 1ª vez). O Assistente de Impressão repega pedidos com
-- reimprimir=true em qualquer status e, após imprimir, a flag é limpa.
-- ============================================================================

alter table pedidos
  add column if not exists reimprimir boolean not null default false;
