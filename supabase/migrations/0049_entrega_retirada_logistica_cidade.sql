-- Canais de venda da loja, fluxo de conclusão do pedido e cidade/referência do
-- endereço do cliente. Tudo aditivo e idempotente.
--
-- Os defaults preservam exatamente o comportamento de hoje para as lojas que
-- já existem (ver docs/superpowers — "default seguro em features de gating"):
--   usa_logistica    = true   → o pedido de entrega continua saindo do Kanban
--                              para o módulo de Logística, como sempre foi.
--   aceita_entrega   = true   → a vitrine continua vendendo entrega.
--   aceita_retirada  = false  → a vitrine NUNCA ofereceu retirada; ligar isso
--                              por padrão criaria um canal que a loja não pediu
--                              (e cujo balcão pode não estar preparado).
alter table restaurantes add column if not exists usa_logistica boolean not null default true;
alter table restaurantes add column if not exists aceita_entrega boolean not null default true;
alter table restaurantes add column if not exists aceita_retirada boolean not null default false;

-- Cidade do endereço do cliente. Sem ela o geocode do frete por raio recebia só
-- "Rua X, 100, Bairro Y" e o Google resolvia a rua em qualquer cidade do país —
-- distância errada e, no pior caso, pedido rejeitado no envio.
-- Ponto de referência ajuda o entregador a achar a casa ("ao lado da padaria").
alter table clientes add column if not exists endereco_cidade text;
alter table clientes add column if not exists endereco_referencia text;

-- Os mesmos dois campos congelados no pedido (o perfil do cliente muda; o
-- pedido é o registro histórico do que foi combinado naquela compra).
alter table pedidos add column if not exists endereco_cidade text not null default '';
alter table pedidos add column if not exists endereco_referencia text not null default '';
