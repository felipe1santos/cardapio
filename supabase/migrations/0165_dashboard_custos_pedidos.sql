-- 0165 — Custo por pedido para o gráfico de Faturamento e Lucro do Dashboard (09/10). Só leitura.
-- Pedido "com custo" = TODAS as linhas vivas (não canceladas) têm custo gravado na venda (ficha ou cardápio, 0164).
-- Devolve só esses pedidos, com o custo total em centavos. Chamada pelo servidor (service_role), nunca pelo navegador.
-- Rollback: docs/rollback/0165_dashboard_custos_pedidos.down.sql
create or replace function public.dashboard_custos_pedidos(p_restaurante uuid, p_ini timestamptz, p_fim timestamptz)
returns table (pedido_id uuid, custo_centavos bigint)
language sql stable security definer set search_path = public as $$
  select p.id, round(sum(c.custo_unitario * i.quantidade))::bigint
    from public.pedidos p
    join public.pedido_itens i on i.pedido_id = p.id and i.cancelado_em is null
    left join public.pedido_itens_custo c on c.pedido_item_id = i.id
   where p.restaurante_id = p_restaurante and p.criado_em >= p_ini and p.criado_em < p_fim
     and p.status not in ('cancelado', 'aguardando_pagamento')
   group by p.id
  having bool_and(c.custo_unitario is not null and c.situacao <> 'sem_ficha' and c.situacao <> 'erro')
$$;
revoke execute on function public.dashboard_custos_pedidos(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.dashboard_custos_pedidos(uuid, timestamptz, timestamptz) to service_role;
