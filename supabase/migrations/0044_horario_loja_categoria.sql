-- Loja aberta/fechada (manual + horário automático) e categoria com ativação
-- automática por horário. Aditivo e idempotente.

-- Grade semanal de funcionamento: {"0": null, "1": {"abre":"18:00","fecha":"23:00"}, ...}
-- chave = dia da semana (0=domingo..6=sábado), null = fechado nesse dia.
alter table restaurantes add column if not exists horario_funcionamento jsonb;

-- Estado da loja: segue a grade automaticamente, ou fica travada aberta/fechada
-- até o operador reverter manualmente.
alter table restaurantes add column if not exists status_loja text not null default 'automatico';

alter table restaurantes drop constraint if exists restaurantes_status_loja_check;
alter table restaurantes add constraint restaurantes_status_loja_check
  check (status_loja in ('automatico', 'aberto_manual', 'fechado_manual'));

-- Categoria ativa só num intervalo do dia (ex: marmitaria de dia, pizza à noite).
-- Ambos nulos = categoria sempre ativa (comportamento atual, sem mudança).
alter table grupos_cardapio add column if not exists horario_ativo_inicio time;
alter table grupos_cardapio add column if not exists horario_ativo_fim time;
