-- Idempotência da notificação "pedido em preparo" no WhatsApp.
-- O cliente recebe a mensagem de "em preparo" na primeira vez que um cozinheiro
-- pega o pedido (ou o admin aceita no Kanban). Se o cozinheiro devolver e outro
-- pegar de novo, a mensagem NÃO deve ser reenviada. Esta flag marca que a
-- notificação já saiu uma vez.
alter table pedidos
  add column if not exists preparando_notificado boolean not null default false;
