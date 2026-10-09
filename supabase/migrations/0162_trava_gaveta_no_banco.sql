-- 0162 — Trava da gaveta NO BANCO (acabamento do financeiro, 09/10).
-- A conferência "há dinheiro na gaveta?" ficava no app (fila em memória): só vale com uma instância, e
-- durante um deploy o Coolify roda o container velho e o novo juntos por alguns segundos. Agora quem
-- garante é o banco: toda saída da gaveta (sangria, retirada, despesa, perda, compra/conta paga com o
-- caixa) trava o caixa com pg_advisory_xact_lock e confere o saldo NA MESMA transação que grava.
-- Recusa com 'gaveta_insuficiente:<saldo em centavos>' (o app mostra "Só há R$ X na gaveta.").
-- Entradas e os outros tipos (troco de motoboy, ajuste do fechamento, estornos) não mudam.
-- Mesma assinatura (grants preservados). Rollback: docs/rollback/0162_trava_gaveta_no_banco.down.sql
create or replace function public.fin_lancar_grupo(p_restaurante uuid, p_turno uuid, p_chave text, p_origem text, p_usuario uuid, p_usuario_nome text,
  p_motivo text, p_aprovacao uuid, p_aprovado_por text, p_dispositivo text, p_linhas jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_grupo uuid; v_i int := 0; l jsonb; v_saida bigint; v_saldo bigint;
begin
  select grupo_id into v_grupo from public.fin_lancamentos where restaurante_id = p_restaurante and chave_idempotencia = p_chave limit 1;
  if v_grupo is not null then return v_grupo; end if;
  -- Saída da gaveta: uma por vez por caixa, conferindo o saldo depois de pegar a vez.
  select coalesce(-sum((x->>'valor_centavos')::bigint), 0) into v_saida from jsonb_array_elements(p_linhas) x
   where x->>'carteira' = 'gaveta' and x->>'tipo' in ('sangria', 'retirada', 'despesa', 'perda', 'compra') and (x->>'valor_centavos')::bigint < 0;
  if v_saida > 0 then
    if p_turno is null then raise exception 'caixa_fechado'; end if;
    perform pg_advisory_xact_lock(hashtextextended('fin_gaveta:' || p_turno::text, 0));
    -- Enquanto esperava a vez, a mesma requisição (clique duplo) pode ter gravado.
    select grupo_id into v_grupo from public.fin_lancamentos where restaurante_id = p_restaurante and chave_idempotencia = p_chave limit 1;
    if v_grupo is not null then return v_grupo; end if;
    select coalesce(sum(valor_centavos), 0) into v_saldo from public.fin_lancamentos
     where restaurante_id = p_restaurante and turno_id = p_turno and carteira = 'gaveta';
    if v_saida > v_saldo then raise exception 'gaveta_insuficiente:%', greatest(v_saldo, 0); end if;
  end if;
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
end $function$;
