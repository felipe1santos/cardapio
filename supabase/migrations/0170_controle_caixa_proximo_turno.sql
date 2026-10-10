-- 0170 — "Ativar controle de caixa a partir do próximo turno" (09/10).
-- Nível 2 ligado com o caixa AUTOMÁTICO do nível 1 ainda aberto: o automático segue até a virada do dia operacional
-- (05:00) e aí fecha sozinho; dali em diante abrir/fechar é à mão. Antes desta migration, no nível 2 a virada não
-- rodava, e um automático aberto ficaria aberto para sempre.
--   · caixa_turno_virar_dia: no nível 2 fecha só turnos "Automático…" de dias anteriores (os abertos à mão nunca);
--   · fin_pagamento_no_caixa: chama a virada também no nível 2 (ela mesma decide o que fecha).
-- Lojas sem financeiro e nível 1: exatamente o mesmo caminho de antes. Rollback: docs/rollback/0170_….down.sql
CREATE OR REPLACE FUNCTION public.caixa_turno_virar_dia(p_restaurante uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record; v_fim timestamptz; v_n int := 0; v_estrito boolean;
begin
  -- Nível 2 (0167): abrir/fechar é à mão — só o automático que sobrou do nível 1 vira sozinho (0170).
  v_estrito := public.fin_caixa_estrito(p_restaurante);
  for t in select * from public.caixa_turnos
            where restaurante_id = p_restaurante and fechado_em is null
              and aberto_em < public.caixa_inicio_dia_operacional(now())
              and (not v_estrito or coalesce(aberto_por_nome, '') like 'Automático%') for update loop
    v_fim := public.caixa_inicio_dia_operacional(t.aberto_em) + interval '1 day';
    update public.caixa_turnos
       set fechado_em = v_fim, fechado_por_nome = 'Automático (fim do dia)',
           observacao = coalesce(observacao || ' · ', '') || 'Fechado sozinho no fim do dia operacional (05:00).'
     where id = t.id;
    perform public.auditoria_registrar(p_restaurante, null, 'Sistema', 'caixa.fechou_turno', 'caixa', t.id,
      jsonb_build_object('automatico', true, 'motivo', 'fim do dia operacional', 'aberto_em', t.aberto_em, 'fechado_em', v_fim));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.fin_pagamento_no_caixa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_turno uuid;
  v_orig public.fin_lancamentos%rowtype;
  v_centavos bigint;
  v_estrito boolean;
begin
  if not exists (select 1 from public.restaurantes r where r.id = new.restaurante_id and r.financeiro_ativo) then
    return new;
  end if;
  -- 0137: pagamento gravado pelo registro da entrega — o livro-caixa já recebeu (motoboy, cartão, Pix).
  if new.origem = 'entrega' then return new; end if;
  v_estrito := public.fin_caixa_estrito(new.restaurante_id);
  -- Virada do dia (05:00): no nível 1 fecha o automático do dia anterior; no nível 2 só o automático que sobrou (0170).
  perform public.caixa_turno_virar_dia(new.restaurante_id);
  select id into v_turno from public.caixa_turnos
   where restaurante_id = new.restaurante_id and fechado_em is null limit 1;
  -- Nível 1: sem caixa aberto, abre o automático em vez de recusar (o PDV vende igual a sem financeiro).
  if v_turno is null and not v_estrito then v_turno := public.fin_turno_automatico(new.restaurante_id); end if;

  if tg_op = 'INSERT' then
    if v_turno is null then raise exception 'caixa_fechado' using errcode = 'P0001'; end if;
    v_centavos := round(new.valor * 100)::bigint;
    if v_centavos <= 0 then return new; end if;
    insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
      comanda_id, pagamento_id, usuario_id, usuario_nome, chave_idempotencia, dados)
    values (new.restaurante_id, gen_random_uuid(), 1, v_turno, public.fin_carteira_da_forma(new.forma), 'recebimento', v_centavos, new.forma,
      case when new.canal = 'balcao' then 'balcao' else 'mesa' end,
      new.comanda_id, new.id, new.criado_por, coalesce(nullif(trim(new.criado_por_nome), ''), 'Sistema'), 'pag:' || new.id,
      jsonb_build_object('recebido_centavos', round(coalesce(new.valor_recebido, new.valor) * 100)::bigint,
                         'troco_centavos', round(coalesce(new.troco, 0) * 100)::bigint, 'origem_tela', new.origem));
    return new;
  end if;

  -- UPDATE: estorno (estornado_em passou a ter valor).
  if old.estornado_em is null and new.estornado_em is not null then
    select * into v_orig from public.fin_lancamentos
     where restaurante_id = new.restaurante_id and pagamento_id = new.id and tipo = 'recebimento' order by id limit 1;
    if v_orig.id is null then return new; end if;   -- pagamento anterior ao financeiro: nada a estornar no livro
    if v_turno is null then raise exception 'caixa_fechado' using errcode = 'P0001'; end if;
    insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
      comanda_id, pagamento_id, referencia_id, motivo, usuario_id, usuario_nome, chave_idempotencia)
    values (new.restaurante_id, gen_random_uuid(), 1, v_turno, v_orig.carteira, 'estorno', -v_orig.valor_centavos, v_orig.forma, v_orig.origem,
      new.comanda_id, new.id, v_orig.id, left(new.estorno_motivo, 500), null,
      coalesce(nullif(trim(new.estornado_por_nome), ''), 'Sistema'), 'estorno:' || new.id);
  end if;
  return new;
end $function$;
