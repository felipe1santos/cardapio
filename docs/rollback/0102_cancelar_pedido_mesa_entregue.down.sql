-- ROLLBACK da 0102: volta a regra exata da 0072 (pedido entregue recusado como 'ja_cancelado').
-- Aplicar só se a 0102 causar problema; não mexe em dado.

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
  if v_status in ('cancelado', 'entregue') then raise exception 'ja_cancelado'; end if;

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

delete from public.schema_migrations where name = '0102_cancelar_pedido_mesa_entregue.sql';
