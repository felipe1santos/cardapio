-- Múltiplos turnos de funcionamento por dia (ex: marmita 11:00–14:00 e pizza
-- 18:00–02:00, loja fechada no vão da tarde).
--
-- Nenhuma coluna nova: só muda o formato do jsonb de horario_funcionamento.
--   antes:  {"1": {"abre":"18:00","fecha":"23:00"}}
--   depois: {"1": [{"abre":"18:00","fecha":"23:00"}]}
--
-- `null` (dia fechado) e arrays já convertidos passam intactos. O filtro pelo
-- exists() torna a migration idempotente: rodar de novo não encontra objeto e
-- não faz nada.

update restaurantes
set horario_funcionamento = (
  select jsonb_object_agg(
    key,
    case when jsonb_typeof(value) = 'object' then jsonb_build_array(value) else value end
  )
  from jsonb_each(horario_funcionamento)
)
where horario_funcionamento is not null
  and exists (
    select 1 from jsonb_each(horario_funcionamento) as e
    where jsonb_typeof(e.value) = 'object'
  );
