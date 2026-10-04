-- Rollback da 0143 (Fase 5b). Só use se NENHUMA conta/compra real foi lançada (os lançamentos do livro-caixa
-- feitos por elas ficam — o livro-caixa é imutável; a conta "some" mas o dinheiro registrado continua).
begin; -- rode como postgres (dono das tabelas): as travas de imutabilidade deixam passar
drop function if exists public.fin_dre_periodo(uuid, date, date);
drop function if exists public.fin_compra_cancelar(uuid, uuid, uuid, text, text, text);
drop function if exists public.fin_compra_registrar(uuid, jsonb);
drop function if exists public.fin_conta_cancelar(uuid, uuid, boolean, uuid, text, text, jsonb);
drop function if exists public.fin_conta_estornar(uuid, uuid, uuid, uuid, text, uuid, text, text, text, jsonb);
drop function if exists public.fin_conta_baixar(uuid, uuid, text, text, uuid, text, jsonb, uuid, text, uuid, text, text, text, jsonb);
drop function if exists public.fin_lancar_grupo(uuid, uuid, text, text, uuid, text, text, uuid, text, text, jsonb);
drop table if exists public.fin_compra_itens;
alter table if exists public.fin_contas drop constraint if exists fin_contas_compra_fk;
drop table if exists public.fin_compras;
drop table if exists public.fin_contas;
drop table if exists public.fin_categorias;
drop table if exists public.fin_fornecedores;
drop function if exists public.fin_contas_guardar();
drop function if exists public.fin_compras_guardar();
drop function if exists public.fin_categorias_garantir(uuid);
alter table public.fin_config drop column if exists limite_conta_centavos;
-- O bucket financeiro-anexos fica (pode ter arquivos); apague pelo painel do Supabase se quiser.
update public.usuarios set acessos = jsonb_set(acessos, '{sensiveis}',
  coalesce((select jsonb_agg(s) from jsonb_array_elements_text(acessos->'sensiveis') s where s not in ('contas_lancar', 'contas_marcar_pago')), '[]'::jsonb))
 where acessos is not null and acessos->'sensiveis' ?| array['contas_lancar', 'contas_marcar_pago'];
do $x$ begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where name = '0143_contas_compras_dre.sql';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '0143';
  end if;
end $x$;
commit;
