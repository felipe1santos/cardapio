-- 0209 — Monitor do WhatsApp (20/10/2026, Etapa 3 do modo autônomo): estado da conexão por loja, para alertar só quando
-- a conexão CAI SOZINHA (desconectar pelo painel marca whatsapp_desconexao_manual_em e não alerta).
-- restaurantes tem grant POR COLUNA para authenticated (0080): sem o grant abaixo o painel inteiro abre vazio (incidente 19/10).
alter table public.restaurantes add column if not exists whatsapp_estado text;
alter table public.restaurantes add column if not exists whatsapp_estado_em timestamptz;
alter table public.restaurantes add column if not exists whatsapp_caiu_em timestamptz;
alter table public.restaurantes add column if not exists whatsapp_alertado_em timestamptz;
alter table public.restaurantes add column if not exists whatsapp_desconexao_manual_em timestamptz;
alter table public.restaurantes drop constraint if exists restaurantes_whatsapp_estado_check;
alter table public.restaurantes add constraint restaurantes_whatsapp_estado_check
  check (whatsapp_estado is null or whatsapp_estado in ('open', 'connecting', 'close', 'sem_instancia'));
grant select (whatsapp_estado, whatsapp_estado_em, whatsapp_caiu_em, whatsapp_alertado_em, whatsapp_desconexao_manual_em) on public.restaurantes to authenticated;
