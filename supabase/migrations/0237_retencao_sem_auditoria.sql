-- 0237 — Retenção sem tocar na auditoria encadeada (01/11/2026, auditoria de infraestrutura, Fase 2).
-- A 0231 apagava `whatsapp.conexao` de eventos_auditoria com mais de 30 dias. Mas toda linha dessa tabela é encadeada
-- por hash (0134) e `auditoria_verificar_cadeia` acusa "registro removido" no primeiro buraco: a partir de 25/11 a
-- limpeza apagaria as ~70 mil linhas da PONTO 400 (27/10) e a tela Auditoria do Financeiro acusaria adulteração.
-- Agora a auditoria fica inteira para sempre; os eventos de conexão novos vão para whatsapp_eventos
-- (lib/whatsapp-monitor.ts), que já tem 90 dias de retenção aqui. As outras 6 tabelas seguem iguais à 0231.
-- Rollback: reaplicar a 0231.

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
  return r;
end $$;
revoke all on function public.sistema_limpar_retencao() from public, anon, authenticated;
grant execute on function public.sistema_limpar_retencao() to service_role;
