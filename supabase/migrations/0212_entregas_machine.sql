-- 0212 — Machine (Gaudium) como provedor de entrega pela logística Open Delivery (20/10/2026). Só amplia o CHECK do
-- provedor (0199/0208); nenhuma linha muda. A integração fica "Em breve" no código (PROVEDOR_DISPONIVEL.machine) até a
-- primeira loja receber as credenciais da central Machine e o teste passar.
alter table public.entregas_provedor_config drop constraint if exists entregas_provedor_config_provedor_check;
alter table public.entregas_provedor_config add constraint entregas_provedor_config_provedor_check
  check (provedor in ('lalamove', 'ifood', 'foody', 'machine'));
