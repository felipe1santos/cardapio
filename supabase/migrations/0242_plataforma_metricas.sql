-- 0242 — Métricas da plataforma agregadas no banco (01/11/2026, auditoria de infraestrutura, Fase 6).
-- O Super Admin paginava todos os pedidos entregues de todas as lojas pelo PostgREST (1.000 por página) só para somar o
-- faturamento e contar: o egress crescia com o histórico. Agora o banco devolve uma linha por loja.
-- Só o servidor executa. Rollback: drop function if exists public.plataforma_metricas_entregues();

create or replace function public.plataforma_metricas_entregues()
returns table (restaurante_id uuid, faturamento numeric, qtd_pedidos bigint)
language sql
stable
security definer
set search_path = public
as $$
  select restaurante_id, coalesce(sum(total), 0)::numeric as faturamento, count(*)::bigint as qtd_pedidos
    from public.pedidos
   where status = 'entregue' and restaurante_id is not null
   group by restaurante_id
$$;
revoke all on function public.plataforma_metricas_entregues() from public, anon, authenticated;
grant execute on function public.plataforma_metricas_entregues() to service_role;
