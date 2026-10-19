-- 0208 — Provedores de entrega além da Lalamove (19/10/2026, Etapa 3 do modo autônomo): entregador do iFood
-- (Sob Demanda, para pedidos de fora do iFood) e Foody Delivery (padrão Open Delivery, módulo Logistics).
-- Mesmas tabelas da Lalamove (0199): uma linha de config por loja × provedor; corridas em entregas_provedor com o
-- MESMO vocabulário de status (ASSIGNING_DRIVER, ON_GOING, PICKED_UP, COMPLETED, CANCELED, REJECTED, EXPIRED), para o
-- card, o Financeiro e o Kanban funcionarem sem mudança. Módulos entregas_ifood / entregas_foody já existem (0207),
-- desligados por padrão.
alter table public.entregas_provedor_config drop constraint if exists entregas_provedor_config_provedor_check;
alter table public.entregas_provedor_config add constraint entregas_provedor_config_provedor_check
  check (provedor in ('lalamove', 'ifood', 'foody'));
-- Foody (Open Delivery): URL base da API do provedor (cada integradora tem a sua). Lalamove/iFood: vazio (URL fixa).
alter table public.entregas_provedor_config add column if not exists base_url text not null default '';
