-- Rollback da 0245 (disparos recorrentes). Apaga os cards e as rodadas voltam a ser campanhas soltas (recorrente_id some).
-- As funções recriadas pela 0245 (reserva, métricas) voltam às versões anteriores: reaplicar 0190 (campanha_reservar_envios)
-- e 0104 (campanha_atribuicoes / campanhas_metricas) DEPOIS deste arquivo.

drop function if exists public.campanha_recorrentes_gerar_rodadas();
drop function if exists public.campanha_recorrente_estimativa(text);
drop function if exists public.campanha_recorrente_publico(uuid, text);
drop trigger if exists campanha_recorrentes_agenda on public.campanha_recorrentes;
drop function if exists public.campanha_recorrentes_agenda_fn();
drop function if exists public.campanha_recorrente_proximo(smallint[], time, timestamptz);
drop index if exists public.campanhas_recorrente_idx;
alter table public.campanhas drop column if exists recorrente_id;
drop table if exists public.campanha_recorrentes;
update public.plataforma_config set valor = '3'::jsonb, atualizado_em = now(), atualizado_por = 'rollback 0245'
 where chave = 'disparo_frequencia_dias' and valor = '2'::jsonb;
