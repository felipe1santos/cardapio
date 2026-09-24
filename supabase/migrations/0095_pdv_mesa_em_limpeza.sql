-- ============================================================================
-- 0095 — PDV v2: mesa "EM LIMPEZA" depois do fechamento
--
-- Loja com pdv_v2: fechar a conta de uma mesa NÃO a devolve livre. Ela fica em
-- limpeza (laranja) até um funcionário liberar. Enquanto isso: nenhuma comanda nova,
-- nenhum pedido, nenhuma sessão do QR, nenhum chamado. O token do QR não muda.
--
-- Prioridade de estado (lib/queries/mesas.ts): inativa > bloqueada > ocupada >
-- em limpeza > livre. Liberar a limpeza nunca desbloqueia nem reativa: tira só a
-- marca de limpeza. Loja SEM pdv_v2 fecha exatamente como antes (mesa livre na hora).
--
-- Colunas criadas na 0094 (a guarda de abertura já as lê).
-- ============================================================================

-- ─── fechamento: conta fecha → mesa entra em limpeza ───────────────────────────
-- Mesmo corpo da 0085, com três acréscimos: (1) comanda antiga de mesa sem nome pede
-- o nome antes de fechar; (2) entrega manual em rota conta como pendência; (3) a mesa
-- entra em limpeza.
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
  v_mesa_nome text;
  t record;
begin
  select status, mesa_id, tipo, taxa_servico_percentual, cliente_nome, entrega into c from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.status is null then raise exception 'comanda_inexistente'; end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  select count(*) into v_pendentes
    from public.solicitacoes_cancelamento s join public.pedidos p on p.id = s.pedido_id
   where p.comanda_id = p_comanda and s.status = 'pendente';
  if v_pendentes > 0 then raise exception 'cancelamento_pendente:%', v_pendentes; end if;

  select coalesce(pdv_v2, false) into v_v2 from public.restaurantes where id = p_restaurante;
  if v_v2 and c.tipo = 'mesa' and nullif(btrim(coalesce(c.cliente_nome, '')), '') is null then
    raise exception 'comanda_sem_nome';
  end if;
  if v_v2 or c.tipo = 'balcao' then
    select count(*) into v_pendentes from public.pedidos
     where comanda_id = p_comanda and status in ('recebido', 'preparando', 'pronto', 'em_rota');
    if v_pendentes > 0 then raise exception 'pendencias_abertas:%', v_pendentes; end if;
  end if;

  select * into t from public.comanda_totais(p_comanda);
  if t.restante > 0 then raise exception 'saldo_restante:%', t.restante; end if;

  update public.comandas
     set status = 'fechada', fechada_em = now(), fechada_por = p_ator,
         fechada_por_nome = p_ator_nome, total_final = t.total
   where id = p_comanda;

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

    if v_v2 then
      update public.mesas
         set limpeza_desde = now(), limpeza_comanda_id = p_comanda, limpeza_cliente_nome = c.cliente_nome,
             limpeza_fechada_por_nome = p_ator_nome
       where id = c.mesa_id
      returning nome into v_mesa_nome;
      perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'mesa.limpeza', 'mesa', c.mesa_id,
        jsonb_build_object('mesa', v_mesa_nome, 'de', 'ocupada', 'para', 'em_limpeza', 'comanda_id', p_comanda,
                           'origem', p_origem, 'resumo', coalesce(v_mesa_nome, 'Mesa') || ' em limpeza'));
    end if;
  end if;

  select coalesce(taxa_servico_padrao, 0) into v_padrao from public.restaurantes where id = p_restaurante;

  return jsonb_build_object(
    'total', t.total, 'pago', t.pago, 'subtotal', t.subtotal, 'taxa', t.taxa_servico, 'desconto', t.desconto,
    'taxa_percentual', c.taxa_servico_percentual, 'taxa_padrao', v_padrao, 'tipo', c.tipo, 'origem', p_origem,
    'em_limpeza', v_v2 and c.mesa_id is not null,
    'taxa_situacao', case when c.tipo = 'balcao' then case when c.taxa_servico_percentual = 0 then 'sem_taxa' else 'alterada' end
                          when c.taxa_servico_percentual = 0 and v_padrao > 0 then 'removida'
                          when c.taxa_servico_percentual = v_padrao then case when v_padrao = 0 then 'sem_taxa' else 'aceita' end
                          else 'alterada' end);
end $$;

-- ─── liberar a mesa ────────────────────────────────────────────────────────────
create or replace function public.mesa_liberar(
  p_restaurante uuid, p_mesa uuid, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select id, nome, ativa, bloqueada_em, limpeza_desde, limpeza_cliente_nome, limpeza_comanda_id into m
    from public.mesas where id = p_mesa and restaurante_id = p_restaurante for update;
  if m.id is null then raise exception 'mesa_inexistente'; end if;
  -- Segundo clique / outra aba: já liberada.
  if m.limpeza_desde is null then
    return jsonb_build_object('id', m.id, 'idempotente', true,
      'estado', case when m.ativa = false then 'inativa' when m.bloqueada_em is not null then 'bloqueada' else 'livre' end);
  end if;

  update public.mesas
     set limpeza_desde = null, limpeza_comanda_id = null, liberada_em = now(), liberada_por_nome = p_ator_nome
   where id = m.id;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'mesa.liberou', 'mesa', m.id,
    jsonb_build_object('mesa', m.nome, 'de', 'em_limpeza', 'para',
                       case when m.ativa = false then 'inativa' when m.bloqueada_em is not null then 'bloqueada' else 'livre' end,
                       'limpeza_desde', m.limpeza_desde, 'comanda_id', m.limpeza_comanda_id, 'origem', coalesce(p_origem, 'pdv'),
                       'resumo', m.nome || ' liberada'));
  return jsonb_build_object('id', m.id, 'idempotente', false,
    'estado', case when m.ativa = false then 'inativa' when m.bloqueada_em is not null then 'bloqueada' else 'livre' end);
end $$;

-- ─── reabrir a conta devolve a mesa ao atendimento ─────────────────────────────
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
    -- Em limpeza por OUTRA conta (fechada depois desta) → a mesa não é mais desta conta.
    perform 1 from public.mesas where id = c.mesa_id and limpeza_desde is not null
                                  and limpeza_comanda_id is distinct from c.id;
    if found then raise exception 'mesa_em_limpeza'; end if;
    update public.mesas set limpeza_desde = null, limpeza_comanda_id = null
     where id = c.mesa_id and limpeza_comanda_id = c.id;
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

-- ─── QR, chamados e transferência respeitam a limpeza ─────────────────────────
create or replace function public.mesa_exige_disponivel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mesa uuid;
  m record;
begin
  if tg_table_name = 'comandas' then
    -- Só a troca de mesa (transferência): a abertura é vigiada por comanda_validar_abertura.
    if new.mesa_id is not distinct from old.mesa_id or new.mesa_id is null or new.status <> 'aberta' then return new; end if;
    v_mesa := new.mesa_id;
  else
    v_mesa := new.mesa_id;
  end if;
  select ativa, bloqueada_em, limpeza_desde into m from public.mesas where id = v_mesa;
  if m.limpeza_desde is not null then raise exception 'mesa_em_limpeza' using errcode = 'P0001'; end if;
  return new;
end $$;

drop trigger if exists sessoes_mesa_exige_disponivel on public.sessoes_mesa;
create trigger sessoes_mesa_exige_disponivel before insert on public.sessoes_mesa
  for each row execute function public.mesa_exige_disponivel();
drop trigger if exists chamados_mesa_exige_disponivel on public.chamados_mesa;
create trigger chamados_mesa_exige_disponivel before insert on public.chamados_mesa
  for each row execute function public.mesa_exige_disponivel();
drop trigger if exists comandas_troca_mesa_exige_disponivel on public.comandas;
create trigger comandas_troca_mesa_exige_disponivel before update of mesa_id on public.comandas
  for each row execute function public.mesa_exige_disponivel();

-- ─── pendências: entrega manual em rota também pende ──────────────────────────
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
  select id, status, tipo, cliente_nome into c from public.comandas where id = p_comanda and restaurante_id = p_restaurante;
  if c.id is null then raise exception 'comanda_inexistente'; end if;
  select * into t from public.comanda_totais(p_comanda);

  with ped as (
    select p.id, p.numero, p.status::text as status, p.atendimento_status, p.criado_em, p.preparando_em,
           p.pronto_em, p.total, p.criado_por_nome,
           case when p.status = 'recebido' then 'aguardando_aceite'
                when p.status = 'preparando' then 'em_preparo'
                when p.status = 'pronto' then 'pronto_nao_atendido'
                when p.status = 'em_rota' then 'em_entrega' end as categoria
      from public.pedidos p
     where p.comanda_id = p_comanda and p.status <> 'cancelado'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ped.id, 'numero', ped.numero, 'categoria', ped.categoria, 'status', ped.status,
           'atendimento_status', ped.atendimento_status, 'criado_em', ped.criado_em,
           'preparando_em', ped.preparando_em, 'pronto_em', ped.pronto_em, 'total', ped.total,
           'criado_por_nome', ped.criado_por_nome,
           'itens', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'nome', i.nome, 'quantidade', i.quantidade,
                                                                  'valor', round(i.preco_unitario * i.quantidade, 2))
                                               order by i.lancamento_seq nulls last, i.id), '[]'::jsonb)
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
    'sem_nome', c.tipo = 'mesa' and nullif(btrim(coalesce(c.cliente_nome, '')), '') is null,
    'pedidos', v_pedidos, 'cancelamentos', v_cancel,
    'financeiro', jsonb_build_object('subtotal', t.subtotal, 'taxa', t.taxa_servico, 'desconto', t.desconto,
                                     'total', t.total, 'pago', t.pago, 'restante', t.restante,
                                     'situacao', v_situacao, 'formas', v_formas, 'estornos', v_estornos),
    'atendido_nao_pago', v_n_pend = 0 and v_n_cancel = 0 and t.pago = 0 and t.total > 0,
    'parcialmente_pago', t.pago > 0 and t.pago < t.total,
    'bloqueia', v_n_pend > 0 or v_n_cancel > 0 or t.restante > 0);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'comanda_fechar_presencial(uuid,uuid,uuid,text,text)',
    'mesa_liberar(uuid,uuid,uuid,text,text)',
    'comanda_reabrir(uuid,uuid,text,uuid,text,text)',
    'mesa_exige_disponivel()',
    'comanda_pendencias(uuid,uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
