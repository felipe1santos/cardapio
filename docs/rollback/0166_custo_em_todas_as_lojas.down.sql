-- Rollback da 0166: volta a gravar o custo só nas lojas com o financeiro ligado (versão da 0164).
CREATE OR REPLACE FUNCTION public.cmv_guardar_custo_linha()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rest uuid;
  r jsonb;
  v_custo numeric;
begin
  -- Loja SEM o financeiro (todas as lojas reais hoje): sai já, sem subtransação e sem gravar nada — o caminho
  -- do pedido fica igual ao de antes (só esta leitura por chave primária).
  if new.item_id is null then return null; end if;
  select p.restaurante_id into v_rest from public.pedidos p
    join public.restaurantes rr on rr.id = p.restaurante_id and rr.financeiro_ativo
   where p.id = new.pedido_id;
  if v_rest is null then return null; end if;
  begin
    r := public.cmv_custo_linha(v_rest, new.item_id, new.tamanho_nome, new.sabor_nome, new.borda_nome, new.massa_nome, new.complementos);
    v_custo := (r->>'custo')::numeric;
    insert into public.pedido_itens_custo (pedido_item_id, restaurante_id, pedido_id, situacao, custo_unitario, custo_unitario_centavos, detalhe, origem)
    values (new.id, v_rest, new.pedido_id, r->>'situacao', v_custo, case when v_custo is null then null else round(v_custo)::bigint end, coalesce(r->'detalhe', '{}'::jsonb),
      coalesce(r->>'origem', case when v_custo is null then 'nenhum' else 'ficha' end))
    on conflict (pedido_item_id) do nothing;
  exception when others then
    begin
      insert into public.pedido_itens_custo (pedido_item_id, restaurante_id, pedido_id, situacao, erro)
      values (new.id, coalesce(v_rest, (select restaurante_id from public.pedidos where id = new.pedido_id)), new.pedido_id, 'erro', left(sqlerrm, 300))
      on conflict (pedido_item_id) do nothing;
    exception when others then null; -- nem o registro do erro pode derrubar o pedido
    end;
  end;
  return null;
end $function$
;
