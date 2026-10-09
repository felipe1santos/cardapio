-- Rollback da 0163: fin_vendas_base volta à versão da 0145 (taxas/descontos só do pedido).
CREATE OR REPLACE FUNCTION public.fin_vendas_base(p_restaurante uuid, p_de date, p_ate date, p_grupo text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lim as (
    select (p_de::timestamp at time zone 'America/Sao_Paulo') ini, ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo') fim
  ), v as (
    select x.* from public.fin_lancamentos x, lim
     where x.restaurante_id = p_restaurante and x.criado_em >= lim.ini and x.criado_em < lim.fim
       and x.tipo in ('recebimento', 'troco', 'estorno') and x.carteira not in ('empresa', 'resultado')
  ), chaves as (
    select coalesce(comanda_id, pedido_id) chave, bool_or(comanda_id is not null) e_comanda, sum(valor_centavos)::bigint recebido
      from v where coalesce(comanda_id, pedido_id) is not null group by 1
  ), primeira as (
    select c.*, (select min(y.criado_em) from public.fin_lancamentos y
                  where y.restaurante_id = p_restaurante and y.tipo = 'recebimento' and y.carteira not in ('empresa', 'resultado')
                    and coalesce(y.comanda_id, y.pedido_id) = c.chave) primeiro
      from chaves c
  ), vendas as (
    select p.chave, p.e_comanda, p.recebido,
           case p_grupo when 'mes' then date_trunc('month', (p.primeiro at time zone 'America/Sao_Paulo'))::date
                        when 'semana' then date_trunc('week', (p.primeiro at time zone 'America/Sao_Paulo'))::date
                        else (p.primeiro at time zone 'America/Sao_Paulo')::date end bucket
      from primeira p, lim where p.primeiro >= lim.ini and p.primeiro < lim.fim and p.recebido <> 0
  ), ped as (
    select vd.chave, vd.bucket, pe.id pedido_id, pe.total, pe.subtotal, coalesce(pe.desconto, 0) desconto
      from vendas vd join public.pedidos pe on pe.restaurante_id = p_restaurante
       and ((vd.e_comanda and pe.comanda_id = vd.chave and pe.status <> 'cancelado') or (not vd.e_comanda and pe.id = vd.chave))
  ), it as (
    select pd.bucket, pi.item_id, pi.nome, pi.quantidade::bigint qtd, (pi.preco_unitario * 100 * pi.quantidade) receita,
           c.situacao, c.custo_unitario
      from ped pd join public.pedido_itens pi on pi.pedido_id = pd.pedido_id and pi.cancelado_em is null
      left join public.pedido_itens_custo c on c.pedido_item_id = pi.id
  ), tot as (
    -- taxas = total − subtotal + desconto de cada pedido (entrega, embalagem, taxas da 0119...).
    select coalesce(sum(desconto), 0) * 100 desconto, coalesce(sum(total - coalesce(subtotal, total) + desconto), 0) * 100 taxas from ped
  )
  select jsonb_build_object(
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'nome', nome, 'qtd', qtd, 'receita', receita, 'custo', custo,
                                                           'qtd_com_custo', qtd_com_custo, 'receita_com_custo', receita_com_custo)), '[]'::jsonb)
                from (select item_id, max(nome) nome, sum(qtd) qtd, sum(receita) receita,
                             sum(custo_unitario * qtd) filter (where custo_unitario is not null and situacao <> 'sem_ficha') custo,
                             sum(qtd) filter (where custo_unitario is not null and situacao <> 'sem_ficha') qtd_com_custo,
                             sum(receita) filter (where custo_unitario is not null and situacao <> 'sem_ficha') receita_com_custo
                        from it group by item_id, case when item_id is null then nome end) q),
    'cmv_por_bucket', (select coalesce(jsonb_object_agg(bucket, custo), '{}'::jsonb)
                         from (select bucket, sum(custo_unitario * qtd) custo from it where custo_unitario is not null and situacao <> 'sem_ficha' group by bucket) q),
    'cmv', (select coalesce(sum(custo_unitario * qtd), 0) from it where custo_unitario is not null and situacao <> 'sem_ficha'),
    'linhas', (select count(*) from it),
    'sem_custo', (select count(*) from it where custo_unitario is null or situacao = 'sem_ficha'),
    'com_erro', (select count(*) from it where situacao = 'erro'),
    'conciliacao', jsonb_build_object(
      'faturamento', (select coalesce(sum(valor_centavos), 0) from v),
      'vendas', (select count(*) from vendas),
      'itens', (select coalesce(round(sum(receita)), 0) from it),
      'descontos', (select round(desconto) from tot),
      'taxas', (select round(taxas) from tot),
      -- o que sobra: taxa de serviço da comanda, gorjeta, pagamento parcial ou a mais, item cancelado ainda no subtotal.
      'outros', (select coalesce(sum(recebido), 0) from vendas) - coalesce((select round(sum(receita)) from it), 0) - (select round(taxas) from tot) + (select round(desconto) from tot),
      'outro_periodo', (select coalesce(sum(c.recebido), 0) from primeira c, lim where not (c.primeiro >= lim.ini and c.primeiro < lim.fim) or c.primeiro is null),
      'sem_pedido', (select coalesce(sum(valor_centavos), 0) from v where coalesce(comanda_id, pedido_id) is null)
    )
  )
$function$;
