-- 0147 — Pix online (2026-10-04): estado novo do pedido "aguardando_pagamento".
--
-- Sozinha de propósito: `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma transação que o cria
-- (a 0148 usa o valor). Aditiva: nenhum pedido existente muda; quem filtra por status (Kanban,
-- cozinha, impressão, alarme) ignora o estado novo sozinho. Só a loja com Pix online ligado (0148)
-- cria pedido nesse estado.
alter type public.status_pedido add value if not exists 'aguardando_pagamento' before 'recebido';
