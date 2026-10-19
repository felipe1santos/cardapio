-- Desfaz a 0201: volta a lista de estados do robô da 0193 (conversas em "alterar_pedido:*" ficam inválidas: limpa antes).
update public.whatsapp_conversas set auto_estado = null, auto_estado_em = null where auto_estado ~ '^alterar_pedido:';
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_auto_estado_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_auto_estado_check
  check (auto_estado is null or auto_estado in ('aguardando_bairro', 'aguardando_numero', 'pedir_link', 'escolher_categoria') or auto_estado ~ '^escolher_item:[0-9]{1,3}$');
-- A função: reaplicar o CREATE OR REPLACE da 0193 (mesmo corpo, sem o padrão alterar_pedido).
