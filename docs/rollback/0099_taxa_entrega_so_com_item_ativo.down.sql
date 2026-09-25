-- Rollback da 0099. Remove os gatilhos e funções novos e devolve comanda_totais (0094)
-- e comanda_fechamento_simular (0096) exatamente como eram. A coluna
-- comandas.taxa_entrega_cobrada sai por último (só guarda o valor do fechamento; os
-- valores oficiais — total_final e pagamentos — ficam intactos). Nenhum pedido muda.
drop trigger if exists pedidos_novo_taxa_entrega on public.pedidos;
drop trigger if exists pedido_itens_cancelado_taxa_entrega on public.pedido_itens;
drop trigger if exists pedidos_cancelado_taxa_entrega on public.pedidos;
drop trigger if exists comandas_taxa_entrega_no_fechamento on public.comandas;
drop function if exists public.pedido_novo_taxa_entrega();
drop function if exists public.item_cancelado_taxa_entrega();
drop function if exists public.pedido_cancelado_taxa_entrega();
drop function if exists public.comanda_taxa_entrega_no_fechamento();
drop function if exists public.comanda_tem_item_ativo(uuid);
drop function if exists public.comanda_entrega_ativa_do_pedido(uuid);

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
           desconto_percentual as desc_pct, coalesce(taxa_entrega, 0) as entrega
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
      'taxa_entrega', (select taxa_entrega from public.comandas where id = p_comanda));
    raise exception 'simulacao_ok';
  exception when others then
    if sqlerrm <> 'simulacao_ok' then raise; end if;
  end;
  return v_resultado;
end $$;

drop function if exists public.comanda_taxa_entrega_efetiva(uuid);
alter table public.comandas drop column if exists taxa_entrega_cobrada;
