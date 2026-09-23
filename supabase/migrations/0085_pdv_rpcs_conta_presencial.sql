-- ============================================================================
-- 0085 — PDV v2: funções do motor de conta presencial (mesa e balcão)
--
-- Um motor só para mesa e balcão. Toda função: SECURITY DEFINER, execução só
-- para service_role, loja sempre em p_restaurante (vem da sessão, nunca do corpo),
-- trava da comanda com FOR UPDATE antes de mexer em dinheiro ou estado.
--
-- Erros são `raise exception 'codigo[:detalhe]'` — a camada TS traduz para frase
-- (lib/conta.ts, mensagemDeErroConta).
--
-- Compatibilidade: `comanda_registrar_pagamento` e `comanda_fechar` mantêm a
-- assinatura antiga e passam a delegar para as versões novas com origem 'salao'.
-- O fechamento só bloqueia por pendência de cozinha/atendimento quando a loja tem
-- `pdv_v2` ligada (ou a conta é de balcão, que só existe no v2). Loja sem a flag
-- fecha exatamente como antes.
-- ============================================================================

-- ─── auditoria interna ─────────────────────────────────────────────────────────
create or replace function public.auditoria_registrar(
  p_restaurante uuid, p_ator uuid, p_ator_nome text, p_acao text, p_entidade text, p_entidade_id uuid, p_dados jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, case when p_ator is null then 'sistema' else 'usuario' end, p_ator,
          coalesce(p_ator_nome, 'Sistema'), p_acao, p_entidade, p_entidade_id, coalesce(p_dados, '{}'::jsonb));
$$;

-- ─── abrir comanda de balcão ───────────────────────────────────────────────────
create or replace function public.comanda_balcao_abrir(
  p_restaurante uuid, p_nome text, p_telefone text, p_ator uuid, p_ator_nome text, p_chave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
  v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  v record;
begin
  if v_nome is null then raise exception 'nome_obrigatorio'; end if;
  if length(v_nome) > 60 then raise exception 'nome_longo'; end if;
  if v_tel is not null and v_tel !~ '^[0-9]{10,13}$' then raise exception 'telefone_invalido'; end if;
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;

  select id, senha, numero into v from public.comandas
   where restaurante_id = p_restaurante and chave_abertura = p_chave;
  if v.id is not null then
    return jsonb_build_object('id', v.id, 'senha', v.senha, 'numero', v.numero, 'idempotente', true);
  end if;

  begin
    insert into public.comandas
      (restaurante_id, tipo, mesa_id, cliente_nome, cliente_telefone, aberta_por, aberta_por_nome,
       responsavel_id, responsavel_nome, chave_abertura)
    values
      (p_restaurante, 'balcao', null, v_nome, v_tel, p_ator, p_ator_nome, p_ator, p_ator_nome, p_chave)
    returning id, senha, numero into v;
  exception when unique_violation then
    select id, senha, numero into v from public.comandas
     where restaurante_id = p_restaurante and chave_abertura = p_chave;
    return jsonb_build_object('id', v.id, 'senha', v.senha, 'numero', v.numero, 'idempotente', true);
  end;

  -- Telefone NÃO vai para a auditoria: é dado do cliente, fica só na comanda.
  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'balcao.abriu', 'comanda', v.id,
    jsonb_build_object('senha', v.senha, 'nome', v_nome, 'de', 'nova', 'para', 'aberta', 'origem', 'pdv',
                       'resumo', 'Senha ' || v.senha || ' · ' || v_nome));

  return jsonb_build_object('id', v.id, 'senha', v.senha, 'numero', v.numero, 'idempotente', false);
end $$;

-- ─── lançar pedido numa comanda (pedido + itens numa transação) ────────────────
-- Os preços chegam calculados pelo servidor (criarPedido reprecifica do catálogo);
-- o que esta função garante é o que o TypeScript não consegue: pedido e itens
-- juntos ou nada (o Assistente nunca vê pedido sem item) e comanda aberta até o
-- commit.
create or replace function public.comanda_lancar(
  p_restaurante uuid, p_comanda uuid, p_pedido jsonb, p_itens jsonb, p_ator uuid, p_ator_nome text, p_chave text)
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
begin
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'nenhum_item';
  end if;

  select id, status, tipo, mesa_id, cliente_nome into c from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;

  -- Reenvio da mesma chave: devolve o que já existe, antes de olhar o status (a conta
  -- pode ter fechado depois do primeiro envio, que valeu).
  select id, numero into v_existente from public.pedidos
   where restaurante_id = p_restaurante and chave_idempotencia = p_chave;
  if v_existente.id is not null then
    return jsonb_build_object('id', v_existente.id, 'numero', v_existente.numero, 'idempotente', true);
  end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  if c.tipo = 'mesa' then
    select nome into v_mesa_nome from public.mesas where id = c.mesa_id;
    v_cliente := coalesce(nullif(btrim(p_pedido->>'cliente_nome'), ''), v_mesa_nome);
  else
    v_cliente := c.cliente_nome;
  end if;

  insert into public.pedidos
    (restaurante_id, tipo, status, cliente_nome, cliente_telefone, telefone_verificado,
     forma_pagamento, troco_para, pago, subtotal, desconto, taxa_entrega, total, observacao,
     origem, canal, mesa, comanda_id, criado_por, criado_por_nome, chave_idempotencia)
  values
    (p_restaurante, 'retirada', 'recebido', left(v_cliente, 120), '', true,
     'dinheiro', null, false,
     (p_pedido->>'subtotal')::numeric, 0, 0, (p_pedido->>'total')::numeric, '',
     'pdv', c.tipo, v_mesa_nome, c.id, p_ator, p_ator_nome, p_chave)
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

-- ─── pagamento (versão com origem e canal) ─────────────────────────────────────
create or replace function public.comanda_pagamento_registrar(
  p_restaurante uuid, p_comanda uuid, p_forma text, p_valor numeric, p_recebido numeric, p_chave text,
  p_ator uuid, p_ator_nome text, p_observacao text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_restante numeric;
  v_existente record;
  v_id uuid;
  v_troco numeric := 0;
  v_obs text := nullif(trim(coalesce(p_observacao, '')), '');
begin
  if p_origem not in ('pdv', 'salao') then raise exception 'origem_invalida'; end if;

  select status, tipo into c from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.status is null then raise exception 'comanda_inexistente'; end if;

  -- Mesma chave = mesmo pagamento. Chave de OUTRA comanda é recusada: devolver o
  -- pagamento alheio faria a tela achar que esta conta recebeu.
  if p_chave is not null then
    select id, comanda_id into v_existente from public.pagamentos_comanda
     where restaurante_id = p_restaurante and chave_idempotencia = p_chave;
    if v_existente.id is not null then
      if v_existente.comanda_id <> p_comanda then raise exception 'chave_em_outra_comanda'; end if;
      return jsonb_build_object('id', v_existente.id, 'idempotente', true);
    end if;
  end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  if p_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'vale', 'fiado') then raise exception 'forma_invalida'; end if;
  if p_forma = 'fiado' and v_obs is null then raise exception 'fiado_sem_observacao'; end if;
  if p_valor is null or round(p_valor, 2) <= 0 then raise exception 'valor_invalido'; end if;

  select restante into v_restante from public.comanda_totais(p_comanda);
  if round(p_valor, 2) > v_restante then raise exception 'valor_acima_do_restante:%', v_restante; end if;

  if p_forma = 'dinheiro' and p_recebido is not null then
    if p_recebido < p_valor then raise exception 'recebido_menor_que_valor'; end if;
    v_troco := round(p_recebido - p_valor, 2);
  end if;

  insert into public.pagamentos_comanda
    (restaurante_id, comanda_id, forma, valor, valor_recebido, troco, chave_idempotencia,
     criado_por, criado_por_nome, observacao, canal, origem)
  values
    (p_restaurante, p_comanda, p_forma, round(p_valor, 2),
     case when p_forma = 'dinheiro' then round(p_recebido, 2) else null end,
     v_troco, p_chave, p_ator, p_ator_nome, left(v_obs, 200), c.tipo, p_origem)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'idempotente', false, 'troco', v_troco);
end $$;

-- Assinatura antiga (salão já em produção): mesma regra, origem 'salao'.
create or replace function public.comanda_registrar_pagamento(
  p_restaurante uuid, p_comanda uuid, p_forma text, p_valor numeric, p_recebido numeric, p_chave text,
  p_ator uuid, p_ator_nome text, p_observacao text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.comanda_pagamento_registrar(p_restaurante, p_comanda, p_forma, p_valor, p_recebido, p_chave,
                                            p_ator, p_ator_nome, p_observacao, 'salao');
$$;

-- ─── transição de cozinha pelo PDV ─────────────────────────────────────────────
create or replace function public.pedido_transicionar(
  p_restaurante uuid, p_pedido uuid, p_de text, p_para text, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_atual text;
begin
  if not ((p_de = 'recebido' and p_para = 'preparando')
       or (p_de = 'preparando' and p_para = 'recebido')
       or (p_de = 'preparando' and p_para = 'pronto')) then
    raise exception 'transicao_invalida:%>%', p_de, p_para;
  end if;

  select id, comanda_id, numero into p from public.pedidos
   where id = p_pedido and restaurante_id = p_restaurante and canal in ('mesa', 'balcao');
  if p.id is null or p.comanda_id is null then raise exception 'pedido_inexistente'; end if;
  perform 1 from public.comandas where id = p.comanda_id and status = 'aberta' for update;
  if not found then raise exception 'comanda_nao_aberta'; end if;

  -- Compare-and-set: se a cozinha (ou outra aba) mexeu antes, perde quem chegou depois.
  update public.pedidos set status = p_para::status_pedido
   where id = p_pedido and status = p_de::status_pedido;
  if not found then
    select status::text into v_atual from public.pedidos where id = p_pedido;
    raise exception 'conflito_status:%', v_atual;
  end if;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'pedido.transicao', 'pedido', p_pedido,
    jsonb_build_object('numero', p.numero, 'de', p_de, 'para', p_para, 'estado_anterior', p_de,
                       'estado_novo', p_para, 'origem', p_origem));
  return jsonb_build_object('id', p_pedido, 'status', p_para);
end $$;

-- ─── atendimento: servido (mesa) / entregue no balcão ──────────────────────────
create or replace function public.pedido_atender(
  p_restaurante uuid, p_pedido uuid, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_novo text;
begin
  select id, comanda_id, numero, canal, status::text as status, atendimento_status into p from public.pedidos
   where id = p_pedido and restaurante_id = p_restaurante and canal in ('mesa', 'balcao');
  if p.id is null or p.comanda_id is null then raise exception 'pedido_inexistente'; end if;
  perform 1 from public.comandas where id = p.comanda_id and status = 'aberta' for update;
  if not found then raise exception 'comanda_nao_aberta'; end if;
  select status::text, atendimento_status into p.status, p.atendimento_status
    from public.pedidos where id = p_pedido for update;

  v_novo := case when p.canal = 'mesa' then 'servido' else 'entregue_balcao' end;
  if p.atendimento_status in ('servido', 'entregue_balcao', 'concluido') then
    return jsonb_build_object('id', p_pedido, 'atendimento_status', p.atendimento_status, 'idempotente', true);
  end if;
  if p.status = 'cancelado' then raise exception 'ja_cancelado'; end if;
  if p.status <> 'pronto' then raise exception 'pedido_nao_pronto:%', p.status; end if;

  -- status 'entregue' mantém o Kanban como sempre: o card sai da coluna "Pronto".
  update public.pedidos
     set atendimento_status = v_novo, atendido_em = now(), atendido_por = p_ator, atendido_por_nome = p_ator_nome,
         status = 'entregue'
   where id = p_pedido;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'pedido.atendido', 'pedido', p_pedido,
    jsonb_build_object('numero', p.numero, 'de', coalesce(p.atendimento_status, 'aguardando'), 'para', v_novo,
                       'estado_anterior', jsonb_build_object('cozinha', p.status, 'atendimento', p.atendimento_status),
                       'estado_novo', jsonb_build_object('cozinha', 'entregue', 'atendimento', v_novo),
                       'origem', p_origem));
  return jsonb_build_object('id', p_pedido, 'atendimento_status', v_novo, 'idempotente', false);
end $$;

-- ─── cancelamento presencial (mesa e balcão) ───────────────────────────────────
-- p_so_recebido_sem_pagamento = true é o caminho do atendente: só cancela direto o
-- que nem começou a ser feito numa conta sem dinheiro. O resto vira solicitação.
create or replace function public.pedido_presencial_cancelar(
  p_restaurante uuid, p_pedido uuid, p_motivo text, p_ator uuid, p_ator_nome text,
  p_so_recebido_sem_pagamento boolean, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  t record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then raise exception 'motivo_obrigatorio'; end if;

  select id, comanda_id, numero, canal into p from public.pedidos
   where id = p_pedido and restaurante_id = p_restaurante and canal in ('mesa', 'balcao');
  if p.id is null or p.comanda_id is null then raise exception 'pedido_inexistente'; end if;
  perform 1 from public.comandas where id = p.comanda_id and status = 'aberta' for update;
  if not found then raise exception 'comanda_nao_aberta'; end if;
  select status::text as status, total, atendimento_status into t from public.pedidos where id = p_pedido for update;
  if t.status = 'cancelado' then raise exception 'ja_cancelado'; end if;

  if coalesce(p_so_recebido_sem_pagamento, true) then
    if t.status <> 'recebido' or (select pago from public.comanda_totais(p.comanda_id)) > 0 then
      raise exception 'cancelamento_requer_gestao';
    end if;
  end if;

  update public.pedidos
     set status = 'cancelado', cancelado_motivo = 'outro', cancelado_observacao = v_motivo,
         cancelado_por = p_ator_nome, cancelado_em = now(), reimprimir = false
   where id = p_pedido;

  -- Já pago acima do novo total: não cancela. Estorno ou ajuste antes (auditados).
  perform public.comanda_conferir_pago(p.comanda_id);

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'pedido.cancelou', 'pedido', p_pedido,
    jsonb_build_object('numero', p.numero, 'de', t.status, 'para', 'cancelado', 'motivo', v_motivo,
                       'estado_anterior', jsonb_build_object('cozinha', t.status, 'atendimento', t.atendimento_status),
                       'valor_afetado', t.total, 'origem', p_origem, 'comanda_id', p.comanda_id));
  return jsonb_build_object('pedido', p_pedido, 'comanda', p.comanda_id);
end $$;

-- Solicitação de cancelamento vale também para o balcão.
create or replace function public.cancelamento_solicitar(
  p_restaurante uuid, p_pedido uuid, p_item uuid, p_motivo text, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comanda uuid;
  v_status_pedido text;
  v_canal text;
  v_id uuid;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then raise exception 'motivo_obrigatorio'; end if;

  select comanda_id, status, canal into v_comanda, v_status_pedido, v_canal
    from public.pedidos where id = p_pedido and restaurante_id = p_restaurante;
  if v_comanda is null or v_canal not in ('mesa', 'balcao') then raise exception 'item_inexistente'; end if;
  if v_status_pedido = 'cancelado' then raise exception 'item_inexistente'; end if;
  perform 1 from public.comandas where id = v_comanda and status = 'aberta';
  if not found then raise exception 'comanda_nao_aberta'; end if;

  if p_item is not null then
    perform 1 from public.pedido_itens where id = p_item and pedido_id = p_pedido and cancelado_em is null;
    if not found then raise exception 'item_inexistente'; end if;
  end if;

  select id into v_id from public.solicitacoes_cancelamento
   where pedido_id = p_pedido and pedido_item_id is not distinct from p_item and status = 'pendente';
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'jaExistia', true);
  end if;

  begin
    insert into public.solicitacoes_cancelamento
      (restaurante_id, pedido_id, pedido_item_id, motivo, solicitado_por, solicitado_por_nome)
    values (p_restaurante, p_pedido, p_item, left(v_motivo, 200), p_ator, p_ator_nome)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.solicitacoes_cancelamento
     where pedido_id = p_pedido and pedido_item_id is not distinct from p_item and status = 'pendente';
    return jsonb_build_object('id', v_id, 'jaExistia', true);
  end;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'conta.solicitou_cancelamento', 'comanda', v_comanda,
          jsonb_build_object('pedido_id', p_pedido, 'item_id', p_item, 'motivo', v_motivo));

  return jsonb_build_object('id', v_id, 'jaExistia', false);
end $$;

-- A decisão aprovada de um pedido de balcão usa o cancelamento presencial (a de mesa
-- continua como era).
create or replace function public.cancelamento_decidir(
  p_restaurante uuid, p_solicitacao uuid, p_aprovar boolean, p_obs text, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_comanda uuid;
  v_canal text;
  v_alvo_vivo boolean;
  v_motivo text;
begin
  select * into s from public.solicitacoes_cancelamento
   where id = p_solicitacao and restaurante_id = p_restaurante for update;
  if s.id is null then raise exception 'solicitacao_inexistente'; end if;
  if s.status <> 'pendente' then raise exception 'solicitacao_decidida'; end if;

  select comanda_id, canal into v_comanda, v_canal from public.pedidos where id = s.pedido_id;
  v_motivo := s.motivo || ' (pedido por ' || s.solicitado_por_nome || ')';

  if p_aprovar then
    if s.pedido_item_id is not null then
      select exists (
        select 1 from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
         where i.id = s.pedido_item_id and i.cancelado_em is null and p.status <> 'cancelado'
      ) into v_alvo_vivo;
      if v_alvo_vivo then
        perform public.item_cancelar(p_restaurante, s.pedido_item_id, v_motivo, p_ator_nome);
      end if;
    else
      select exists (select 1 from public.pedidos where id = s.pedido_id and status <> 'cancelado') into v_alvo_vivo;
      if v_alvo_vivo then
        if v_canal = 'balcao' then
          perform public.pedido_presencial_cancelar(p_restaurante, s.pedido_id, v_motivo, p_ator, p_ator_nome, false, 'pdv');
        else
          perform public.pedido_mesa_cancelar(p_restaurante, s.pedido_id, v_motivo, p_ator, p_ator_nome);
        end if;
      end if;
    end if;
  end if;

  update public.solicitacoes_cancelamento
     set status = case when p_aprovar then 'aprovada' else 'recusada' end,
         decidido_por = p_ator, decidido_por_nome = p_ator_nome, decidido_em = now(),
         decisao_obs = nullif(trim(coalesce(p_obs, '')), '')
   where id = p_solicitacao;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome,
          case when p_aprovar then 'conta.aprovou_cancelamento' else 'conta.recusou_cancelamento' end,
          'comanda', v_comanda,
          jsonb_build_object('solicitacao_id', s.id, 'pedido_id', s.pedido_id, 'item_id', s.pedido_item_id,
                             'solicitado_por', s.solicitado_por_nome, 'motivo', s.motivo,
                             'observacao', nullif(trim(coalesce(p_obs, '')), '')));

  return jsonb_build_object('id', s.id, 'aprovada', p_aprovar);
end $$;

-- ─── pendências (leitura) ──────────────────────────────────────────────────────
create or replace function public.comanda_pendencias(p_restaurante uuid, p_comanda uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  t record;
  v_pedidos jsonb;
  v_cancel jsonb;
  v_formas jsonb;
  v_estornos int;
  v_n_pend int;
  v_n_cancel int;
  v_situacao text;
begin
  select id, status, tipo into c from public.comandas where id = p_comanda and restaurante_id = p_restaurante;
  if c.id is null then raise exception 'comanda_inexistente'; end if;
  select * into t from public.comanda_totais(p_comanda);

  with ped as (
    select p.id, p.numero, p.status::text as status, p.atendimento_status, p.criado_em, p.preparando_em,
           p.pronto_em, p.total, p.criado_por_nome,
           case when p.status = 'recebido' then 'aguardando_aceite'
                when p.status = 'preparando' then 'em_preparo'
                when p.status = 'pronto' then 'pronto_nao_atendido' end as categoria
      from public.pedidos p
     where p.comanda_id = p_comanda and p.status <> 'cancelado'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ped.id, 'numero', ped.numero, 'categoria', ped.categoria, 'status', ped.status,
           'atendimento_status', ped.atendimento_status, 'criado_em', ped.criado_em,
           'preparando_em', ped.preparando_em, 'pronto_em', ped.pronto_em, 'total', ped.total,
           'criado_por_nome', ped.criado_por_nome,
           'itens', (select coalesce(jsonb_agg(jsonb_build_object('nome', i.nome, 'quantidade', i.quantidade)
                                               order by i.id), '[]'::jsonb)
                       from public.pedido_itens i where i.pedido_id = ped.id and i.cancelado_em is null))
           order by ped.criado_em), '[]'::jsonb),
         count(*)
    into v_pedidos, v_n_pend
    from ped where ped.categoria is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'pedido_id', s.pedido_id, 'numero', p.numero, 'item_id', s.pedido_item_id,
           'item', (select i.quantidade || '× ' || i.nome from public.pedido_itens i where i.id = s.pedido_item_id),
           'motivo', s.motivo, 'solicitado_por_nome', s.solicitado_por_nome, 'solicitado_em', s.solicitado_em)
           order by s.solicitado_em), '[]'::jsonb),
         count(*)
    into v_cancel, v_n_cancel
    from public.solicitacoes_cancelamento s join public.pedidos p on p.id = s.pedido_id
   where p.comanda_id = p_comanda and s.status = 'pendente';

  select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', soma) order by forma), '[]'::jsonb)
    into v_formas
    from (select forma, sum(valor) as soma from public.pagamentos_comanda
           where comanda_id = p_comanda and estornado_em is null group by forma) f;
  select count(*) into v_estornos from public.pagamentos_comanda where comanda_id = p_comanda and estornado_em is not null;

  v_situacao := case when t.total > 0 and t.pago >= t.total then 'pago'
                     when t.pago > 0 then 'parcial'
                     when v_estornos > 0 then 'estornado'
                     else 'nao_pago' end;

  return jsonb_build_object(
    'comanda_id', p_comanda, 'status', c.status, 'tipo', c.tipo,
    'pedidos', v_pedidos, 'cancelamentos', v_cancel,
    'financeiro', jsonb_build_object('subtotal', t.subtotal, 'taxa', t.taxa_servico, 'desconto', t.desconto,
                                     'total', t.total, 'pago', t.pago, 'restante', t.restante,
                                     'situacao', v_situacao, 'formas', v_formas, 'estornos', v_estornos),
    'atendido_nao_pago', v_n_pend = 0 and v_n_cancel = 0 and t.pago = 0 and t.total > 0,
    'parcialmente_pago', t.pago > 0 and t.pago < t.total,
    'bloqueia', v_n_pend > 0 or v_n_cancel > 0 or t.restante > 0);
end $$;

-- ─── fechamento ────────────────────────────────────────────────────────────────
create or replace function public.comanda_fechar_presencial(
  p_restaurante uuid, p_comanda uuid, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_v2 boolean;
  v_pendentes int;
  v_padrao numeric;
  t record;
begin
  select status, mesa_id, tipo, taxa_servico_percentual into c from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.status is null then raise exception 'comanda_inexistente'; end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  select count(*) into v_pendentes
    from public.solicitacoes_cancelamento s join public.pedidos p on p.id = s.pedido_id
   where p.comanda_id = p_comanda and s.status = 'pendente';
  if v_pendentes > 0 then raise exception 'cancelamento_pendente:%', v_pendentes; end if;

  -- Regra nova (pdv_v2, e sempre para balcão): nada fecha com pedido ainda na
  -- cozinha ou pronto sem ter chegado ao cliente.
  select coalesce(pdv_v2, false) into v_v2 from public.restaurantes where id = p_restaurante;
  if v_v2 or c.tipo = 'balcao' then
    select count(*) into v_pendentes from public.pedidos
     where comanda_id = p_comanda and status in ('recebido', 'preparando', 'pronto');
    if v_pendentes > 0 then raise exception 'pendencias_abertas:%', v_pendentes; end if;
  end if;

  select * into t from public.comanda_totais(p_comanda);
  if t.restante > 0 then raise exception 'saldo_restante:%', t.restante; end if;

  update public.comandas
     set status = 'fechada', fechada_em = now(), fechada_por = p_ator,
         fechada_por_nome = p_ator_nome, total_final = t.total
   where id = p_comanda;

  -- `pago = true` só por compatibilidade com relatórios antigos: nada novo decide por ele.
  update public.pedidos
     set pago = true,
         concluido_em = coalesce(concluido_em, now()),
         atendimento_status = case when atendimento_status in ('servido', 'entregue_balcao') then 'concluido'
                                   else atendimento_status end
   where comanda_id = p_comanda and status <> 'cancelado';

  if c.mesa_id is not null then
    update public.selecoes_mesa s set encerrada_em = now()
      from public.sessoes_mesa sm
     where s.sessao_id = sm.id and sm.mesa_id = c.mesa_id and sm.status = 'aberta' and s.encerrada_em is null;
    update public.sessoes_mesa set status = 'encerrada', encerrada_em = now()
     where mesa_id = c.mesa_id and status = 'aberta';
    update public.chamados_mesa set status = 'expirado'
     where mesa_id = c.mesa_id and status in ('pendente', 'assumido');
  end if;

  select coalesce(taxa_servico_padrao, 0) into v_padrao from public.restaurantes where id = p_restaurante;

  return jsonb_build_object(
    'total', t.total, 'pago', t.pago, 'subtotal', t.subtotal, 'taxa', t.taxa_servico, 'desconto', t.desconto,
    'taxa_percentual', c.taxa_servico_percentual, 'taxa_padrao', v_padrao, 'tipo', c.tipo, 'origem', p_origem,
    'taxa_situacao', case when c.tipo = 'balcao' then case when c.taxa_servico_percentual = 0 then 'sem_taxa' else 'alterada' end
                          when c.taxa_servico_percentual = 0 and v_padrao > 0 then 'removida'
                          when c.taxa_servico_percentual = v_padrao then case when v_padrao = 0 then 'sem_taxa' else 'aceita' end
                          else 'alterada' end);
end $$;

create or replace function public.comanda_fechar(p_restaurante uuid, p_comanda uuid, p_ator uuid, p_ator_nome text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.comanda_fechar_presencial(p_restaurante, p_comanda, p_ator, p_ator_nome, 'salao');
$$;

-- ─── resolução forçada (gerente/dono) ──────────────────────────────────────────
-- p_acoes: [{pedido_id, acao: marcar_atendido|forcar_atendido|nao_entregue|cancelar_pedido|cancelar_itens,
--            item_ids?: uuid[]}]. Tudo numa transação com a comanda travada. Se o que
-- já foi pago passar do novo total, NADA é aplicado: 'ajuste_financeiro_necessario:<excesso>'.
create or replace function public.comanda_resolver_pendencias(
  p_restaurante uuid, p_comanda uuid, p_acoes jsonb, p_motivo text, p_ator uuid, p_ator_nome text,
  p_papel text, p_origem text, p_fechar boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  a record;
  p record;
  t record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_so_marcar boolean;
  v_novo_atend text;
  v_aplicadas int := 0;
  v_fechou jsonb := null;
  v_erro_fechar text := null;
  v_valor_antes numeric;
begin
  if p_acoes is null or jsonb_typeof(p_acoes) <> 'array' or jsonb_array_length(p_acoes) = 0 then
    raise exception 'nenhuma_acao';
  end if;
  select bool_and(x->>'acao' = 'marcar_atendido') into v_so_marcar from jsonb_array_elements(p_acoes) x;
  if not v_so_marcar and (v_motivo is null or length(v_motivo) < 5) then raise exception 'motivo_obrigatorio'; end if;

  select id, status, tipo into c from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  for a in
    select (x->>'pedido_id')::uuid as pedido_id, x->>'acao' as acao,
           coalesce((select array_agg(v::uuid) from jsonb_array_elements_text(x->'item_ids') v), '{}'::uuid[]) as item_ids
      from jsonb_array_elements(p_acoes) x
  loop
    select id, numero, canal, status::text as status, atendimento_status, total into p
      from public.pedidos where id = a.pedido_id and comanda_id = p_comanda for update;
    if p.id is null then raise exception 'pedido_inexistente'; end if;
    if p.status = 'cancelado' then raise exception 'ja_cancelado'; end if;
    v_valor_antes := p.total;
    v_novo_atend := case when p.canal = 'mesa' then 'servido' else 'entregue_balcao' end;

    if a.acao = 'marcar_atendido' then
      if p.status <> 'pronto' then raise exception 'pedido_nao_pronto:%', p.status; end if;
      update public.pedidos set atendimento_status = v_novo_atend, atendido_em = now(), atendido_por = p_ator,
             atendido_por_nome = p_ator_nome, status = 'entregue' where id = p.id;
    elsif a.acao = 'forcar_atendido' then
      if p.status not in ('recebido', 'preparando', 'pronto') then raise exception 'acao_invalida:%', a.acao; end if;
      update public.pedidos set atendimento_status = v_novo_atend, atendido_em = now(), atendido_por = p_ator,
             atendido_por_nome = p_ator_nome, status = 'entregue', resolvido_forcado = true where id = p.id;
    elsif a.acao = 'nao_entregue' then
      if p.status not in ('recebido', 'preparando', 'pronto') then raise exception 'acao_invalida:%', a.acao; end if;
      -- Sai da cozinha e do Kanban (status terminal), mas o valor segue na conta:
      -- cobrar ou ajustar é decisão explícita, nunca efeito colateral.
      update public.pedidos set atendimento_status = 'nao_entregue', status = 'entregue',
             resolvido_forcado = true where id = p.id;
    elsif a.acao = 'cancelar_pedido' then
      update public.pedidos
         set status = 'cancelado', cancelado_motivo = 'outro', cancelado_observacao = v_motivo,
             cancelado_por = p_ator_nome, cancelado_em = now(), reimprimir = false, resolvido_forcado = true
       where id = p.id;
    elsif a.acao = 'cancelar_itens' then
      if cardinality(a.item_ids) = 0 then raise exception 'nenhum_item'; end if;
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
    else
      raise exception 'acao_invalida:%', a.acao;
    end if;

    v_aplicadas := v_aplicadas + 1;
    perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome,
      case when a.acao = 'marcar_atendido' then 'pedido.atendido' else 'pedido.resolucao_forcada' end,
      'pedido', p.id,
      (select jsonb_build_object(
         'numero', p.numero, 'acao', a.acao, 'motivo', v_motivo, 'origem', p_origem, 'papel', p_papel,
         'comanda_id', p_comanda,
         'de', p.status, 'para', np.status::text,
         'estado_anterior', jsonb_build_object('cozinha', p.status, 'atendimento', p.atendimento_status),
         'estado_novo', jsonb_build_object('cozinha', np.status::text, 'atendimento', np.atendimento_status),
         'valor_afetado', round(v_valor_antes - case when np.status = 'cancelado' then 0 else np.total end, 2))
         from public.pedidos np where np.id = p.id));
  end loop;

  -- Efeito financeiro: pago acima do novo total ⇒ nada disso vale. O operador registra
  -- antes o estorno (comanda_estornar_pagamento) ou o ajuste (comanda_ajustar_valores).
  select * into t from public.comanda_totais(p_comanda);
  if t.pago > t.total then
    raise exception 'ajuste_financeiro_necessario:%', round(t.pago - t.total, 2);
  end if;

  if coalesce(p_fechar, false) then
    begin
      v_fechou := public.comanda_fechar_presencial(p_restaurante, p_comanda, p_ator, p_ator_nome, p_origem);
    exception when others then
      -- A resolução vale mesmo que o fechamento ainda não possa acontecer (falta pagar,
      -- por exemplo): o operador vê o motivo e segue.
      v_erro_fechar := sqlerrm;
    end;
  end if;

  return jsonb_build_object('aplicadas', v_aplicadas, 'fechamento', v_fechou, 'erro_fechamento', v_erro_fechar);
end $$;

-- ─── reabertura (gerente/dono) ─────────────────────────────────────────────────
create or replace function public.comanda_reabrir(
  p_restaurante uuid, p_comanda uuid, p_motivo text, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null or length(v_motivo) < 5 then raise exception 'motivo_obrigatorio'; end if;
  select id, status, tipo, mesa_id, total_final, fechada_em, fechada_por_nome, senha into c from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;
  if c.status <> 'fechada' then raise exception 'comanda_nao_fechada'; end if;
  if c.tipo = 'mesa' then
    perform 1 from public.comandas where mesa_id = c.mesa_id and status = 'aberta' and id <> c.id;
    if found then raise exception 'mesa_ocupada'; end if;
  end if;

  update public.comandas
     set status = 'aberta', fechada_em = null, fechada_por = null, fechada_por_nome = null, total_final = null,
         reaberta_em = now(), reaberta_por_nome = p_ator_nome, reabertura_motivo = left(v_motivo, 300)
   where id = p_comanda;

  update public.pedidos
     set pago = false, concluido_em = null,
         atendimento_status = case when atendimento_status = 'concluido'
                                   then case when canal = 'mesa' then 'servido' else 'entregue_balcao' end
                                   else atendimento_status end
   where comanda_id = p_comanda and status <> 'cancelado';

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'comanda.reabriu', 'comanda', p_comanda,
    jsonb_build_object('de', 'fechada', 'para', 'aberta', 'motivo', v_motivo, 'origem', p_origem,
                       'total_anterior', c.total_final, 'fechada_em', c.fechada_em,
                       'fechada_por', c.fechada_por_nome, 'senha', c.senha));
  return jsonb_build_object('id', p_comanda, 'status', 'aberta');
end $$;

-- ─── transferências recusam balcão ─────────────────────────────────────────────
-- mesa_transferir e itens_transferir só enxergam comandas por mesa_id — uma comanda
-- de balcão (mesa_id nulo) nunca é origem nem destino delas. Nada a mudar.

-- ─── grants ────────────────────────────────────────────────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'auditoria_registrar(uuid,uuid,text,text,text,uuid,jsonb)',
    'comanda_balcao_abrir(uuid,text,text,uuid,text,text)',
    'comanda_lancar(uuid,uuid,jsonb,jsonb,uuid,text,text)',
    'comanda_pagamento_registrar(uuid,uuid,text,numeric,numeric,text,uuid,text,text,text)',
    'comanda_registrar_pagamento(uuid,uuid,text,numeric,numeric,text,uuid,text,text)',
    'pedido_transicionar(uuid,uuid,text,text,uuid,text,text)',
    'pedido_atender(uuid,uuid,uuid,text,text)',
    'pedido_presencial_cancelar(uuid,uuid,text,uuid,text,boolean,text)',
    'cancelamento_solicitar(uuid,uuid,uuid,text,uuid,text)',
    'cancelamento_decidir(uuid,uuid,boolean,text,uuid,text)',
    'comanda_pendencias(uuid,uuid)',
    'comanda_fechar_presencial(uuid,uuid,uuid,text,text)',
    'comanda_fechar(uuid,uuid,uuid,text)',
    'comanda_resolver_pendencias(uuid,uuid,jsonb,text,uuid,text,text,text,boolean)',
    'comanda_reabrir(uuid,uuid,text,uuid,text,text)',
    'comanda_numerar_balcao()',
    'pedidos_exige_comanda_aberta()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
