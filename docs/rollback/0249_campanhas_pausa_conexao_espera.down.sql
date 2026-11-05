-- Rollback da 0249: volta o código ANTES (sem retomar_apos), depois reaplica a campanha_concluir_envio da 0112
-- (supabase/migrations/0112_campanhas_descadastro_pausa.sql, só a função) e então roda este arquivo.
-- Campanhas paradas como 'whatsapp_instavel' voltam a 'whatsapp_desconectado' (retomada automática da v anterior).
update public.campanhas set pausa_motivo = 'whatsapp_desconectado' where pausa_motivo = 'whatsapp_instavel';
alter table public.campanhas drop column if exists retomar_apos, drop column if exists pausas_conexao;
