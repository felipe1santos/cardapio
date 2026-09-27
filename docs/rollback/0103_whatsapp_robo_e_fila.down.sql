-- Rollback da 0103 (robô do WhatsApp e fila de envios). Voltar o CÓDIGO antes: o código
-- novo usa estas tabelas para os avisos de pedido. Apaga conversas, mensagens e fila do
-- robô (dados com retenção de 90 dias, sem uso fora do robô).
begin;
drop function if exists public.whatsapp_limpar_antigos();
drop function if exists public.whatsapp_concluir_envio(uuid, text, text, text);
drop function if exists public.whatsapp_reivindicar_envios(integer, uuid);
drop function if exists public.whatsapp_alterar_conversa(uuid, uuid, text, uuid, text);
drop function if exists public.whatsapp_registrar_entrada(uuid, text, text, boolean, text, text, timestamptz, text, text);
drop table if exists public.whatsapp_envios;
drop table if exists public.whatsapp_mensagens;
drop table if exists public.whatsapp_conversas;
drop table if exists public.whatsapp_robo_config;
delete from schema_migrations where name = '0103_whatsapp_robo_e_fila.sql';
commit;
