-- ============================================================================
-- 0096 — PDV v2: fechamento completo da conta numa transação só; cupom na conta;
--        trava de fidelidade por conta
--
-- "Fechar conta" agora faz, com a comanda travada e tudo-ou-nada:
--   1. decisões da cozinha, uma por pedido pendente: `entregue` ou `cancelar`
--      (motivo obrigatório, cancelamento por pedido inteiro ou por itens — o modelo
--      que já existe; nada é simulado);
--   2. conferência financeira: pago acima do novo total ⇒ NADA vale
--      ('ajuste_financeiro_necessario'); o operador estorna/ajusta antes (auditado);
--   3. pagamentos (uma ou mais formas, cada um com sua chave);
--   4. uso do cupom da conta (reservado agora, no momento válido — nunca na criação);
--   5. fechamento (comanda_fechar_presencial: pendências, saldo, mesa em limpeza);
--   6. auditoria de cada passo.
-- Idempotente: `chave_fechamento`. Mesma chave depois de fechada = mesma resposta;
-- outra aba/operador com outra chave recebe 'comanda_nao_aberta' e nada dele vale.
--
-- `comanda_fechamento_simular` roda as mesmas decisões e desfaz: a tela mostra o
-- total recalculado pelo BANCO antes de pedir o pagamento.
-- ============================================================================

alter table public.comandas add column if not exists chave_fechamento text;
alter table public.comandas add column if not exists fidelidade_processado boolean not null default false;
alter table public.comandas add column if not exists cupom_id uuid references public.cupons(id) on delete set null;
alter table public.comandas add column if not exists cupom_codigo text;
alter table public.comandas add column if not exists cupom_taxa_entrega_original numeric(10,2);
create unique index if not exists comandas_chave_fechamento_unq
  on public.comandas (restaurante_id, chave_fechamento) where chave_fechamento is not null;

-- Desconto mexido à mão depois do cupom: o cupom sai da conta (não se cobra uso de
-- cupom que não está mais dando desconto). Só a função do cupom marca a sessão.
create or replace function public.comanda_cupom_consistente()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.cupom_id is not null and new.cupom_id is not distinct from old.cupom_id
     and coalesce(current_setting('menuzia.cupom', true), '') <> '1'
     and (new.desconto_tipo is distinct from old.desconto_tipo or new.desconto_valor is distinct from old.desconto_valor
          or new.desconto_percentual is distinct from old.desconto_percentual) then
    new.cupom_id := null;
    new.cupom_codigo := null;
  end if;
  return new;
end $$;
drop trigger if exists comanda_cupom_consistente on public.comandas;
create trigger comanda_cupom_consistente before update on public.comandas
  for each row execute function public.comanda_cupom_consistente();

-- ─── cupom na conta ────────────────────────────────────────────────────────────
-- As regras do cupom (validade, dia, mínimo, público, uso por cliente) são checadas no
-- servidor com as MESMAS funções do delivery (validarCupom) antes de chamar isto. Aqui:
-- conta aberta, telefone identificado, e o efeito no desconto/frete com auditoria.
create or replace function public.comanda_cupom_aplicar(
  p_restaurante uuid, p_comanda uuid, p_cupom uuid, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  k record;
begin
  select id, status, tipo, cliente_telefone, entrega, taxa_entrega, cupom_id, cupom_taxa_entrega_original into c
    from public.comandas where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;
  if c.cliente_telefone is null then raise exception 'cupom_exige_telefone'; end if;
  select id, codigo, tipo, valor, ativo into k from public.cupons where id = p_cupom and restaurante_id = p_restaurante;
  if k.id is null or not k.ativo then raise exception 'cupom_invalido'; end if;
  if k.tipo = 'item_gratis' then raise exception 'cupom_item_gratis_pdv'; end if;
  if k.tipo = 'entrega_gratis' and not c.entrega then raise exception 'cupom_so_entrega'; end if;

  perform set_config('menuzia.cupom', '1', true);
  -- Troca de cupom: devolve o frete de um entrega_gratis anterior.
  update public.comandas
     set taxa_entrega = coalesce(cupom_taxa_entrega_original, taxa_entrega), cupom_taxa_entrega_original = null
   where id = c.id and cupom_taxa_entrega_original is not null;
  update public.comandas
     set cupom_id = k.id, cupom_codigo = k.codigo,
         desconto_tipo = case when k.tipo = 'desconto_percentual' then 'percentual' else 'valor' end,
         desconto_percentual = case when k.tipo = 'desconto_percentual' then least(greatest(k.valor, 0), 100) else 0 end,
         desconto_valor = case when k.tipo = 'desconto_valor' then greatest(k.valor, 0) else 0 end,
         desconto_motivo = 'Cupom ' || k.codigo,
         cupom_taxa_entrega_original = case when k.tipo = 'entrega_gratis' then taxa_entrega end,
         taxa_entrega = case when k.tipo = 'entrega_gratis' then 0 else taxa_entrega end
   where id = c.id;
  perform set_config('menuzia.cupom', '', true);
  perform public.comanda_conferir_pago(c.id);

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'conta.cupom_aplicado', 'comanda', c.id,
    jsonb_build_object('cupom', k.codigo, 'tipo', k.tipo, 'valor', k.valor, 'origem', coalesce(p_origem, 'pdv'),
                       'resumo', 'Cupom ' || k.codigo));
  return jsonb_build_object('id', c.id, 'cupom', k.codigo);
end $$;

create or replace function public.comanda_cupom_remover(
  p_restaurante uuid, p_comanda uuid, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select id, status, cupom_id, cupom_codigo into c from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;
  if c.cupom_id is null then return jsonb_build_object('id', c.id, 'idempotente', true); end if;
  perform set_config('menuzia.cupom', '1', true);
  update public.comandas
     set cupom_id = null, cupom_codigo = null, desconto_tipo = 'valor', desconto_valor = 0, desconto_percentual = 0,
         desconto_motivo = null, taxa_entrega = coalesce(cupom_taxa_entrega_original, taxa_entrega),
         cupom_taxa_entrega_original = null
   where id = c.id;
  perform set_config('menuzia.cupom', '', true);
  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'conta.cupom_removido', 'comanda', c.id,
    jsonb_build_object('cupom', c.cupom_codigo, 'origem', coalesce(p_origem, 'pdv'), 'resumo', 'Cupom ' || c.cupom_codigo || ' removido'));
  return jsonb_build_object('id', c.id, 'idempotente', false);
end $$;

-- ─── decisões da cozinha (interna: simular e fechar usam a mesma) ─────────────
-- p_acoes: [{pedido_id, acao: 'entregue' | 'cancelar', motivo?, item_ids?: uuid[]}]
create or replace function public.comanda_aplicar_decisoes(
  p_restaurante uuid, p_comanda uuid, p_acoes jsonb, p_ator uuid, p_ator_nome text, p_papel text, p_origem text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  p record;
  np record;
  v_motivo text;
  v_novo_atend text;
  v_n int := 0;
  v_valor_antes numeric;
begin
  if p_acoes is null or jsonb_typeof(p_acoes) <> 'array' then return 0; end if;
  for a in
    select (x->>'pedido_id')::uuid as pedido_id, x->>'acao' as acao, nullif(btrim(coalesce(x->>'motivo', '')), '') as motivo,
           coalesce((select array_agg(v::uuid) from jsonb_array_elements_text(x->'item_ids') v), '{}'::uuid[]) as item_ids
      from jsonb_array_elements(p_acoes) x
  loop
    select id, numero, canal, tipo, status::text as status, atendimento_status, total into p
      from public.pedidos where id = a.pedido_id and comanda_id = p_comanda and restaurante_id = p_restaurante for update;
    if p.id is null then raise exception 'pedido_inexistente'; end if;
    if p.status = 'cancelado' then raise exception 'ja_cancelado'; end if;
    v_valor_antes := p.total;
    v_novo_atend := case when p.canal = 'mesa' then 'servido' else 'entregue_balcao' end;

    if a.acao = 'entregue' then
      if p.status not in ('recebido', 'preparando', 'pronto', 'em_rota') then raise exception 'acao_invalida:%', a.acao; end if;
      -- Pronto → é o atendimento de sempre. Antes de pronto (ou em rota) → marcação forçada, auditada.
      update public.pedidos
         set atendimento_status = v_novo_atend, atendido_em = now(), atendido_por = p_ator, atendido_por_nome = p_ator_nome,
             status = 'entregue', resolvido_forcado = (p.status <> 'pronto')
       where id = p.id;
    elsif a.acao = 'cancelar' then
      v_motivo := a.motivo;
      if v_motivo is null or length(v_motivo) < 5 then raise exception 'motivo_obrigatorio'; end if;
      if cardinality(a.item_ids) = 0 then
        update public.pedidos
           set status = 'cancelado', cancelado_motivo = 'outro', cancelado_observacao = v_motivo,
               cancelado_por = p_ator_nome, cancelado_em = now(), reimprimir = false, resolvido_forcado = true
         where id = p.id;
      else
        update public.pedido_itens
           set cancelado_em = now(), cancelado_motivo = v_motivo, cancelado_por_nome = p_ator_nome
         where pedido_id = p.id and id = any(a.item_ids) and cancelado_em is null;
        if not exists (select 1 from public.pedido_itens where pedido_id = p.id and cancelado_em is null) then
          update public.pedidos
             set status = 'cancelado', cancelado_motivo = 'outro', cancelado_observacao = v_motivo,
                 cancelado_por = p_ator_nome, cancelado_em = now(), reimprimir = false, resolvido_forcado = true
           where id = p.id;
        else
          perform public.pedido_recalcular(p.id);
          update public.pedidos set resolvido_forcado = true where id = p.id;
        end if;
      end if;
    else
      raise exception 'acao_invalida:%', coalesce(a.acao, '');
    end if;

    select status::text as status, atendimento_status, total into np from public.pedidos where id = p.id;
    v_n := v_n + 1;
    perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome,
      case when a.acao = 'cancelar' then 'pedido.cancelou'
           when p.status = 'pronto' then 'pedido.atendido' else 'pedido.entregue_forcado' end,
      'pedido', p.id,
      jsonb_build_object('numero', p.numero, 'acao', a.acao, 'motivo', a.motivo, 'origem', p_origem, 'papel', p_papel,
                         'comanda_id', p_comanda, 'de', p.status, 'para', np.status,
                         'itens_cancelados', to_jsonb(a.item_ids),
                         'estado_anterior', jsonb_build_object('cozinha', p.status, 'atendimento', p.atendimento_status),
                         'estado_novo', jsonb_build_object('cozinha', np.status, 'atendimento', np.atendimento_status),
                         'valor_afetado', round(v_valor_antes - case when np.status = 'cancelado' then 0 else np.total end, 2),
                         'no_fechamento', true));
  end loop;
  return v_n;
end $$;

-- ─── simulação (mesmas decisões, desfeitas) ────────────────────────────────────
create or replace function public.comanda_fechamento_simular(
  p_restaurante uuid, p_comanda uuid, p_acoes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_cancelados jsonb;
  v_resultado jsonb;
begin
  perform 1 from public.comandas where id = p_comanda and restaurante_id = p_restaurante and status = 'aberta';
  if not found then raise exception 'comanda_nao_aberta'; end if;
  begin
    perform public.comanda_aplicar_decisoes(p_restaurante, p_comanda, p_acoes, null, 'simulação', null, 'simulacao');
    select * into t from public.comanda_totais(p_comanda);
    select coalesce(sum(i.preco_unitario * i.quantidade), 0) into v_cancelados
      from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
     where p.comanda_id = p_comanda and (p.status = 'cancelado' or i.cancelado_em is not null);
    v_resultado := jsonb_build_object('subtotal', t.subtotal, 'taxa', t.taxa_servico, 'desconto', t.desconto,
      'total', t.total, 'pago', t.pago, 'restante', t.restante, 'cancelados', round(v_cancelados::numeric, 2),
      'excedente', greatest(round(t.pago - t.total, 2), 0),
      'taxa_entrega', (select taxa_entrega from public.comandas where id = p_comanda));
    raise exception 'simulacao_ok';
  exception when others then
    if sqlerrm <> 'simulacao_ok' then raise; end if;
  end;
  return v_resultado;
end $$;

-- ─── fechamento completo ───────────────────────────────────────────────────────
-- p_pagamentos: [{forma, valor, recebido?, chave, observacao?}] — formas já conferidas
-- contra as formas da loja no servidor.
create or replace function public.comanda_fechar_completo(
  p_restaurante uuid, p_comanda uuid, p_acoes jsonb, p_pagamentos jsonb, p_ator uuid, p_ator_nome text,
  p_papel text, p_origem text, p_chave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  t record;
  x jsonb;
  r jsonb;
  v_decisoes int := 0;
  v_pags int := 0;
  v_fechou jsonb;
  v_pedido_cupom uuid;
  v_mesa_nome text;
begin
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;
  if p_origem not in ('pdv', 'salao') then raise exception 'origem_invalida'; end if;

  select id, status, tipo, mesa_id, numero, senha, cliente_nome, cliente_telefone, chave_fechamento, total_final,
         cupom_id, cupom_codigo, entrega
    into c from public.comandas where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;
  if c.status = 'fechada' and c.chave_fechamento = p_chave then
    return jsonb_build_object('id', c.id, 'idempotente', true, 'total', c.total_final);
  end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  v_decisoes := public.comanda_aplicar_decisoes(p_restaurante, p_comanda, p_acoes, p_ator, p_ator_nome, p_papel, p_origem);

  select * into t from public.comanda_totais(p_comanda);
  if t.pago > t.total then
    raise exception 'ajuste_financeiro_necessario:%', round(t.pago - t.total, 2);
  end if;

  if p_pagamentos is not null and jsonb_typeof(p_pagamentos) = 'array' then
    for x in select * from jsonb_array_elements(p_pagamentos) loop
      r := public.comanda_pagamento_registrar(p_restaurante, p_comanda, x->>'forma', (x->>'valor')::numeric,
             nullif(x->>'recebido', '')::numeric, x->>'chave', p_ator, p_ator_nome, x->>'observacao', p_origem);
      if not coalesce((r->>'idempotente')::boolean, false) then
        v_pags := v_pags + 1;
        perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'conta.pagamento', 'comanda', p_comanda,
          jsonb_build_object('pagamento_id', r->>'id', 'forma', x->>'forma', 'valor', round((x->>'valor')::numeric, 2),
                             'troco', r->'troco', 'canal', c.tipo, 'origem', p_origem, 'no_fechamento', true,
                             'resumo', (x->>'forma') || ' R$ ' || to_char(round((x->>'valor')::numeric, 2), 'FM999990.00')));
      end if;
    end loop;
  end if;

  -- Cupom: o uso conta agora (conta paga), uma vez por conta — reabrir e fechar de
  -- novo não usa o cupom duas vezes.
  if c.cupom_id is not null then
    if c.cliente_telefone is null then raise exception 'cupom_exige_telefone'; end if;
    select p.id into v_pedido_cupom from public.pedidos p
     where p.comanda_id = p_comanda and p.status <> 'cancelado' order by p.criado_em, p.numero limit 1;
    if v_pedido_cupom is null then raise exception 'nenhum_item'; end if;
    if not exists (select 1 from public.cupom_usos u join public.pedidos p on p.id = u.pedido_id
                    where u.cupom_id = c.cupom_id and p.comanda_id = p_comanda) then
      if not public.cupom_reservar_uso(c.cupom_id, p_restaurante) then raise exception 'cupom_esgotado'; end if;
      begin
        insert into public.cupom_usos (cupom_id, restaurante_id, cliente_telefone, pedido_id)
        values (c.cupom_id, p_restaurante, c.cliente_telefone, v_pedido_cupom);
      exception when unique_violation then
        raise exception 'cupom_ja_usado';
      end;
      update public.pedidos set cupom_codigo = c.cupom_codigo where id = v_pedido_cupom;
    end if;
  end if;

  v_fechou := public.comanda_fechar_presencial(p_restaurante, p_comanda, p_ator, p_ator_nome, p_origem);
  update public.comandas set chave_fechamento = p_chave where id = p_comanda;

  if c.mesa_id is not null then select nome into v_mesa_nome from public.mesas where id = c.mesa_id; end if;
  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'conta.fechou', 'comanda', p_comanda,
    jsonb_build_object('de', 'aberta', 'para', 'fechada', 'numero', c.numero, 'senha', c.senha, 'canal', c.tipo,
                       'origem', p_origem, 'mesa', v_mesa_nome, 'decisoes', v_decisoes, 'pagamentos', v_pags,
                       'total', v_fechou->'total', 'pago', v_fechou->'pago', 'cupom', c.cupom_codigo,
                       'em_limpeza', v_fechou->'em_limpeza', 'papel', p_papel,
                       'resumo', 'total R$ ' || to_char((v_fechou->>'total')::numeric, 'FM999990.00')
                                 || case when v_decisoes > 0 then ' · ' || v_decisoes || ' decisão(ões) da cozinha' else '' end));
  return v_fechou || jsonb_build_object('id', p_comanda, 'idempotente', false, 'decisoes', v_decisoes, 'pagamentos', v_pags);
end $$;

-- Trava de fidelidade por conta (o motor em TS processa uma vez por conta fechada).
create or replace function public.comanda_fidelidade_marcar(p_restaurante uuid, p_comanda uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_sub numeric;
  v_qtd int;
begin
  update public.comandas set fidelidade_processado = true
   where id = p_comanda and restaurante_id = p_restaurante and status = 'fechada'
     and fidelidade_processado = false and cliente_telefone is not null
  returning id, cliente_telefone, aberta_em into c;
  if c.id is null then return null; end if;
  select coalesce(sum(i.preco_unitario * i.quantidade), 0), coalesce(sum(i.quantidade), 0) into v_sub, v_qtd
    from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
   where p.comanda_id = p_comanda and p.status <> 'cancelado' and i.cancelado_em is null;
  return jsonb_build_object('telefone', c.cliente_telefone, 'subtotal', round(v_sub, 2), 'qtd_itens', v_qtd, 'criado_em', c.aberta_em);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'comanda_cupom_consistente()',
    'comanda_cupom_aplicar(uuid,uuid,uuid,uuid,text,text)',
    'comanda_cupom_remover(uuid,uuid,uuid,text,text)',
    'comanda_aplicar_decisoes(uuid,uuid,jsonb,uuid,text,text,text)',
    'comanda_fechamento_simular(uuid,uuid,jsonb)',
    'comanda_fechar_completo(uuid,uuid,jsonb,jsonb,uuid,text,text,text,text)',
    'comanda_fidelidade_marcar(uuid,uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
