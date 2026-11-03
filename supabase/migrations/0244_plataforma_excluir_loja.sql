-- 0244 — Exclusão definitiva de uma loja pelo Super Admin (03/11/2026, pedido do dono).
-- "Excluir dados" não apagava nada: `usuarios` tem referências sem cascade (pedidos.criado_por, comandas.aberta_por…),
-- as tabelas fin_* e pagamentos_online são RESTRICT para restaurantes, e as tabelas financeiras/auditoria têm gatilho
-- imutável. Esta função roda como postgres (security definer → fin_manutencao() libera os gatilhos), solta as
-- referências aos usuários da loja, apaga tudo que tem restaurante_id = loja em passadas (repete enquanto houver
-- violação de FK entre as tabelas da própria loja), depois os usuários e por fim a loja. Só o servidor executa, e a
-- aplicação só chama depois da confirmação com o nome da loja (app/superadmin/actions.ts › excluirDadosAction).
-- Devolve quantas linhas saíram de cada tabela. Rollback: drop function if exists public.plataforma_excluir_loja(uuid);

create or replace function public.plataforma_excluir_loja(p_restaurante uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  t record;
  n integer;
  total integer;
  passada integer := 0;
  pendentes text[];
  usuarios_da_loja uuid[];
begin
  if p_restaurante is null or not exists (select 1 from public.restaurantes where id = p_restaurante) then
    raise exception 'loja não encontrada' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(id), '{}') into usuarios_da_loja from public.usuarios where restaurante_id = p_restaurante;

  -- 1. Registros de plataforma, palavras globais e assinatura ficam (histórico), sem apontar para a loja. As demais
  --    referências aos usuários da loja (pedidos.criado_por, comandas.aberta_por…) estão em linhas da própria loja, que
  --    saem no passo 2 — por isso não se atualiza nada aqui (um UPDATE em impressao_trabalhos dispararia o gatilho
  --    imutável). Quem é da loja: só para o retorno.
  update public.auditoria_plataforma set restaurante_id = null where restaurante_id = p_restaurante;
  update public.robo_palavras_globais set origem_restaurante_id = null where origem_restaurante_id = p_restaurante;
  update public.assinaturas set restaurante_id = null where restaurante_id = p_restaurante;

  -- 2. Tudo que tem restaurante_id = loja, em passadas: uma tabela que falha por FK (filha ainda cheia) fica para a
  --    passada seguinte. Para quando uma passada inteira não apaga nada nem falha.
  loop
    passada := passada + 1;
    total := 0;
    pendentes := '{}';
    for t in
      select c.table_name
        from information_schema.columns c
        join pg_catalog.pg_tables pt on pt.schemaname = c.table_schema and pt.tablename = c.table_name
       where c.table_schema = 'public' and c.column_name = 'restaurante_id'
         and c.table_name not in ('restaurantes', 'usuarios', 'auditoria_plataforma', 'assinaturas')
       order by c.table_name
    loop
      begin
        execute format('delete from public.%I where restaurante_id = $1', t.table_name) using p_restaurante;
        get diagnostics n = row_count;
        if n > 0 then r := r || jsonb_build_object(t.table_name, coalesce((r->>t.table_name)::integer, 0) + n); end if;
        total := total + n;
      exception when foreign_key_violation then
        pendentes := pendentes || t.table_name;
      end;
    end loop;
    exit when (total = 0 and array_length(pendentes, 1) is null) or passada >= 8;
  end loop;
  if array_length(pendentes, 1) is not null then
    raise exception 'não foi possível apagar: %', array_to_string(pendentes, ', ');
  end if;

  -- 3. Usuários da loja e a loja.
  delete from public.usuarios where restaurante_id = p_restaurante;
  get diagnostics n = row_count; r := r || jsonb_build_object('usuarios', n);
  delete from public.restaurantes where id = p_restaurante;
  get diagnostics n = row_count; r := r || jsonb_build_object('restaurantes', n);
  return r || jsonb_build_object('passadas', passada, 'usuarios_ids', to_jsonb(usuarios_da_loja));
end $$;
revoke all on function public.plataforma_excluir_loja(uuid) from public, anon, authenticated;
grant execute on function public.plataforma_excluir_loja(uuid) to service_role;
