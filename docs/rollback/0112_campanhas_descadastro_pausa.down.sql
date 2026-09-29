-- Rollback da 0112. Voltar o CÓDIGO antes (o código novo usa as colunas e a função).
-- Campanhas 'pausada' voltam para 'enviando' para a fila antiga continuar (sem a checagem
-- de conexão). A lista de descadastros é guardada em _backup antes de apagar.
create table if not exists public._backup_0112_descadastros as select * from public.whatsapp_descadastros;
update public.campanhas set status = 'enviando' where status = 'pausada';
drop function if exists public.whatsapp_descadastrar(uuid, text, boolean, text);
drop table if exists public.whatsapp_descadastros;
alter table public.campanhas drop column if exists incluir_descadastro, drop column if exists pausada_em, drop column if exists pausa_motivo;
delete from public.whatsapp_envios where tipo = 'descadastro' and estado in ('pendente', 'enviando');
alter table public.whatsapp_envios drop constraint if exists whatsapp_envios_tipo_check;
alter table public.whatsapp_envios add constraint whatsapp_envios_tipo_check check (tipo in ('robo', 'aviso_pedido', 'descadastro'));
drop function if exists public.campanha_reservar_envios(integer);
-- campanha_reservar_envios (a 0112 mudou as colunas de saída) e campanha_concluir_envio:
-- reaplicar as versões da
-- supabase/migrations/0104_campanhas_metricas.sql (seções "seletor do cron" e
-- "campanha_concluir_envio").
