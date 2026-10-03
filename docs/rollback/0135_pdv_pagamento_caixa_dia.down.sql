-- Rollback da 0135 (rodar como dono do banco).
-- Volta o lançamento do PDV a gravar "dinheiro" fixo e a abertura automática da 0134. A coluna
-- cartao_tipo é removida (o detalhe crédito/débito dos pedidos lançados nesse meio-tempo se perde;
-- forma_pagamento e troco_para ficam).
begin;
-- comanda_lancar como na 0094
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
     forma_pagamento, troco_para, pago, subtotal, desconto, taxa_entrega, total, observacao,
     endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, endereco_cidade, endereco_referencia,
     origem, canal, mesa, comanda_id, criado_por, criado_por_nome, chave_idempotencia, lancado_via)
  values
    (p_restaurante, case when c.entrega then 'entrega'::tipo_pedido else 'retirada'::tipo_pedido end, 'recebido',
     left(v_cliente, 120), coalesce(c.cliente_telefone, ''), true,
     'dinheiro', null, false,
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

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'idempotente', false);
end $$;

-- abertura automática como na 0134
create or replace function public.caixa_turno_abre_na_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_turno uuid;
begin
  if new.status = 'entregue' and old.status is distinct from 'entregue' and new.entregador_id is not null then
    insert into public.caixa_turnos (restaurante_id, aberto_em, aberto_por_nome)
    values (new.restaurante_id, now(), 'Automático (1ª entrega)')
    on conflict (restaurante_id) where fechado_em is null do nothing
    returning id into v_turno;
    if v_turno is not null and exists (select 1 from public.restaurantes r where r.id = new.restaurante_id and r.financeiro_ativo) then
      insert into public.fin_alertas (restaurante_id, tipo, gravidade, mensagem, dados)
      values (new.restaurante_id, 'caixa_aberto_automatico', 'atencao',
        'O caixa estava fechado e foi aberto sozinho pela 1ª entrega do delivery, sem fundo de troco e sem responsável. Confira o caixa e registre o fundo (Reforço) se houver troco na gaveta.',
        jsonb_build_object('turno', v_turno, 'pedido', new.id));
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.caixa_turno_abre_na_entrega() from public, anon, authenticated;

drop function if exists public.caixa_turno_virar_dia(uuid);
drop function if exists public.caixa_inicio_dia_operacional(timestamptz);
alter table public.pedidos drop constraint if exists pedidos_cartao_tipo_check;
alter table public.pedidos drop column if exists cartao_tipo;
alter table public.fin_config alter column horas_motoboy_pendente set default 3;
do $$ begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where name = '0135_pdv_pagamento_caixa_dia.sql';
  end if;
end $$;
commit;
