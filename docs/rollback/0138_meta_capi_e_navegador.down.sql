-- Rollback da 0138. Apaga o token da API de Conversões (a loja precisa colar de novo se reaplicar).
begin;
drop table if exists public.integracoes_segredos;
alter table public.vitrine_eventos drop constraint if exists vitrine_eventos_navegador_check;
alter table public.vitrine_eventos drop constraint if exists vitrine_eventos_sistema_check;
alter table public.vitrine_eventos drop column if exists navegador;
alter table public.vitrine_eventos drop column if exists sistema;
do $x$ begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where name = '0138_meta_capi_e_navegador.sql';
  end if;
end $x$;
commit;
