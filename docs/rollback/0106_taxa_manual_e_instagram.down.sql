-- Rollback da 0106 — volta taxa manual e Instagram ao estado da 0105.
--
-- ATENÇÃO: apaga as colunas novas. Taxa manual gravada em conta e Instagram cadastrado
-- se perdem. Contas abertas com taxa manual voltam a somar sem ela (o total cai).
-- Rodar ANTES de voltar o código (redeploy) só se o código novo também for revertido.

-- comanda_totais e comanda_fechamento_simular como na 0099
create or replace function public.comanda_totais(p_comanda uuid)
returns table(subtotal numeric, taxa_servico numeric, desconto numeric, total numeric, pago numeric, restante numeric)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select coalesce(sum(i.preco_unitario * i.quantidade), 0)::numeric as sub
      from public.pedidos p
      join public.pedido_itens i on i.pedido_id = p.id
     where p.comanda_id = p_comanda
       and p.status <> 'cancelado'
       and i.cancelado_em is null
  ),
  c as (
    select taxa_servico_percentual as pct, desconto_tipo as tipo, desconto_valor as desc_valor,
           desconto_percentual as desc_pct, public.comanda_taxa_entrega_efetiva(p_comanda) as entrega
      from public.comandas where id = p_comanda
  ),
  pg as (
    select coalesce(sum(valor), 0)::numeric as pago
      from public.pagamentos_comanda where comanda_id = p_comanda and estornado_em is null
  ),
  bruto as (
    select round(base.sub, 2) as sub,
           round(base.sub * c.pct / 100, 2) as taxa,
           case when c.tipo = 'percentual' then round(base.sub * c.desc_pct / 100, 2)
                else c.desc_valor end as desc_pedido,
           c.entrega,
           pg.pago
      from base, c, pg
  ),
  calc as (
    select sub, taxa, least(desc_pedido, sub + taxa) as desc_aplicado, entrega, pago from bruto
  )
  select sub, taxa, desc_aplicado, round(sub + taxa + entrega - desc_aplicado, 2), pago,
         greatest(round(sub + taxa + entrega - desc_aplicado - pago, 2), 0)
    from calc
$$;

create or replace function public.comanda_fechamento_simular(
  p_restaurante uuid, p_comanda uuid, p_acoes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_cancelados jsonb;
  v_resultado jsonb;
begin
  perform 1 from public.comandas where id = p_comanda and restaurante_id = p_restaurante and status = 'aberta';
  if not found then raise exception 'comanda_nao_aberta'; end if;
  begin
    perform public.comanda_aplicar_decisoes(p_restaurante, p_comanda, p_acoes, null, 'simulação', null, 'simulacao');
    select * into t from public.comanda_totais(p_comanda);
    select coalesce(sum(i.preco_unitario * i.quantidade), 0) into v_cancelados
      from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
     where p.comanda_id = p_comanda and (p.status = 'cancelado' or i.cancelado_em is not null);
    v_resultado := jsonb_build_object('subtotal', t.subtotal, 'taxa', t.taxa_servico, 'desconto', t.desconto,
      'total', t.total, 'pago', t.pago, 'restante', t.restante, 'cancelados', round(v_cancelados::numeric, 2),
      'excedente', greatest(round(t.pago - t.total, 2), 0),
      'taxa_entrega', public.comanda_taxa_entrega_efetiva(p_comanda));
    raise exception 'simulacao_ok';
  exception when others then
    if sqlerrm <> 'simulacao_ok' then raise; end if;
  end;
  return v_resultado;
end $$;

-- snapshot da pré-conta como na 0093
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

drop function if exists public.comanda_taxa_extra_definir(uuid, uuid, text, numeric, uuid, text);

alter table public.comandas drop constraint if exists comandas_taxa_extra_check;
alter table public.comandas drop column if exists taxa_extra_em;
alter table public.comandas drop column if exists taxa_extra_por_nome;
alter table public.comandas drop column if exists taxa_extra_valor;
alter table public.comandas drop column if exists taxa_extra_nome;

alter table public.restaurantes drop constraint if exists restaurantes_instagram_url_check;
alter table public.restaurantes drop column if exists instagram_url;

delete from public.schema_migrations where name = '0106_taxa_manual_e_instagram.sql';
