-- Rollback da 0129. As mensagens automáticas voltam ao padrão (o código antigo não lê a
-- coluna). Modelos de mensagem criados pelas lojas se perdem: exporte antes se precisar.
drop function if exists public.campanhas_ultimo_envio();
drop function if exists public.campanhas_visao_geral(timestamptz, timestamptz);
drop table if exists public.campanha_modelos;
alter table public.restaurantes drop constraint if exists restaurantes_mensagens_status_check;
alter table public.restaurantes drop column if exists mensagens_status;
