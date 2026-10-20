-- 0210 — Atendimento: loja assumiu e sumiu (20/10/2026, Etapa 4 do modo autônomo).
-- Quando um humano responde (painel ou celular) e depois fica `auto_voltar_min` minutos sem responder a uma mensagem do
-- cliente, o robô/IA volta a atender sozinho (com pedido de desculpas), pelo cron da fila do WhatsApp.
-- Configurável em Ajustes › Robô de atendimento (padrão 5 min; 1 a 60).
alter table public.whatsapp_robo_config add column if not exists auto_voltar_min integer not null default 5;
alter table public.whatsapp_robo_config drop constraint if exists whatsapp_robo_config_auto_voltar_min_check;
alter table public.whatsapp_robo_config add constraint whatsapp_robo_config_auto_voltar_min_check
  check (auto_voltar_min between 1 and 60);
