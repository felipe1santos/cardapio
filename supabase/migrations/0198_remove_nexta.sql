-- 0198 (17/10/2026): REMOVE A INTEGRAÇÃO NEXTA. Nenhuma loja usava (só a Menuzia, desligada; 5 entregas de teste de julho).
-- Backup do conteúdo (fora do git): ~/menuzia-backups/nexta-0198-*.json. Aplicar DEPOIS do deploy do código sem a Nexta.
-- Pedidos antigos continuam abrindo: só sai o vínculo pedidos.nexta_entrega_id. O registro financeiro
-- (fin_entregas_pagamento.nexta) fica como está (histórico); a função passa a gravar sempre false.

CREATE OR REPLACE FUNCTION public.entrega_registrar(p_restaurante uuid, p_pedido uuid, p_entregador uuid, p_forma text, p_recebido_centavos bigint, p_nsu text, p_motivo text, p_chave text, p_ator uuid, p_ator_nome text, p_origem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p record;
  v_ja record;
  v_total bigint;
  v_troco bigint := null;
  v_recebido bigint := null;
  v_forma text := p_forma;
  v_pago_antes boolean;
  v_turno uuid;
  v_grupo uuid := gen_random_uuid();
  v_linha int := 0;
  v_pend bigint;
  v_nexta boolean;
  v_chave text := 'entrega:' || p_pedido;
  v_nome text := coalesce(nullif(btrim(p_ator_nome), ''), 'Sistema');
  v_ent uuid;
  v_quitou jsonb := null;
begin
  if p_chave is null or length(p_chave) < 8 then raise exception 'chave_invalida'; end if;
  if p_origem not in ('motoboy', 'operador') then raise exception 'origem_invalida'; end if;
  if p_forma not in ('dinheiro', 'cartao', 'pix', 'nao_pago') then raise exception 'forma_invalida'; end if;
  if not exists (select 1 from public.restaurantes where id = p_restaurante and financeiro_ativo) then raise exception 'financeiro_inativo'; end if;

  select * into p from public.pedidos where id = p_pedido and restaurante_id = p_restaurante for update;
  if p.id is null then raise exception 'pedido_inexistente'; end if;

  -- Repetição (internet instável, clique duplo): devolve o que já foi gravado.
  select * into v_ja from public.fin_entregas_pagamento where pedido_id = p_pedido;
  if v_ja.id is not null then
    if v_ja.chave_idempotencia = p_chave then return jsonb_build_object('id', v_ja.id, 'forma', v_ja.forma, 'idempotente', true); end if;
    raise exception 'ja_registrado';
  end if;

  if p.tipo <> 'entrega' or p.status = 'cancelado' then raise exception 'pedido_invalido'; end if;
  if p_origem = 'motoboy' then
    -- O motoboy só registra a entrega DELE, ainda em rota.
    if p_entregador is null or p.entregador_id is distinct from p_entregador then raise exception 'pedido_de_outro'; end if;
    if p.status <> 'em_rota' then raise exception 'pedido_nao_em_rota'; end if;
  else
    if p.status not in ('em_rota', 'entregue') then raise exception 'pedido_nao_saiu'; end if;
  end if;

  v_ent := coalesce(p_entregador, p.entregador_id);
  v_total := round(p.total * 100)::bigint;
  v_pago_antes := p.pago or (p.comanda_id is not null and exists (
    select 1 from public.comanda_totais(p.comanda_id) t where t.total > 0 and t.restante <= 0.004));
  if v_pago_antes then v_forma := 'ja_pago'; end if;
  v_nexta := false; -- Nexta removida (0198): a coluna nexta do registro fica falsa; o histórico não muda.

  if v_forma = 'dinheiro' then
    v_recebido := coalesce(p_recebido_centavos, v_total);
    if v_recebido < v_total then raise exception 'recebido_menor_que_total:%', round(v_total / 100.0, 2); end if;
    v_troco := v_recebido - v_total;
  elsif v_forma = 'nao_pago' then
    if coalesce(length(btrim(p_motivo)), 0) < 3 then raise exception 'motivo_obrigatorio'; end if;
  end if;

  select id into v_turno from public.caixa_turnos where restaurante_id = p_restaurante and fechado_em is null limit 1;

  insert into public.fin_entregas_pagamento (restaurante_id, pedido_id, entregador_id, forma, total_centavos, recebido_centavos,
    troco_dado_centavos, nsu, motivo, nexta, origem, registrado_por, registrado_por_nome, chave_idempotencia)
  values (p_restaurante, p.id, case when p_origem = 'motoboy' then p_entregador else p.entregador_id end, v_forma, v_total, v_recebido,
    v_troco, nullif(btrim(p_nsu), ''), nullif(btrim(p_motivo), ''), v_nexta, p_origem, p_ator, v_nome, p_chave);

  if v_forma <> 'ja_pago' then
    -- Pendência automática da 0135 (entregue sem registro): desfaz, o registro manda.
    select coalesce(sum(valor_centavos), 0) into v_pend from public.fin_lancamentos
     where restaurante_id = p_restaurante and pedido_id = p.id and tipo = 'pendencia_motoboy';
    if v_pend <> 0 then
      v_linha := v_linha + 1;
      insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem,
        pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
      values (p_restaurante, v_grupo, v_linha, null, 'motoboy', p.entregador_id, 'ajuste', -v_pend, 'dinheiro', 'delivery',
        p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('motivo', 'pendência substituída pelo registro da entrega'));
    end if;

    if v_forma = 'dinheiro' and v_ent is not null then
      -- Dinheiro na mão do motoboy: entra o que o cliente deu, sai o troco que ele devolveu.
      v_linha := v_linha + 1;
      insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem,
        pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
      values (p_restaurante, v_grupo, v_linha, null, 'motoboy', v_ent, 'recebimento', v_recebido, 'dinheiro', 'motoboy',
        p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('numero', p.numero));
      if v_troco > 0 then
        v_linha := v_linha + 1;
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem,
          pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
        values (p_restaurante, v_grupo, v_linha, null, 'motoboy', v_ent, 'troco', -v_troco, 'dinheiro', 'motoboy',
          p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('numero', p.numero));
      end if;
    else
      v_linha := v_linha + 1;
      if v_forma = 'dinheiro' and v_nexta then
        -- Nexta: o entregador terceirizado recebeu; fica a receber até o repasse.
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
          pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
        values (p_restaurante, v_grupo, v_linha, null, 'a_receber', 'recebimento', v_total, 'dinheiro', 'delivery',
          p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('numero', p.numero, 'nexta', true));
      elsif v_forma = 'dinheiro' then
        -- Sem motoboy: quem registra recebeu o dinheiro na volta — vai para a gaveta do caixa aberto.
        if v_turno is null then raise exception 'caixa_fechado'; end if;
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
          pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
        values (p_restaurante, v_grupo, v_linha, v_turno, 'gaveta', 'recebimento', v_total, 'dinheiro', 'delivery',
          p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('numero', p.numero, 'recebido_centavos', v_recebido, 'troco_centavos', v_troco));
      else
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem,
          pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
        values (p_restaurante, v_grupo, v_linha, null,
          case v_forma when 'cartao' then 'cartao' when 'pix' then 'pix_conferir' else 'a_receber' end,
          p.entregador_id, 'recebimento', v_total, case v_forma when 'nao_pago' then null else v_forma end, 'delivery',
          p.id, p.comanda_id, p_ator, v_nome, v_chave,
          jsonb_build_object('numero', p.numero, 'nsu', nullif(btrim(p_nsu), ''), 'motivo', nullif(btrim(p_motivo), ''), 'nexta', v_nexta));
      end if;
    end if;
  end if;

  -- Status: o motoboy conclui a entrega; dinheiro e cartão ficam pagos (Pix só depois de conferido).
  update public.pedidos
     set status = case when status = 'em_rota' then 'entregue'::status_pedido else status end,
         pago = pago or v_forma in ('dinheiro', 'cartao')
   where id = p.id;

  -- 0137: pedido do PDV (balcão → entrega) pago na entrega quita e fecha a comanda, sem lançar de novo no caixa.
  if p.comanda_id is not null and v_forma in ('dinheiro', 'cartao') then
    v_quitou := public.fin_quitar_comanda_entrega(p_restaurante, p.id, v_forma, p_ator, v_nome);
  end if;

  perform public.auditoria_registrar(p_restaurante, p_ator, v_nome, 'entrega.pagamento_registrado', 'pedido', p.id,
    jsonb_build_object('numero', p.numero, 'forma', v_forma, 'total_centavos', v_total, 'recebido_centavos', v_recebido,
      'troco_dado_centavos', v_troco, 'nsu', nullif(btrim(p_nsu), ''), 'motivo', nullif(btrim(p_motivo), ''), 'origem', p_origem, 'nexta', v_nexta));

  return jsonb_build_object('forma', v_forma, 'total_centavos', v_total, 'troco_dado_centavos', v_troco, 'idempotente', false, 'comanda', v_quitou);
end $function$;

alter table public.pedidos drop column if exists nexta_entrega_id;
drop table if exists public.nexta_entregas;
drop table if exists public.nexta_config;
