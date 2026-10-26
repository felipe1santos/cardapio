-- 0226 — Totais de várias comandas numa chamada (26/10/2026, achado #9 da auditoria).
-- A Central do balcão chamava `comanda_totais` uma vez POR comanda (até 200) a cada recarga. Aqui o mesmo cálculo,
-- para uma lista de ids, numa chamada só. Reaproveita `comanda_totais` (o resultado é idêntico, comanda a comanda).
-- Só o servidor (service_role) executa: a Central lê pelo admin client, com a loja da sessão.
-- Rollback: drop function if exists public.comanda_totais_lote(uuid[]);

create or replace function public.comanda_totais_lote(p_comandas uuid[])
returns table(comanda_id uuid, subtotal numeric, taxa_servico numeric, desconto numeric, total numeric, pago numeric, restante numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, t.subtotal, t.taxa_servico, t.desconto, t.total, t.pago, t.restante
    from unnest(p_comandas) as c(id)
    cross join lateral public.comanda_totais(c.id) as t
$$;

revoke all on function public.comanda_totais_lote(uuid[]) from public, anon, authenticated;
grant execute on function public.comanda_totais_lote(uuid[]) to service_role;
