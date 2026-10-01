-- Rollback da 0126: volta a definição da 0106 (sem o campo taxas).
CREATE OR REPLACE FUNCTION public.impressao_snapshot_pre_conta(p_comanda uuid, p_via integer, p_operador text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c record;
  t record;
  v_itens jsonb;
  v_cancelados jsonb;
  v_pagamentos jsonb;
  v_pedido_numero int;
begin
  select co.id, co.tipo, co.numero, co.senha, co.cliente_nome, co.aberta_em, co.taxa_servico_percentual,
         co.taxa_extra_nome, co.taxa_extra_valor, co.responsavel_nome, co.aberta_por_nome,
         m.nome as mesa_nome, r.nome as loja_nome
    into c
    from public.comandas co
    join public.restaurantes r on r.id = co.restaurante_id
    left join public.mesas m on m.id = co.mesa_id
   where co.id = p_comanda;
  select * into t from public.comanda_totais(p_comanda);

  select coalesce(jsonb_agg(jsonb_build_object(
           'quantidade', i.quantidade, 'nome', i.nome,
           'tamanho', nullif(i.tamanho_nome, ''), 'sabor', nullif(i.sabor_nome, ''),
           'borda', nullif(i.borda_nome, ''), 'massa', nullif(i.massa_nome, ''),
           'observacao', nullif(btrim(coalesce(i.observacao, '')), ''),
           'complementos', coalesce((
              select jsonb_agg(jsonb_build_object('nome', x.e->>'nome', 'preco', round(coalesce((x.e->>'preco')::numeric, 0), 2))
                               order by o.grupo_pos nulls last, o.pos nulls last, o.id nulls last, x.ord)
                from jsonb_array_elements(coalesce(i.complementos, '[]'::jsonb)) with ordinality x(e, ord)
                left join lateral (
                  select g.posicao as grupo_pos, ic.posicao as pos, ic.id
                    from public.item_complementos ic
                    left join public.grupos_item_complementos g on g.id = ic.grupo_id
                   where ic.item_id = i.item_id and ic.nome = x.e->>'nome'
                   order by g.posicao nulls last, ic.posicao nulls last, ic.id
                   limit 1) o on true), '[]'::jsonb),
           'preco_unitario', round(i.preco_unitario, 2),
           'subtotal', round(i.preco_unitario * i.quantidade, 2))
           order by p.criado_em, p.numero, i.lancamento_seq nulls last, i.id), '[]'::jsonb)
    into v_itens
    from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
   where p.comanda_id = p_comanda and p.status <> 'cancelado' and i.cancelado_em is null;

  select coalesce(jsonb_agg(jsonb_build_object('quantidade', i.quantidade, 'nome', i.nome)
           order by p.criado_em, p.numero, i.lancamento_seq nulls last, i.id), '[]'::jsonb)
    into v_cancelados
    from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
   where p.comanda_id = p_comanda and (p.status = 'cancelado' or i.cancelado_em is not null);

  select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', round(valor, 2)) order by criado_em, id), '[]'::jsonb)
    into v_pagamentos
    from public.pagamentos_comanda
   where comanda_id = p_comanda and estornado_em is null;

  select p.numero into v_pedido_numero
    from public.pedidos p where p.comanda_id = p_comanda order by p.criado_em, p.numero limit 1;

  return jsonb_build_object(
    'versao', 1,
    'loja', c.loja_nome,
    'tipo', c.tipo,
    'mesa', c.mesa_nome,
    'comanda_numero', c.numero,
    'pedido_numero', v_pedido_numero,
    'senha', c.senha,
    'cliente_nome', case when c.tipo = 'balcao' then c.cliente_nome end,
    'atendente', coalesce(nullif(btrim(c.responsavel_nome), ''), nullif(btrim(c.aberta_por_nome), '')),
    'aberta_em', c.aberta_em,
    'impresso_em', now(),
    'operador', p_operador,
    'via', p_via,
    'itens', v_itens,
    'cancelados', v_cancelados,
    'subtotal', t.subtotal,
    'taxa_percentual', c.taxa_servico_percentual,
    'taxa', t.taxa_servico,
    'taxa_extra_nome', case when coalesce(c.taxa_extra_valor, 0) > 0 then c.taxa_extra_nome end,
    'taxa_extra', coalesce(c.taxa_extra_valor, 0),
    'taxa_entrega', public.comanda_taxa_entrega_efetiva(p_comanda),
    'desconto', t.desconto,
    'total', t.total,
    'pago', t.pago,
    'restante', t.restante,
    'pagamentos', v_pagamentos);
end $function$;

revoke execute on function public.impressao_snapshot_pre_conta(uuid, int, text) from public, anon, authenticated;
grant execute on function public.impressao_snapshot_pre_conta(uuid, int, text) to service_role;
