-- 0113 — Cancelar pedido só pelo servidor (com permissão, motivo e auditoria).
--
-- Antes: `authenticated` tinha UPDATE(status) em pedidos (0061, por canal) e o gatilho de
-- transição aceitava qualquer ida para 'cancelado' em pedido presencial. Um atendente
-- (balcão) ou a cozinha (mesa) cancelava direto pelo PostgREST — inclusive pedido já
-- entregue e de conta fechada — sem motivo, sem a regra "atendente só cancela o que está
-- recebido e sem pagamento", sem conferir o que já foi pago e sem auditoria.
--
-- Todo cancelamento legítimo já passa por rotas do servidor (service_role), que conferem
-- a permissão do papel, exigem o motivo e registram quem/quando/por quê:
--   /api/admin/pedidos/[id]/cancelar (Kanban/Logística), /api/admin/pdv/pedido/[id]/cancelar,
--   serviço da conta presencial (PDV v2, salão, garçom), app do entregador ("não entregue").
-- Nenhuma tela grava status 'cancelado' pelo navegador (conferido no código em 2026-09-29).
--
-- Rollback: docs/rollback/0113_cancelamento_so_servidor.down.sql

create or replace function public.pedidos_cancelamento_so_servidor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado'
     and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'cancelamento_requer_servidor' using errcode = '42501',
      hint = 'Cancele pelo painel (motivo obrigatório).';
  end if;
  return new;
end $$;

drop trigger if exists pedidos_cancelamento_so_servidor on public.pedidos;
create trigger pedidos_cancelamento_so_servidor
  before update of status on public.pedidos
  for each row execute function public.pedidos_cancelamento_so_servidor();
