-- ============================================================================
-- 0098 — Entrega do balcão: para onde vai quando fica pronta
--
-- O card preto do PDV abre pedido de ENTREGA (canal balcao, tipo entrega). Quando a
-- cozinha marca "pronto":
--   · loja com Logística ativa  → o pedido segue para a Logística (fica em "pronto",
--     como a entrega do delivery, e o despacho é lá);
--   · loja sem Logística        → é concluído na hora ("entregue"), sem ficar parado
--     em "Pronto p/ despacho" esperando alguém que a loja não tem.
--
-- "Logística ativa" reaproveita a configuração que já existe — nenhuma flag nova:
--   restaurantes.usa_logistica = true E restaurantes.entrega_sem_entregador = false.
-- (usa_logistica desligado tira o módulo do menu; entrega_sem_entregador é a loja que
-- não cadastra motoboy — 0079.)
--
-- Vale para TODO caminho que grava status (Kanban no navegador, cozinha por token,
-- rotas do servidor): é gatilho no banco. Só pedidos canal balcao + tipo entrega; o
-- delivery e a mesa não mudam. Cada decisão fica registrada em eventos_auditoria
-- (acao 'pedido.entrega_balcao_destino', dados.caminho = 'logistica' | 'conclusao_automatica').
--
-- O gatilho roda antes de pedidos_transicao_valida e de pedidos_carimbar_etapa (ordem
-- alfabética dos BEFORE triggers): o carimbo de "pronto" é feito aqui, para o tempo de
-- cozinha continuar medido mesmo quando o pedido já sai concluído.
--
-- Rollback: docs/rollback/0098_balcao_entrega_destino.down.sql
-- ============================================================================

create or replace function public.pedido_entrega_balcao_destino()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usa_logistica boolean;
  v_sem_entregador boolean;
  v_ator uuid := auth.uid();
  v_ator_nome text;
begin
  if new.status is not distinct from old.status or new.status <> 'pronto' then return new; end if;
  if new.canal is distinct from 'balcao' or new.tipo is distinct from 'entrega' then return new; end if;

  select coalesce(r.usa_logistica, true), coalesce(r.entrega_sem_entregador, false)
    into v_usa_logistica, v_sem_entregador
    from public.restaurantes r where r.id = new.restaurante_id;
  if v_ator is not null then
    select u.nome into v_ator_nome from public.usuarios u where u.id = v_ator;
  end if;

  if v_usa_logistica and not v_sem_entregador then
    perform public.auditoria_registrar(new.restaurante_id, v_ator, v_ator_nome, 'pedido.entrega_balcao_destino', 'pedido', new.id,
      jsonb_build_object('caminho', 'logistica', 'numero', new.numero));
    return new;
  end if;

  new.pronto_em := coalesce(new.pronto_em, now());
  new.status := 'entregue';
  new.atendimento_status := 'concluido';
  new.concluido_em := coalesce(new.concluido_em, now());
  perform public.auditoria_registrar(new.restaurante_id, v_ator, v_ator_nome, 'pedido.entrega_balcao_destino', 'pedido', new.id,
    jsonb_build_object('caminho', 'conclusao_automatica', 'numero', new.numero,
      'motivo', case when v_sem_entregador then 'entrega_sem_entregador' else 'logistica_desligada' end));
  return new;
end $$;

revoke all on function public.pedido_entrega_balcao_destino() from public, anon, authenticated;

drop trigger if exists pedidos_balcao_entrega_destino on public.pedidos;
create trigger pedidos_balcao_entrega_destino
  before update of status on public.pedidos
  for each row execute function public.pedido_entrega_balcao_destino();
