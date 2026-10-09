-- 0166 — Custo gravado na venda em TODAS as lojas (com ou sem o financeiro), para o lucro do Dashboard (09/10).
-- Vendas antigas não mudam. Regra do custo: 0164 (ficha → preço de custo do cardápio → sem custo).
-- O corpo INTEIRO fica dentro de um bloco de exceção: nada aqui pode derrubar o pedido.
-- Rollback: docs/rollback/0166_custo_em_todas_as_lojas.down.sql (volta a gravar só com o financeiro ligado).
create or replace function public.cmv_guardar_custo_linha()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rest uuid;
  r jsonb;
  v_custo numeric;
begin
  if new.item_id is null then return null; end if;
  begin
    select p.restaurante_id into v_rest from public.pedidos p where p.id = new.pedido_id;
    if v_rest is null then return null; end if;
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
end $function$;
