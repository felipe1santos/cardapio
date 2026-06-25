-- Heartbeat do Assistente de Impressão: a cada varredura (5s) o agente informa qual
-- impressora (config do painel) ele está usando. O painel usa isso pra acender a
-- impressora "conectada" e mostrar que o agente está vivo.
alter table restaurantes
  add column if not exists impressao_agente_impressora_id uuid,
  add column if not exists impressao_agente_visto_em timestamptz;
