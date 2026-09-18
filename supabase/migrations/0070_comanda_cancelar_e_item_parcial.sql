-- Etapa G — cancelar a comanda inteira e transferir parte de uma linha.
--
-- Duas lacunas da 0067:
--
-- 1. Dava para cancelar item e cancelar lançamento, mas não a COMANDA. Mesa aberta por
--    engano, cliente que desistiu antes de consumir, comanda duplicada — tudo isso
--    ficava sem saída operacional, obrigando a "fechar com R$ 0,00", o que mente no
--    relatório (venda fechada que não houve).
-- 2. `itens_transferir` movia a linha inteira. "3× Coca, leva 1 para a mesa 5" não tinha
--    como ser feito sem cancelar e relançar — o que apaga o histórico de quem pediu o quê.
--
-- Mesmas regras da 0067: uma função = uma transação, trava na comanda, nada apagado,
-- motivo obrigatório, auditoria dentro da própria transação, só service_role executa.

-- ── comanda cancelada é um estado, não uma exclusão ─────────────────────────
alter table public.comandas add column if not exists cancelada_motivo text;
alter table public.comandas add column if not exists cancelada_por uuid references public.usuarios(id) on delete set null;
alter table public.comandas add column if not exists cancelada_por_nome text;
alter table public.comandas add column if not exists cancelada_em timestamptz;

alter table public.comandas drop constraint if exists comandas_status_check;
alter table public.comandas add constraint comandas_status_check
  check (status in ('aberta', 'fechada', 'transferida', 'cancelada'));

comment on column public.comandas.cancelada_motivo is
  'Comanda cancelada some da operação mas continua no histórico, com motivo e autor. '
  'Nunca é DELETE: pedido, item e pagamento estornado seguem consultáveis.';

-- ═══ cancelar a comanda ═════════════════════════════════════════════════════
create or replace function public.comanda_cancelar(
  p_restaurante uuid, p_comanda uuid, p_motivo text, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_mesa uuid;
  v_pago numeric;
  v_pedidos int;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'motivo_obrigatorio'; end if;

  select status, mesa_id into v_status, v_mesa from public.comandas
   where id = p_comanda and restaurante_id = p_restaurante for update;
  if v_status is null then raise exception 'comanda_inexistente'; end if;
  if v_status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  -- Dinheiro já recebido não evapora num cancelamento. Quem quer cancelar estorna
  -- primeiro, com motivo, e o estorno fica registrado.
  select pago into v_pago from public.comanda_totais(p_comanda);
  if v_pago > 0 then raise exception 'comanda_com_pagamento:%', v_pago; end if;

  select count(*) into v_pedidos from public.pedidos
   where comanda_id = p_comanda and status <> 'cancelado';

  -- Cada lançamento cai pelo caminho de sempre (status + motivo), então sai do Kanban e
  -- da cozinha sem tela nova. `reimprimir = false` para nada sair depois de cancelado.
  update public.pedidos
     set status = 'cancelado', cancelado_motivo = 'outro', cancelado_observacao = p_motivo,
         cancelado_por = p_ator_nome, cancelado_em = now(), reimprimir = false
   where comanda_id = p_comanda and status <> 'cancelado';

  update public.comandas
     set status = 'cancelada', cancelada_motivo = p_motivo, cancelada_por = p_ator,
         cancelada_por_nome = p_ator_nome, cancelada_em = now(), fechada_em = now(),
         total_final = 0
   where id = p_comanda;

  -- A mesa libera do mesmo jeito que no fechamento.
  update public.selecoes_mesa s set encerrada_em = now()
    from public.sessoes_mesa sm
   where s.sessao_id = sm.id and sm.mesa_id = v_mesa and sm.status = 'aberta' and s.encerrada_em is null;
  update public.sessoes_mesa set status = 'encerrada', encerrada_em = now()
   where mesa_id = v_mesa and status = 'aberta';
  update public.chamados_mesa set status = 'expirado'
   where mesa_id = v_mesa and status in ('pendente', 'assumido');

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'conta.cancelou_comanda', 'comanda', p_comanda,
          jsonb_build_object('mesa_id', v_mesa, 'de', 'aberta', 'para', 'cancelada',
                             'lancamentos', v_pedidos, 'motivo', p_motivo));

  return jsonb_build_object('comanda', p_comanda, 'lancamentos_cancelados', v_pedidos);
end $$;

-- ═══ transferir itens, agora com quantidade parcial ═════════════════════════
-- `p_quantidades[i]` é quanto da linha `p_itens[i]` vai para o destino. NULL ou >= a
-- quantidade da linha = a linha inteira. Valor menor parte a linha em duas: a de origem
-- perde a quantidade movida, a nova nasce no destino com o mesmo preço unitário, os
-- mesmos complementos e a mesma observação.
--
-- `impresso = true` no pedido de destino: aquele item JÁ foi produzido para a mesa de
-- origem. Reimprimir faria a cozinha preparar de novo.
create or replace function public.itens_transferir(
  p_restaurante uuid, p_itens uuid[], p_destino uuid, p_ator uuid, p_ator_nome text,
  p_quantidades int[] default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comanda_destino uuid;
  v_destino_ativa boolean;
  v_destino_bloqueada timestamptz;
  v_destino_nome text;
  r record;
  v_novo uuid;
  v_movidos int := 0;
  v_ativos int;
  v_inteiros int;
  v_pedido_destino uuid;
  i int;
  v_qtd int;
  v_linha record;
begin
  if coalesce(array_length(p_itens, 1), 0) = 0 then raise exception 'nenhum_item'; end if;
  if p_quantidades is not null
     and coalesce(array_length(p_quantidades, 1), 0) <> array_length(p_itens, 1) then
    raise exception 'quantidades_incompativeis';
  end if;

  select ativa, bloqueada_em, nome into v_destino_ativa, v_destino_bloqueada, v_destino_nome
    from public.mesas where id = p_destino and restaurante_id = p_restaurante;
  if v_destino_ativa is null then raise exception 'destino_inexistente'; end if;
  if v_destino_ativa = false then raise exception 'destino_inativo'; end if;
  if v_destino_bloqueada is not null then raise exception 'destino_bloqueado'; end if;

  -- Destino sem conta aberta ganha uma agora (mesmo padrão do primeiro lançamento).
  select id into v_comanda_destino from public.comandas
   where restaurante_id = p_restaurante and mesa_id = p_destino and status = 'aberta' for update;
  if v_comanda_destino is null then
    insert into public.comandas (restaurante_id, mesa_id) values (p_restaurante, p_destino)
    returning id into v_comanda_destino;
  end if;

  -- Quanto vai de cada linha, resolvido antes de mexer em nada: linha inexistente,
  -- cancelada, paga (comanda fechada) ou de outra loja simplesmente não entra.
  create temp table if not exists _mov (item_id uuid primary key, pedido_id uuid, qtd int, inteiro boolean)
    on commit drop;
  delete from _mov;

  for i in 1 .. array_length(p_itens, 1) loop
    select it.id, it.pedido_id, it.quantidade, p.comanda_id
      into v_linha
      from public.pedido_itens it
      join public.pedidos p on p.id = it.pedido_id
      join public.comandas c on c.id = p.comanda_id
     where it.id = p_itens[i]
       and it.cancelado_em is null
       and p.restaurante_id = p_restaurante
       and p.status <> 'cancelado'
       and c.status = 'aberta';
    if v_linha.id is null then continue; end if;
    if v_linha.comanda_id = v_comanda_destino then continue; end if;

    v_qtd := case when p_quantidades is null then v_linha.quantidade else p_quantidades[i] end;
    if v_qtd is null or v_qtd >= v_linha.quantidade then
      v_qtd := v_linha.quantidade;
    elsif v_qtd < 1 then
      raise exception 'quantidade_invalida';
    end if;

    insert into _mov (item_id, pedido_id, qtd, inteiro)
    values (v_linha.id, v_linha.pedido_id, v_qtd, v_qtd = v_linha.quantidade)
    on conflict (item_id) do nothing;
  end loop;

  for r in select distinct pedido_id from _mov order by pedido_id loop
    perform 1 from public.pedidos where id = r.pedido_id for update;

    select count(*) into v_ativos from public.pedido_itens
     where pedido_id = r.pedido_id and cancelado_em is null;
    select count(*) into v_inteiros from _mov where pedido_id = r.pedido_id and inteiro;

    if v_inteiros = v_ativos then
      -- Tudo do lançamento vai junto: o pedido muda de comanda e de mesa. O nome da mesa
      -- acompanha porque é o que a cozinha lê para saber onde servir.
      update public.pedidos
         set comanda_id = v_comanda_destino,
             cliente_nome = case when cliente_nome = mesa then v_destino_nome else cliente_nome end,
             mesa = v_destino_nome
       where id = r.pedido_id;
      select coalesce(sum(qtd), 0) into v_qtd from _mov where pedido_id = r.pedido_id;
      v_movidos := v_movidos + v_qtd;
      continue;
    end if;

    insert into public.pedidos
      (restaurante_id, tipo, status, cliente_nome, forma_pagamento, subtotal, total, origem, canal, mesa,
       comanda_id, impresso, criado_por, criado_por_nome)
    select p.restaurante_id, p.tipo, p.status, v_destino_nome, p.forma_pagamento, 0, 0, p.origem, 'mesa',
           v_destino_nome, v_comanda_destino, true, p_ator, p_ator_nome
      from public.pedidos p where p.id = r.pedido_id
    returning id into v_pedido_destino;

    -- Linha inteira: muda de pedido, preservando preço, complementos e observação.
    update public.pedido_itens set pedido_id = v_pedido_destino
     where pedido_id = r.pedido_id
       and id in (select item_id from _mov where pedido_id = r.pedido_id and inteiro);

    -- Linha parcial: a de origem diminui e nasce uma cópia no destino.
    for v_linha in
      select it.*, m.qtd as mover
        from public.pedido_itens it join _mov m on m.item_id = it.id
       where m.pedido_id = r.pedido_id and not m.inteiro
    loop
      update public.pedido_itens set quantidade = quantidade - v_linha.mover where id = v_linha.id;
      insert into public.pedido_itens
        (pedido_id, item_id, nome, quantidade, preco_unitario, observacao, complementos,
         tamanho_nome, sabor_nome, borda_nome, massa_nome)
      values
        (v_pedido_destino, v_linha.item_id, v_linha.nome, v_linha.mover, v_linha.preco_unitario,
         v_linha.observacao, v_linha.complementos, v_linha.tamanho_nome, v_linha.sabor_nome,
         v_linha.borda_nome, v_linha.massa_nome);
    end loop;

    perform public.pedido_recalcular(r.pedido_id);
    perform public.pedido_recalcular(v_pedido_destino);
    select coalesce(sum(qtd), 0) into v_qtd from _mov where pedido_id = r.pedido_id;
    v_movidos := v_movidos + v_qtd;
  end loop;

  if v_movidos = 0 then raise exception 'nenhum_item_transferivel'; end if;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'mesa.transferiu_itens', 'comanda', v_comanda_destino,
          jsonb_build_object('mesa_destino', p_destino, 'itens', v_movidos));

  return jsonb_build_object('comanda', v_comanda_destino, 'itens', v_movidos);
end $$;

-- A assinatura sem `p_quantidades` da 0067 sai de cena: um `default` não substitui a
-- função antiga, ele cria uma sobrecarga, e chamada com 5 argumentos ficaria ambígua.
drop function if exists public.itens_transferir(uuid, uuid[], uuid, uuid, text);

do $$
declare f text;
begin
  foreach f in array array[
    'comanda_cancelar(uuid,uuid,text,uuid,text)',
    'itens_transferir(uuid,uuid[],uuid,uuid,text,int[])'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
