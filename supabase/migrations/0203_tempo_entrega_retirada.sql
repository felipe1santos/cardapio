-- 0203 — Tempo de entrega e de retirada no Perfil da loja (19/10/2026, auditoria do atendimento da Ponto 400).
-- Robô e Agente de IA leem daqui; vazio → cai no tempo do robô (whatsapp_robo_config.auto_tempo_entrega, legado) →
-- média real do sistema (pedidos entregues, lib/tempo-entrega.ts) → atendente. Aditiva: nada muda sem preencher.
alter table public.restaurantes add column if not exists tempo_entrega text;
alter table public.restaurantes add column if not exists tempo_retirada text;
alter table public.restaurantes drop constraint if exists restaurantes_tempo_entrega_check;
alter table public.restaurantes add constraint restaurantes_tempo_entrega_check
  check (tempo_entrega is null or char_length(tempo_entrega) <= 60);
alter table public.restaurantes drop constraint if exists restaurantes_tempo_retirada_check;
alter table public.restaurantes add constraint restaurantes_tempo_retirada_check
  check (tempo_retirada is null or char_length(tempo_retirada) <= 60);
