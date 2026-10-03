-- 0135 — PDV: forma de pagamento e troco antes de lançar + caixa que abre sozinho pelo delivery.
--
-- 1. pedidos.cartao_tipo ('credito'|'debito'): detalhe do cartão escolhido no PDV. O modelo da vitrine
--    continua igual (forma_pagamento pix|cartao|dinheiro + troco_para + pago) — nada é convertido.
-- 2. comanda_lancar (0094) passa a gravar a forma e o troco vindos do PDV (p_pedido.forma_pagamento,
--    cartao_tipo, troco_para) em vez de "dinheiro" fixo. O troco é conferido contra o TOTAL DA CONTA na
--    mesma transação ('troco_menor_que_total'). A escolha vale para a conta inteira: os outros pedidos
--    ainda não pagos da mesma conta ficam com a mesma forma/troco. Sem forma (mesa, telas antigas):
--    "dinheiro" como sempre.
-- 3. Caixa aberto sozinho pela 1ª entrega (0115):
--    a) loja COM financeiro: não abre mais. A entrega em dinheiro não paga vira "a acertar" no
--       livro-caixa (carteira do motoboy, sem turno se o caixa estiver fechado).
--    b) loja SEM financeiro: o turno automático vira o DIA OPERACIONAL (05:00 às 05:00, horário de SP).
--       A entrega fecha o turno vencido no fim do dia dele e abre o do dia. A Logística para de somar dias.
-- 4. fin_config.horas_motoboy_pendente: padrão 2 h (era 3).
-- Rollback: docs/rollback/0135_pdv_pagamento_caixa_dia.down.sql

-- ── 1. detalhe do cartão ────────────────────────────────────────────────────────────────────
alter table public.pedidos add column if not exists cartao_tipo text;
alter table public.pedidos drop constraint if exists pedidos_cartao_tipo_check;
alter table public.pedidos add constraint pedidos_cartao_tipo_check
  check (cartao_tipo is null or (cartao_tipo in ('credito', 'debito') and forma_pagamento = 'cartao'));

-- ── 2. lançar com forma e troco ─────────────────────────────────────────────────────────────
create or replace function public.comanda_lancar(
  p_restaurante uuid, p_comanda uuid, p_pedido jsonb, p_itens jsonb, p_ator uuid, p_ator_nome text, p_chave text,
  p_lancado_via text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_mesa_nome text;
  v_existente record;
  v_id uuid;
  v_numero int;
  v_cliente text;
  v_primeiro boolean;
  v_taxa numeric := 0;
  v_sub numeric := (p_pedido->>'subtotal')::numeric;
  v_forma public.forma_pagamento := 'dinheiro';
  v_cartao text := null;
  v_troco numeric := null;
  v_total_conta numeric;
begin
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'nenhum_item';
  end if;
  if p_lancado_via is not null and p_lancado_via not in ('pdv', 'salao') then raise exception 'origem_invalida'; end if;

  select * into c from public.comandas where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;

  select id, numero into v_existente from public.pedidos
   where restaurante_id = p_restaurante and chave_idempotencia = p_chave;
  if v_existente.id is not null then
    return jsonb_build_object('id', v_existente.id, 'numero', v_existente.numero, 'idempotente', true);
  end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  -- Forma e troco escolhidos no PDV (balcão). Mesa: paga no fechamento, fica como sempre.
  if c.tipo = 'balcao' and nullif(p_pedido->>'forma_pagamento', '') is not null then
    if p_pedido->>'forma_pagamento' not in ('pix', 'cartao', 'dinheiro') then raise exception 'forma_invalida'; end if;
    v_forma := (p_pedido->>'forma_pagamento')::public.forma_pagamento;
    if v_forma = 'cartao' then
      v_cartao := nullif(p_pedido->>'cartao_tipo', '');
      if v_cartao is not null and v_cartao not in ('credito', 'debito') then raise exception 'forma_invalida'; end if;
    end if;
    if v_forma = 'dinheiro' and nullif(p_pedido->>'troco_para', '') is not null then
      v_troco := round((p_pedido->>'troco_para')::numeric, 2);
      if v_troco <= 0 then v_troco := null; end if;
    end if;
  end if;

  if c.tipo = 'mesa' then
    select nome into v_mesa_nome from public.mesas where id = c.mesa_id;
    v_cliente := coalesce(nullif(btrim(c.cliente_nome), ''), nullif(btrim(p_pedido->>'cliente_nome'), ''), v_mesa_nome);
  else
    v_cliente := c.cliente_nome;
  end if;

  -- A taxa de entrega é da conta; o primeiro pedido a carrega para a ficha e a logística.
  if c.entrega then
    select not exists (select 1 from public.pedidos where comanda_id = c.id) into v_primeiro;
    if v_primeiro then v_taxa := c.taxa_entrega; end if;
  end if;

  insert into public.pedidos
    (restaurante_id, tipo, status, cliente_nome, cliente_telefone, telefone_verificado,
     forma_pagamento, cartao_tipo, troco_para, pago, subtotal, desconto, taxa_entrega, total, observacao,
     endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, endereco_cidade, endereco_referencia,
     origem, canal, mesa, comanda_id, criado_por, criado_por_nome, chave_idempotencia, lancado_via)
  values
    (p_restaurante, case when c.entrega then 'entrega'::tipo_pedido else 'retirada'::tipo_pedido end, 'recebido',
     left(v_cliente, 120), coalesce(c.cliente_telefone, ''), true,
     v_forma, v_cartao, v_troco, false,
     v_sub, 0, v_taxa, round(v_sub + v_taxa, 2), coalesce(case when c.entrega then c.entrega_observacao end, ''),
     coalesce(case when c.entrega then c.entrega_rua end, ''), coalesce(case when c.entrega then c.entrega_numero end, ''),
     coalesce(case when c.entrega then c.entrega_complemento end, ''), coalesce(case when c.entrega then c.entrega_bairro end, ''),
     coalesce(case when c.entrega then c.entrega_cep end, ''), coalesce(case when c.entrega then c.entrega_cidade end, ''),
     coalesce(case when c.entrega then c.entrega_referencia end, ''),
     'pdv', c.tipo, v_mesa_nome, c.id, p_ator, p_ator_nome, p_chave, p_lancado_via)
  returning id, numero into v_id, v_numero;

  insert into public.pedido_itens
    (pedido_id, item_id, nome, preco_unitario, quantidade, observacao, complementos,
     tamanho_nome, sabor_nome, borda_nome, massa_nome)
  select v_id, x.item_id, x.nome, x.preco_unitario, x.quantidade, coalesce(x.observacao, ''),
         coalesce(x.complementos, '[]'::jsonb), coalesce(x.tamanho_nome, ''), coalesce(x.sabor_nome, ''),
         coalesce(x.borda_nome, ''), coalesce(x.massa_nome, '')
    from jsonb_to_recordset(p_itens) as x(
      item_id uuid, nome text, preco_unitario numeric, quantidade int, observacao text, complementos jsonb,
      tamanho_nome text, sabor_nome text, borda_nome text, massa_nome text);

  if c.tipo = 'balcao' and nullif(p_pedido->>'forma_pagamento', '') is not null then
    -- O troco é para a conta inteira (o motoboy leva para tudo): tem que ser MAIOR que o total.
    if v_troco is not null then
      select t.total into v_total_conta from public.comanda_totais(c.id) t;
      if v_troco <= v_total_conta then raise exception 'troco_menor_que_total:%', v_total_conta; end if;
    end if;
    -- Uma forma por conta: os pedidos ainda não pagos desta conta acompanham a escolha.
    update public.pedidos set forma_pagamento = v_forma, cartao_tipo = v_cartao, troco_para = v_troco
     where comanda_id = c.id and id <> v_id and not pago and status <> 'cancelado'
       and (forma_pagamento, cartao_tipo, troco_para) is distinct from (v_forma, v_cartao, v_troco);
  end if;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'idempotente', false);
end $$;

-- ── 3. dia operacional e caixa automático ───────────────────────────────────────────────────
-- Início do dia operacional que contém o instante: 05:00 (SP) — a madrugada fica no dia anterior.
create or replace function public.caixa_inicio_dia_operacional(p_instante timestamptz)
returns timestamptz language sql immutable as $$
  select ((date_trunc('day', (p_instante at time zone 'America/Sao_Paulo') - interval '5 hours') + interval '5 hours')
          at time zone 'America/Sao_Paulo')
$$;

-- Loja SEM financeiro: turno aberto que começou antes do dia operacional atual fecha no fim do dia
-- dele (05:00 seguinte), sem mexer em entregas nem valores. Devolve quantos fechou.
create or replace function public.caixa_turno_virar_dia(p_restaurante uuid)
returns int language plpgsql security definer set search_path = public as $$
declare t record; v_fim timestamptz; v_n int := 0;
begin
  if exists (select 1 from public.restaurantes where id = p_restaurante and financeiro_ativo) then return 0; end if;
  for t in select * from public.caixa_turnos
            where restaurante_id = p_restaurante and fechado_em is null
              and aberto_em < public.caixa_inicio_dia_operacional(now()) for update loop
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
end $$;
revoke execute on function public.caixa_turno_virar_dia(uuid) from public, anon, authenticated;
grant execute on function public.caixa_turno_virar_dia(uuid) to service_role;

create or replace function public.caixa_turno_abre_na_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fin boolean;
  v_turno uuid;
  v_pago boolean;
begin
  if not (new.status = 'entregue' and old.status is distinct from 'entregue' and new.entregador_id is not null) then
    return null;
  end if;
  select financeiro_ativo into v_fin from public.restaurantes where id = new.restaurante_id;

  if coalesce(v_fin, false) then
    -- Financeiro ligado: o caixa NÃO abre sozinho. Dinheiro não pago vira "a acertar" do motoboy.
    if new.forma_pagamento = 'dinheiro' then
      v_pago := new.pago or (new.comanda_id is not null and exists (
        select 1 from public.comanda_totais(new.comanda_id) t where t.total > 0 and t.restante <= 0.004));
      if not v_pago then
        select id into v_turno from public.caixa_turnos where restaurante_id = new.restaurante_id and fechado_em is null limit 1;
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos,
          forma, origem, pedido_id, comanda_id, usuario_nome, chave_idempotencia, dados)
        values (new.restaurante_id, gen_random_uuid(), 1, v_turno, 'motoboy', new.entregador_id, 'pendencia_motoboy',
          round(new.total * 100)::bigint, 'dinheiro', 'delivery', new.id, new.comanda_id, 'Sistema', 'pend:' || new.id,
          jsonb_build_object('troco_para_centavos', round(coalesce(new.troco_para, 0) * 100)::bigint, 'numero', new.numero))
        on conflict do nothing;
      end if;
    end if;
    return null;
  end if;

  -- Sem financeiro: turno automático = dia operacional.
  perform public.caixa_turno_virar_dia(new.restaurante_id);
  insert into public.caixa_turnos (restaurante_id, aberto_em, aberto_por_nome)
  values (new.restaurante_id, now(), 'Automático (1ª entrega)')
  on conflict (restaurante_id) where fechado_em is null do nothing;
  return null;
end $$;
revoke execute on function public.caixa_turno_abre_na_entrega() from public, anon, authenticated;

-- ── 4. alerta do dinheiro a acertar: padrão 2 h ─────────────────────────────────────────────
alter table public.fin_config alter column horas_motoboy_pendente set default 2;
update public.fin_config set horas_motoboy_pendente = 2 where horas_motoboy_pendente = 3;
