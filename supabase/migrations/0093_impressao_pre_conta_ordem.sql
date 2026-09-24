-- ============================================================================
-- 0093 — Pré-conta: ordem determinística
--
-- Duas impressões da mesma conta têm que sair na mesma ordem. Até a 0092:
--   · itens ordenados por pedido_itens.id (UUID aleatório): a ordem não era a do
--     lançamento e variava de uma conta para outra;
--   · adicionais na ordem em que chegaram no pedido (ordem de clique);
--   · pagamentos AGRUPADOS por forma e em ordem alfabética (Dinheiro antes de Pix,
--     mesmo recebido depois).
--
-- Regra nova:
--   · pedidos por criado_em, numero; itens na ordem do lançamento (lancamento_seq),
--     desempate por id;
--   · adicionais na ordem do cadastro do item (grupo, posição), desempate pelo id do
--     adicional; o que não estiver mais no cadastro vai no fim, na ordem gravada;
--   · pagamentos um a um, por criado_em (recebimento), desempate por id.
--
-- lancamento_seq: coluna NOVA e nula, sem reescrever a tabela nem converter dado
-- existente. Só itens gravados daqui em diante recebem número (default da
-- sequência, na ordem do insert); itens antigos ficam nulos e caem no desempate por
-- id — exatamente o comportamento de antes para eles. Nenhum caminho de gravação
-- muda: o insert que já existe preenche a coluna sozinho.
-- ============================================================================

create sequence if not exists public.pedido_itens_lancamento_seq;
alter table public.pedido_itens add column if not exists lancamento_seq bigint;
alter table public.pedido_itens alter column lancamento_seq set default nextval('public.pedido_itens_lancamento_seq');
alter sequence public.pedido_itens_lancamento_seq owned by public.pedido_itens.lancamento_seq;
-- Quem grava item hoje: service_role (servidor) e funções SECURITY DEFINER (dono).
grant usage on sequence public.pedido_itens_lancamento_seq to service_role;

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
begin
  select co.id, co.tipo, co.numero, co.senha, co.cliente_nome, co.aberta_em, co.taxa_servico_percentual,
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

  return jsonb_build_object(
    'versao', 1,
    'loja', c.loja_nome,
    'tipo', c.tipo,
    'mesa', c.mesa_nome,
    'comanda_numero', c.numero,
    'senha', c.senha,
    'cliente_nome', case when c.tipo = 'balcao' then c.cliente_nome end,
    'aberta_em', c.aberta_em,
    'impresso_em', now(),
    'operador', p_operador,
    'via', p_via,
    'itens', v_itens,
    'cancelados', v_cancelados,
    'subtotal', t.subtotal,
    'taxa_percentual', c.taxa_servico_percentual,
    'taxa', t.taxa_servico,
    'desconto', t.desconto,
    'total', t.total,
    'pago', t.pago,
    'restante', t.restante,
    'pagamentos', v_pagamentos);
end $function$;

revoke execute on function public.impressao_snapshot_pre_conta(uuid, int, text) from public, anon, authenticated;
grant execute on function public.impressao_snapshot_pre_conta(uuid, int, text) to service_role;
