-- Despacho aberto (self-service do entregador):
-- quando TRUE, os entregadores enxergam os pedidos prontos para entrega (sem dono)
-- direto no app deles e podem "pegar" a entrega sozinhos, sem o operador atribuir.
alter table restaurantes
  add column if not exists despacho_aberto boolean not null default false;
