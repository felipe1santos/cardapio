-- Rollback da 0104 (campanhas: disparo confiável e métricas).
--
-- ANTES: voltar o código para o commit anterior (o cron de campanhas novo chama
-- campanha_reservar_envios; sem a função ele só falha, não envia nada).
--
-- Não "descancela" as campanhas encerradas pela 0104: reabri-las faria o cron antigo
-- tentar enviá-las. Os envios com status novo (incerto/cancelado/expirado) viram 'erro'
-- para caber no conjunto antigo de status — nenhum deles volta a 'pendente'.

begin;

drop function if exists public.campanha_destinatarios(uuid);
drop function if exists public.campanhas_metricas(timestamptz, timestamptz, uuid);
drop function if exists public.campanha_atribuicoes(uuid, timestamptz, timestamptz);
drop function if exists public.campanha_registrar_clique(text);
drop function if exists public.campanha_registrar_status(uuid, text, text, timestamptz);
drop function if exists public.campanha_concluir_envio(uuid, text, text, text);
drop function if exists public.campanha_reservar_envios(integer);

alter table public.campanha_envios drop constraint if exists campanha_envios_status_check;
update public.campanha_envios set status = 'erro', erro = coalesce(erro, 'status ' || status)
 where status in ('incerto', 'cancelado', 'expirado');

drop trigger if exists campanha_envios_chave_destino on public.campanha_envios;
drop function if exists public.campanha_envios_chave_destino();
drop index if exists public.campanha_envios_destino_uidx;
drop index if exists public.campanha_envios_token_uidx;
drop index if exists public.campanha_envios_externo_idx;
drop index if exists public.campanha_envios_enviado_idx;

alter table public.campanha_envios
  drop column if exists token,
  drop column if exists chave_destino,
  drop column if exists tentativas,
  drop column if exists proxima_tentativa_em,
  drop column if exists travado_ate,
  drop column if exists id_externo,
  drop column if exists entregue_em,
  drop column if exists lido_em,
  drop column if exists cliques,
  drop column if exists clicado_em,
  drop column if exists ultimo_clique_em;

alter table public.campanhas
  drop column if exists incluir_link,
  drop column if exists duplicados_bloqueados;

drop function if exists public.telefone_chave(text);

commit;
