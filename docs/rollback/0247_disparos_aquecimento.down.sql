-- Rollback da 0247: tira o resumo e o limite de aquecimento; reaplicar a 0246 (trigger de agenda e gerar_rodadas)
-- DEPOIS deste arquivo. O motivo 'limite_dia' gravado vira 'sem_publico' para caber na constraint antiga.
drop function if exists public.campanha_recorrentes_resumo();
update public.campanha_recorrentes set ultima_rodada_motivo = 'sem_publico' where ultima_rodada_motivo = 'limite_dia';
alter table public.campanha_recorrentes drop constraint if exists campanha_recorrentes_motivo_check;
alter table public.campanha_recorrentes add constraint campanha_recorrentes_motivo_check
  check (ultima_rodada_motivo is null or ultima_rodada_motivo in ('ok', 'sem_publico', 'pulado', 'atrasado'));
drop function if exists public.campanha_recorrente_limite_aquecimento(uuid);
