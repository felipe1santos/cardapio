-- Rollback da 0162: volta fin_lancar_grupo à versão da 0144 (sem a trava da gaveta no banco).
CREATE OR REPLACE FUNCTION public.fin_lancar_grupo(p_restaurante uuid, p_turno uuid, p_chave text, p_origem text, p_usuario uuid, p_usuario_nome text, p_motivo text, p_aprovacao uuid, p_aprovado_por text, p_dispositivo text, p_linhas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_grupo uuid; v_i int := 0; l jsonb;
begin
  select grupo_id into v_grupo from public.fin_lancamentos where restaurante_id = p_restaurante and chave_idempotencia = p_chave limit 1;
  if v_grupo is not null then return v_grupo; end if;
  perform public.fin_usar_aprovacao(p_aprovacao);
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
end $function$
;
