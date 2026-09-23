-- ============================================================================
-- 0087 — Fila de impressão: só reserva quem tem identidade (correção do B1)
--
-- Na 0086 o GET /api/agente/pedidos passou a RESERVAR pedidos. Mas o Assistente
-- também chama essa rota nos botões "Testar pareamento", "Buscar impressoras" e
-- "Testar impressora" — sem identificador de instância. Cada clique nesses botões
-- escondia pedidos reais por 90 s de TODOS os Assistentes da loja.
--
-- Agora: sem identidade válida, a rota lista os elegíveis SEM gravar nada (é o
-- comportamento de antes da 0086) — e ainda respeita reservas ativas de quem tem
-- identidade, para um Assistente antigo não imprimir o que um novo já pegou.
-- Reserva só acontece com identidade (instância ou agente autenticado).
--
-- Rollback: `drop function public.impressao_elegiveis(uuid);` (a rota volta a
-- reservar sempre só se o código anterior for reposto).
-- ============================================================================

create or replace function public.impressao_elegiveis(p_restaurante uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.pedidos p
    left join public.impressao_reservas r on r.pedido_id = p.id
   where p.restaurante_id = p_restaurante
     and p.status <> 'cancelado'
     and exists (select 1 from public.pedido_itens i where i.pedido_id = p.id)
     and (
           (p.impresso = false and p.status = 'recebido')
        or (p.impresso = false and p.status in ('preparando', 'pronto') and p.criado_em >= now() - interval '6 hours')
        or p.reimprimir = true
     )
     and (r.pedido_id is null or r.reservado_ate < now())
   order by p.criado_em
   limit 50
$$;

revoke execute on function public.impressao_elegiveis(uuid) from public, anon, authenticated;
grant execute on function public.impressao_elegiveis(uuid) to service_role;

-- Reservas sem dono deixadas por chamadas de diagnóstico da versão anterior.
delete from public.impressao_reservas where reservado_por is null;
