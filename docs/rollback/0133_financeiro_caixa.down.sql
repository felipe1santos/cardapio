-- Rollback da 0133 (rodar como dono do banco).
-- Os lançamentos do livro-caixa feitos pelos gatilhos ficam (são imutáveis e apontam o turno).
begin;
drop trigger if exists fin_pagamento_no_caixa on public.pagamentos_comanda;
drop function if exists public.fin_pagamento_no_caixa();
drop function if exists public.fin_carteira_da_forma(text);
drop trigger if exists a_fin_lancamento_turno_aberto on public.fin_lancamentos;
drop function if exists public.fin_lancamento_turno_aberto();
drop trigger if exists caixa_turno_fechado_imutavel on public.caixa_turnos;
drop function if exists public.caixa_turno_fechado_imutavel();
alter table public.caixa_turnos
  drop constraint if exists caixa_turnos_status_check,
  drop constraint if exists caixa_turnos_status_coerente,
  drop constraint if exists caixa_turnos_fundo_check,
  drop constraint if exists caixa_turnos_textos_check,
  drop column if exists status,
  drop column if exists valor_inicial_centavos,
  drop column if exists contado_dinheiro_centavos,
  drop column if exists contado_cartao_centavos,
  drop column if exists esperado_dinheiro_centavos,
  drop column if exists esperado_cartao_centavos,
  drop column if exists diferenca_centavos,
  drop column if exists diferenca_cartao_centavos,
  drop column if exists pendencias,
  drop column if exists resumo,
  drop column if exists justificativa,
  drop column if exists fechamento_aprovacao_id,
  drop column if exists fechamento_aprovado_por_nome,
  drop column if exists dispositivo_abertura,
  drop column if exists dispositivo_fechamento,
  drop column if exists reaberto_por,
  drop column if exists reaberto_por_nome,
  drop column if exists reaberto_em,
  drop column if exists reaberto_motivo;
do $$ begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where name = '0133_financeiro_caixa.sql';
  end if;
end $$;
commit;
