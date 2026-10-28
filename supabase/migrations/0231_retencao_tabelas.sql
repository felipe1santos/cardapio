-- 0231 — Limpeza automática das tabelas que crescem sem limite (28/10/2026, aprovada pelo dono — varredura Etapa 2,
-- docs/relatorios/2026-10-28-varredura.md). Chamada 1×/dia pelo vigia (lib/saude/vigia.ts, junto com o resumo das 09:00).
-- Até 20 mil linhas por tabela por rodada (não trava o banco; o resto sai no dia seguinte).
--   · eventos_auditoria: SÓ o registro técnico `whatsapp.conexao` com mais de 30 dias (o resto da auditoria fica para sempre)
--   · whatsapp_eventos (metadado de webhook): 90 dias
--   · vitrine_eventos (métricas da vitrine): 13 meses (comparação ano a ano)
--   · impressao_trabalhos, api_alertas: 180 dias
--   · fin_alertas: 180 dias, só os já lidos
--   · push_envios: 180 dias, só os que NÃO viraram pedido (a conversão das campanhas fica)
-- Backup antes da 1ª rodada: ~/menuzia-backups/retencao-2026-10-28/ (fora do git).
-- Rollback: drop function if exists public.sistema_limpar_retencao();

create or replace function public.sistema_limpar_retencao()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
  n integer;
begin
  delete from public.eventos_auditoria where ctid in (select ctid from public.eventos_auditoria where acao = 'whatsapp.conexao' and criado_em < now() - interval '30 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('eventos_auditoria', n);
  delete from public.whatsapp_eventos where ctid in (select ctid from public.whatsapp_eventos where criado_em < now() - interval '90 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('whatsapp_eventos', n);
  delete from public.vitrine_eventos where ctid in (select ctid from public.vitrine_eventos where criado_em < now() - interval '13 months' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('vitrine_eventos', n);
  delete from public.impressao_trabalhos where ctid in (select ctid from public.impressao_trabalhos where criado_em < now() - interval '180 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('impressao_trabalhos', n);
  delete from public.api_alertas where ctid in (select ctid from public.api_alertas where criado_em < now() - interval '180 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('api_alertas', n);
  delete from public.fin_alertas where ctid in (select ctid from public.fin_alertas where lido_em is not null and criado_em < now() - interval '180 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('fin_alertas', n);
  delete from public.push_envios where ctid in (select ctid from public.push_envios where pedido_em is null and criado_em < now() - interval '180 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('push_envios', n);
  return r;
end $$;
revoke all on function public.sistema_limpar_retencao() from public, anon, authenticated;
grant execute on function public.sistema_limpar_retencao() to service_role;
