-- 0164 — Custo do item na venda: 1º ficha técnica; 2º "Preço de custo" do Gestor de Cardápio (> 0); 3º sem custo.
-- pedido_itens_custo.origem = 'ficha' | 'cardapio' | 'nenhum' (vendas antigas ficam null). Complementos/borda/massa:
-- só ficha (não há preço de custo para eles no cardápio). A gravação continua só nas lojas com o financeiro ligado
-- — a 0165 estende a todas as lojas. Rollback: docs/rollback/0164_custo_do_cardapio.down.sql
alter table public.pedido_itens_custo add column if not exists origem text check (origem in ('ficha', 'cardapio', 'nenhum'));

CREATE OR REPLACE FUNCTION public.cmv_custo_linha(p_restaurante uuid, p_item uuid, p_tamanho text, p_sabores text, p_borda text, p_massa text, p_complementos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  it record;
  v_tam uuid;
  v_ficha uuid;
  v_base numeric := null;
  v_extra numeric := 0;
  v_sit text := 'ok';
  v_det jsonb := '[]'::jsonb;
  v_sabores text[];
  v_sabor record;
  v_soma numeric := 0;
  v_n int := 0;
  v_faltou boolean := false;
  c jsonb;
  v_comp uuid;
  v_fc uuid;
  v_origem text := 'ficha';
  v_manual numeric;
begin
  select id, tipo_item into it from public.itens_cardapio where id = p_item;
  if it.id is null then return jsonb_build_object('situacao', 'sem_ficha', 'origem', 'nenhum', 'motivo', 'item_inexistente'); end if;
  -- 0164: "Preço de custo" do Gestor de Cardápio (reais), usado quando o item não tem ficha técnica.
  select nullif(g.preco_custo, 0) into v_manual from public.itens_cardapio_gestao g where g.item_id = p_item and g.restaurante_id = p_restaurante limit 1;
  if v_manual is not null and v_manual < 0 then v_manual := null; end if;

  if it.tipo_item = 'pizza' and coalesce(btrim(p_sabores), '') <> '' then
    select id into v_tam from public.tamanhos_padrao_pizza
     where restaurante_id = p_restaurante and public.cmv_chave(nome) = public.cmv_chave(p_tamanho) limit 1;
    -- Sabor legado cujo nome contém " / " vence a divisão (mesma regra do preço).
    if exists (select 1 from public.pizza_sabores where item_id = p_item and public.cmv_chave(nome) = public.cmv_chave(p_sabores)) then
      v_sabores := array[p_sabores];
    else
      v_sabores := string_to_array(p_sabores, ' / ');
    end if;
    foreach p_sabores in array v_sabores loop
      v_n := v_n + 1;
      select s.id, s.nome, f.id as ficha into v_sabor from public.pizza_sabores s
        left join public.cmv_fichas f on f.restaurante_id = p_restaurante and f.alvo_tipo = 'sabor' and f.alvo_id = s.id and f.tamanho_padrao_id = v_tam
       where s.item_id = p_item and public.cmv_chave(s.nome) = public.cmv_chave(p_sabores) limit 1;
      if v_sabor.ficha is null then
        v_faltou := true;
        v_det := v_det || jsonb_build_object('parte', 'sabor', 'nome', btrim(p_sabores), 'sem_ficha', true);
      else
        v_soma := v_soma + public.cmv_custo_ficha(v_sabor.ficha);
        v_det := v_det || jsonb_build_object('parte', 'sabor', 'nome', v_sabor.nome, 'fracao', '1/' || array_length(v_sabores, 1), 'custo', round(public.cmv_custo_ficha(v_sabor.ficha), 4));
      end if;
    end loop;
    if v_faltou then
      if v_manual is null then return jsonb_build_object('situacao', 'sem_ficha', 'origem', 'nenhum', 'detalhe', v_det); end if;
      -- Algum sabor sem ficha: vale o preço de custo do item (cardápio) para a pizza inteira.
      v_base := v_manual * 100; v_origem := 'cardapio';
      v_det := jsonb_build_array(jsonb_build_object('parte', 'item', 'origem', 'cardapio', 'custo', round(v_base, 4)));
    else
      v_base := v_soma / greatest(v_n, 1); -- fração 1/N de cada sabor
    end if;
  else
    if coalesce(btrim(p_tamanho), '') <> '' then
      select f.id into v_ficha from public.tamanhos_item t
        join public.cmv_fichas f on f.restaurante_id = p_restaurante and f.alvo_tipo = 'tamanho' and f.alvo_id = t.id
       where t.item_id = p_item and public.cmv_chave(t.nome) = public.cmv_chave(p_tamanho)
         and exists (select 1 from public.cmv_ficha_componentes fc where fc.ficha_id = f.id) limit 1; -- ficha vazia = sem ficha (0164)
    end if;
    if v_ficha is null then
      select f.id into v_ficha from public.cmv_fichas f where f.restaurante_id = p_restaurante and f.alvo_tipo = 'item' and f.alvo_id = p_item
         and exists (select 1 from public.cmv_ficha_componentes fc where fc.ficha_id = f.id); -- ficha vazia = sem ficha (0164)
    end if;
    if v_ficha is null then
      if v_manual is null then return jsonb_build_object('situacao', 'sem_ficha', 'origem', 'nenhum'); end if;
      v_base := v_manual * 100; v_origem := 'cardapio';
      v_det := v_det || jsonb_build_object('parte', 'item', 'origem', 'cardapio', 'custo', round(v_base, 4));
    else
      v_base := public.cmv_custo_ficha(v_ficha);
      v_det := v_det || jsonb_build_object('parte', 'item', 'custo', round(v_base, 4));
    end if;
  end if;

  -- Borda e massa (pizza): ficha da loja pelo nome. Sem ficha: custo 0 e a linha fica "parcial".
  if coalesce(btrim(p_borda), '') <> '' then
    select f.id into v_fc from public.bordas_pizza b join public.cmv_fichas f on f.restaurante_id = p_restaurante and f.alvo_tipo = 'borda' and f.alvo_id = b.id
     where b.restaurante_id = p_restaurante and public.cmv_chave(b.nome) = public.cmv_chave(p_borda) limit 1;
    if v_fc is null then v_sit := 'parcial'; else v_extra := v_extra + public.cmv_custo_ficha(v_fc); end if;
  end if;
  v_fc := null;
  if coalesce(btrim(p_massa), '') <> '' then
    select f.id into v_fc from public.massas_pizza m join public.cmv_fichas f on f.restaurante_id = p_restaurante and f.alvo_tipo = 'massa' and f.alvo_id = m.id
     where m.restaurante_id = p_restaurante and public.cmv_chave(m.nome) = public.cmv_chave(p_massa) limit 1;
    if v_fc is not null then v_extra := v_extra + public.cmv_custo_ficha(v_fc); end if;
  end if;

  -- Adicionais: cada entrada do jsonb (repetida = quantidade). Sem ficha = custo 0 (anotado no detalhe).
  for c in select * from jsonb_array_elements(coalesce(p_complementos, '[]'::jsonb)) loop
    v_comp := null; v_fc := null;
    select ic.id into v_comp from public.item_complementos ic where ic.item_id = p_item and public.cmv_chave(ic.nome) = public.cmv_chave(c->>'nome') limit 1;
    if v_comp is not null then
      select id into v_fc from public.cmv_fichas where restaurante_id = p_restaurante and alvo_tipo = 'complemento' and alvo_id = v_comp;
    end if;
    if v_fc is null then
      v_det := v_det || jsonb_build_object('parte', 'adicional', 'nome', c->>'nome', 'sem_ficha', true);
    else
      v_extra := v_extra + public.cmv_custo_ficha(v_fc);
      v_det := v_det || jsonb_build_object('parte', 'adicional', 'nome', c->>'nome', 'custo', round(public.cmv_custo_ficha(v_fc), 4));
    end if;
  end loop;

  return jsonb_build_object('situacao', v_sit, 'origem', v_origem, 'custo', v_base + v_extra, 'detalhe', v_det);
end $function$;

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
end $function$;
