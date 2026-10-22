-- 0218 — RLS: funções de sessão calculadas 1 vez por consulta, não 1 vez por linha (22/10/2026, auditoria de desempenho).
-- auth_restaurante_id() / auth_papel() / auth_e_gestor() são SECURITY DEFINER: o Postgres não as embute, então numa
-- política `restaurante_id = auth_restaurante_id()` elas rodam para CADA linha (2 consultas a usuarios por linha —
-- 56 mi de leituras sequenciais em usuarios). Envolver em `(select fn())` vira InitPlan: mesmo resultado (as funções
-- são STABLE e só dependem de auth.uid(), constante na consulta), calculado uma vez. Medido em pedidos da Menuzia
-- (300 linhas): 23,5 ms → 1,6 ms. Recomendação "auth_rls_initplan" do advisor do Supabase.
-- Só reescreve o texto das políticas do schema public (ALTER POLICY mantém nome, comando, papéis e permissivo).
-- Idempotente: pula política que já tem `SELECT auth_`. Conferência: foto do que cada usuário vê, antes = depois.
-- Rollback: o mesmo laço trocando `(select public.fn())` de volta por `public.fn()`.
set lock_timeout = '3s';
do $$
declare
  p record;
  padrao constant text := '(public\.)?(auth_restaurante_id|auth_papel|auth_e_gestor)\(\)';
  novo_using text;
  novo_check text;
  sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') || coalesce(with_check, '') ~ padrao
      and coalesce(qual, '') || coalesce(with_check, '') !~* 'select\s+(public\.)?auth_'
  loop
    novo_using := regexp_replace(p.qual, padrao, '(select public.\2())', 'g');
    novo_check := regexp_replace(p.with_check, padrao, '(select public.\2())', 'g');
    sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if novo_using is not null then sql := sql || format(' using (%s)', novo_using); end if;
    if novo_check is not null then sql := sql || format(' with check (%s)', novo_check); end if;
    execute sql;
  end loop;
end $$;
