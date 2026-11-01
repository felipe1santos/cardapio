-- 0239 — Retenção das tabelas que faltavam (01/11/2026, auditoria de infraestrutura, Fase 6). Redefine a função da 0237
-- (que já não toca em eventos_auditoria) acrescentando:
--   · canal_eventos (1 linha por webhook do iFood/99Food): 90 dias
--   · pagamentos_eventos (1 por webhook do Mercado Pago, inclusive inválido): 90 dias
--   · usuarios_sessoes (1 por login/terminal): 180 dias
--   · geocode_cache: entradas vencidas há mais de 30 dias (as de sucesso não vencem e ficam)
--   · cliente_codigos (OTP): vencidos há mais de 1 dia
-- Também a limpeza das tabelas do WhatsApp (whatsapp_limpar_antigos) sai do cron de hora em hora e passa a rodar 1×/dia
-- junto desta (lib/saude/vigia.ts). 1×/dia, até 20 mil linhas por tabela. Rollback: reaplicar a 0237.

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
  delete from public.canal_eventos where ctid in (select ctid from public.canal_eventos where processado_em < now() - interval '90 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('canal_eventos', n);
  delete from public.pagamentos_eventos where ctid in (select ctid from public.pagamentos_eventos where recebido_em < now() - interval '90 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('pagamentos_eventos', n);
  delete from public.usuarios_sessoes where ctid in (select ctid from public.usuarios_sessoes where criado_em < now() - interval '180 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('usuarios_sessoes', n);
  delete from public.geocode_cache where ctid in (select ctid from public.geocode_cache where expira_em is not null and expira_em < now() - interval '30 days' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('geocode_cache', n);
  delete from public.cliente_codigos where ctid in (select ctid from public.cliente_codigos where expira_em < now() - interval '1 day' limit 20000);
  get diagnostics n = row_count; r := r || jsonb_build_object('cliente_codigos', n);
  return r;
end $$;
revoke all on function public.sistema_limpar_retencao() from public, anon, authenticated;
grant execute on function public.sistema_limpar_retencao() to service_role;
