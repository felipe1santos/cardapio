-- 0137 — Pedido do PDV (balcão → entrega) pago na entrega quita a comanda.
--
-- Achado da conferência em produção (2026-10-03): o registro da entrega (0136) marcava o pedido pago e
-- lançava o dinheiro no livro-caixa, mas a comanda do PDV seguia "aberta" com o total a receber.
-- Agora a entrega paga (dinheiro/cartão; Pix quando conferido) grava o pagamento NA COMANDA com
-- origem 'entrega' — que o gatilho do caixa ignora, porque o livro já recebeu — e fecha a comanda.
-- Pedido da vitrine não tem comanda: nada muda. Loja sem financeiro: entrega_registrar nem roda.

-- ── 1. origem 'entrega' nos pagamentos da comanda ───────────────────────────────────────────
alter table public.pagamentos_comanda drop constraint if exists pagamentos_origem_check;
alter table public.pagamentos_comanda add constraint pagamentos_origem_check check (origem in ('pdv', 'salao', 'entrega'));

-- ── 2. gatilho do caixa: pagamento da entrega não lança de novo ────────────────────────────
create or replace function public.fin_pagamento_no_caixa() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_turno uuid;
  v_orig public.fin_lancamentos%rowtype;
  v_centavos bigint;
begin
  if not exists (select 1 from public.restaurantes r where r.id = new.restaurante_id and r.financeiro_ativo) then
    return new;
  end if;
  -- 0137: pagamento gravado pelo registro da entrega — o livro-caixa já recebeu (motoboy, cartão, Pix).
  if new.origem = 'entrega' then return new; end if;
  select id into v_turno from public.caixa_turnos
   where restaurante_id = new.restaurante_id and fechado_em is null limit 1;

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
end $$;

-- ── 3. quitar e fechar a comanda do pedido entregue ──────────────────────────────────────────
create or replace function public.fin_quitar_comanda_entrega(
  p_restaurante uuid, p_pedido uuid, p_forma text, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  t record;
  v_forma text;
  v_valor numeric;
  v_nome text := coalesce(nullif(btrim(p_ator_nome), ''), 'Sistema');
  v_fechou boolean := false;
  v_motivo text := null;
begin
  select id, numero, comanda_id, total, cartao_tipo into p from public.pedidos
   where id = p_pedido and restaurante_id = p_restaurante;
  if p.id is null then raise exception 'pedido_inexistente'; end if;
  if p.comanda_id is null then return jsonb_build_object('comanda_id', null); end if;
  v_forma := case p_forma when 'dinheiro' then 'dinheiro' when 'pix' then 'pix'
                          when 'cartao' then case when p.cartao_tipo = 'debito' then 'debito' else 'credito' end end;
  if v_forma is null then raise exception 'forma_invalida'; end if;

  perform 1 from public.comandas where id = p.comanda_id and restaurante_id = p_restaurante for update;
  select * into t from public.comanda_totais(p.comanda_id);
  v_valor := least(t.restante, p.total);
  if v_valor > 0.004 then
    insert into public.pagamentos_comanda (restaurante_id, comanda_id, forma, valor, troco, chave_idempotencia,
      criado_por, criado_por_nome, canal, origem)
    values (p_restaurante, p.comanda_id, v_forma, v_valor, 0, 'entrega:' || p.id, p_ator, v_nome, 'balcao', 'entrega')
    on conflict do nothing;
  end if;

  -- Fecha se não sobrou nada (outro pedido ainda na cozinha, saldo de outra coisa: fica aberta).
  begin
    perform public.comanda_fechar_presencial(p_restaurante, p.comanda_id, p_ator, v_nome, 'pdv');
    v_fechou := true;
  exception when others then
    v_motivo := left(sqlerrm, 120);
  end;
  return jsonb_build_object('comanda_id', p.comanda_id, 'valor', v_valor, 'fechou', v_fechou, 'motivo', v_motivo);
end $$;
revoke execute on function public.fin_quitar_comanda_entrega(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.fin_quitar_comanda_entrega(uuid, uuid, text, uuid, text) to service_role;

-- ── 4. registro da entrega chama a quitação ─────────────────────────────────────────────────
create or replace function public.entrega_registrar(
  p_restaurante uuid, p_pedido uuid, p_entregador uuid, p_forma text, p_recebido_centavos bigint, p_nsu text,
  p_motivo text, p_chave text, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_nexta := exists (select 1 from public.nexta_entregas n where n.pedido_id = p.id);

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
end $$;
revoke execute on function public.entrega_registrar(uuid, uuid, uuid, text, bigint, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.entrega_registrar(uuid, uuid, uuid, text, bigint, text, text, text, uuid, text, text) to service_role;

-- ── 5. entregas já registradas com a comanda ainda aberta (a comanda TESTE #145 da conferência) ──
do $$
declare r record;
begin
  for r in
    select f.restaurante_id, f.pedido_id, f.forma, f.registrado_por, f.registrado_por_nome
      from public.fin_entregas_pagamento f
      join public.pedidos p on p.id = f.pedido_id
      join public.comandas c on c.id = p.comanda_id
     where f.forma in ('dinheiro', 'cartao') and c.status = 'aberta'
  loop
    perform public.fin_quitar_comanda_entrega(r.restaurante_id, r.pedido_id, r.forma, r.registrado_por, r.registrado_por_nome);
  end loop;
end $$;

