-- 0102 — Cancelar lançamento de mesa já servido (entregue).
--
-- Bug (achado na limpeza da Menuzia, 2026-09-27): `pedido_mesa_cancelar` (0072) recusava
-- pedido `entregue` como se estivesse cancelado:
--     if v_status in ('cancelado', 'entregue') then raise exception 'ja_cancelado';
-- Efeitos:
--   · aprovar o pedido de cancelamento do garçom sobre item já servido era impossível —
--     `cancelamento_decidir` (0085) chama esta função e a solicitação ficava pendente
--     para sempre (a tela dizia "Este lançamento já foi cancelado.");
--   · o botão "Cancelar" do lançamento na tela da mesa falhava do mesmo jeito.
--
-- A regra passa a ser a mesma das irmãs `item_cancelar` (0072) e
-- `pedido_presencial_cancelar` (0085): só o pedido JÁ CANCELADO é recusado. O resto
-- continua como estava:
--   · conta precisa estar aberta (trava da comanda);
--   · `comanda_conferir_pago`: se o que já foi pago passar do novo total, a transação
--     inteira é desfeita (estorno antes, como sempre);
--   · o gatilho `pedidos_transicao_valida` (0094) já permite entregue → cancelado para
--     mesa/balcão e zera `reimprimir` (nada vai para a impressora);
--   · auditoria `conta.cancelou_pedido` com o estado anterior ("de": entregue).
--
-- Só a função muda (CREATE OR REPLACE mantém os grants da 0072). Sem dado alterado.
-- Rollback: docs/rollback/0102_cancelar_pedido_mesa_entregue.down.sql

create or replace function public.pedido_mesa_cancelar(
  p_restaurante uuid, p_pedido uuid, p_motivo text, p_ator uuid, p_ator_nome text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_comanda uuid;
  v_status text;
  v_numero int;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'motivo_obrigatorio'; end if;

  select comanda_id, status, numero into v_comanda, v_status, v_numero
    from public.pedidos where id = p_pedido and restaurante_id = p_restaurante and canal = 'mesa';
  if v_comanda is null then raise exception 'item_inexistente'; end if;

  perform 1 from public.comandas where id = v_comanda and status = 'aberta' for update;
  if not found then raise exception 'comanda_nao_aberta'; end if;

  select status into v_status from public.pedidos where id = p_pedido for update;
  -- Só o que já foi cancelado. Servido (entregue) cancela: é o item que o cliente
  -- devolveu ou não quis — a gestão decide, e o pagamento é conferido logo abaixo.
  if v_status = 'cancelado' then raise exception 'ja_cancelado'; end if;

  -- Mesma gravação do cancelamento do Kanban: status + motivo, nada apagado, e
  -- `reimprimir = false` para uma reimpressão pendente não sair depois de cancelado.
  update public.pedidos
     set status = 'cancelado', cancelado_motivo = 'outro', cancelado_observacao = p_motivo,
         cancelado_por = p_ator_nome, cancelado_em = now(), reimprimir = false
   where id = p_pedido;

  perform public.comanda_conferir_pago(v_comanda);

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'conta.cancelou_pedido', 'comanda', v_comanda,
          jsonb_build_object('pedido_id', p_pedido, 'numero', v_numero, 'de', v_status, 'para', 'cancelado',
                             'motivo', p_motivo));

  return jsonb_build_object('pedido', p_pedido, 'comanda', v_comanda);
end $$;
