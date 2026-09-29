-- Rollback da 0109. Voltar o código antes (o Assistente e o painel leem estas colunas).
-- Em produção, apagar também: delete from schema_migrations where name = '0109_impressao_envio_direto.sql';
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_rede_com_ip_check;
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_rede_porta_check;
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_rede_ip_check;
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_modo_impressao_check;
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_envio_check;
alter table public.impressao_dispositivos drop constraint if exists impressao_dispositivos_intensidade_check;
alter table public.impressao_dispositivos
  drop column if exists rede_porta,
  drop column if exists rede_ip,
  drop column if exists modo_impressao,
  drop column if exists envio,
  drop column if exists intensidade;
alter table public.impressao_trabalhos drop column if exists tempos;
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'impressao_trabalhos') then
    alter publication supabase_realtime drop table public.impressao_trabalhos;
  end if;
end $$;
