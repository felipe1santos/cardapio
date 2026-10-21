-- 0215 — Uber Direct (e Borzo, só no CHECK) como provedores de entrega (21/10/2026).
-- Uber Direct precisa de mais dois dados além de client id/secret: o customer_id (conta Uber Direct, não é segredo) e a
-- "signing key" do webhook (segredo, cifrada como as outras chaves). entregas_provedor_config é só service_role (0199):
-- nenhuma coluna nova precisa de grant. A Borzo entra no CHECK para o card existir, mas está fora do Brasil (sem conector).
-- Aditiva. Rollback: drop das duas colunas e o CHECK da 0212.
alter table public.entregas_provedor_config add column if not exists conta_id text not null default '';
alter table public.entregas_provedor_config add column if not exists webhook_segredo_cifrado text;
alter table public.entregas_provedor_config drop constraint if exists entregas_provedor_config_provedor_check;
alter table public.entregas_provedor_config add constraint entregas_provedor_config_provedor_check
  check (provedor in ('lalamove', 'ifood', 'foody', 'machine', 'uber', 'borzo'));
