-- Fallback de checkout quando o WhatsApp da loja está offline.
-- Quando o OTP não pode ser enviado (instância Evolution desconectada ou loja
-- sem WhatsApp), o cliente segue o pedido sem confirmar o telefone — a loja
-- nunca para de vender. Esses pedidos entram com telefone_verificado = false
-- para o operador saber que o número não foi confirmado.
alter table pedidos
  add column if not exists telefone_verificado boolean not null default true;
