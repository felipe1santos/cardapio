-- Rollback da 0144 (Fase 6). Rode como postgres (dono das tabelas: as travas deixam passar).
-- Os pedidos de aprovação remota somem (as aprovações de verdade continuam em fin_aprovacoes, imutáveis).
begin;
drop function if exists public.fin_risco_funcionarios(uuid, date, date);
drop function if exists public.fin_dashboard(uuid, date, date, text);
drop function if exists public.fin_pendencias_fechamento(uuid, timestamptz);
drop table if exists public.fin_aprovacao_pedidos;
drop function if exists public.fin_aprovacao_pedidos_guardar();
alter table public.fin_config drop column if exists tolerancia_fechamento_centavos;
alter table public.fin_config drop column if exists limite_comandas_fechamento_centavos;
alter table public.fin_config drop column if exists minutos_caixa_sem_abrir;
alter table public.fin_config drop column if exists meta_faturamento_dia_centavos;
do $x$ begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where name = '0144_dashboard_alertas_pin_risco.sql';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '0144';
  end if;
end $x$;
commit;
