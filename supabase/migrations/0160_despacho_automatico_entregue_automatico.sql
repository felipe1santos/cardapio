-- 0160 — Item 61 (2026-10-08): despacho automático e "entregue (automático)".
--
-- restaurantes.despacho_automatico: ligado, todo pedido de ENTREGA que fica pronto vai sozinho para
--   um motoboy disponível (lib/motoboy/despacho-automatico.ts). Muda só pela API
--   /api/admin/despacho/automatico (servidor, auditada em eventos_auditoria): o navegador só LÊ.
-- pedidos.entregue_automatico: o pedido ficou 1h30 "em rota" sem o motoboy confirmar e o sistema
--   marcou como entregue. Selo no histórico; o dinheiro com o motoboy continua pendente no acerto
--   (o gatilho caixa_turno_abre_na_entrega lança a pendência como em qualquer entrega sem registro).
-- Aditiva: nenhuma loja muda (padrão desligado). Rollback:
--   docs/rollback/0160_despacho_automatico_entregue_automatico.down.sql

alter table public.restaurantes add column if not exists despacho_automatico boolean not null default false;
grant select (despacho_automatico) on public.restaurantes to authenticated;

alter table public.pedidos add column if not exists entregue_automatico boolean not null default false;
