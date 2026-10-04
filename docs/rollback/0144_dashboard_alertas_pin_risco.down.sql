-- Rollback da 0144 (Fase 6). Rode como postgres (dono das tabelas: as travas deixam passar).
-- Os pedidos de aprovação remota somem (as aprovações de verdade continuam em fin_aprovacoes, imutáveis).
begin;
drop trigger if exists a_eventos_auditoria_sem_senha on public.eventos_auditoria;
drop function if exists public.eventos_auditoria_sem_senha();
drop function if exists public.fin_aprovacao_remota_decidir(uuid, uuid, text, uuid, text, text, text);
drop function if exists public.fin_caixa_fechar(uuid, uuid, text, jsonb, jsonb, uuid, text, uuid, text, text, text, jsonb);
-- fin_lancar_grupo volta à versão da 0143 (sem consumir a aprovação remota).
create or replace function public.fin_lancar_grupo(p_restaurante uuid, p_turno uuid, p_chave text, p_origem text, p_usuario uuid, p_usuario_nome text,
  p_motivo text, p_aprovacao uuid, p_aprovado_por text, p_dispositivo text, p_linhas jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_grupo uuid; v_i int := 0; l jsonb;
begin
  select grupo_id into v_grupo from public.fin_lancamentos where restaurante_id = p_restaurante and chave_idempotencia = p_chave limit 1;
  if v_grupo is not null then return v_grupo; end if;
  v_grupo := gen_random_uuid();
  for l in select * from jsonb_array_elements(p_linhas) loop
    v_i := v_i + 1;
    insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem, pedido_id,
      comanda_id, pagamento_id, referencia_id, motivo, usuario_id, usuario_nome, aprovacao_id, aprovado_por_nome, chave_idempotencia, dispositivo, dados)
    values (p_restaurante, v_grupo, v_i, case when l->>'carteira' = 'gaveta' then p_turno else nullif(l->>'turno_id', '')::uuid end,
      l->>'carteira', nullif(l->>'entregador_id', '')::uuid, l->>'tipo', (l->>'valor_centavos')::bigint, nullif(l->>'forma', ''), p_origem,
      nullif(l->>'pedido_id', '')::uuid, nullif(l->>'comanda_id', '')::uuid, nullif(l->>'pagamento_id', '')::uuid, nullif(l->>'referencia_id', '')::bigint,
      left(p_motivo, 500), p_usuario, left(p_usuario_nome, 120), p_aprovacao, p_aprovado_por, p_chave, left(p_dispositivo, 200), l->'dados');
  end loop;
  return v_grupo;
end $$;
drop function if exists public.fin_usar_aprovacao(uuid);
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
