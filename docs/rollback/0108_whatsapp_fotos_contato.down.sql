-- Rollback da 0108 (voltar o código antes: a central passa a mostrar só as iniciais).
-- Em produção, apagar também o registro: delete from schema_migrations where name = '0108_whatsapp_fotos_contato.sql';
drop table if exists public.whatsapp_contato_fotos;
