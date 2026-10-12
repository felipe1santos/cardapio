-- 0193 — Robô e IA (12/10/2026): cardápio por categorias pelo robô (sem IA) e "Peça também" uma vez por pedido.
-- Aditiva: só aceita dois estados novos na conversa e guarda quando a sugestão foi oferecida.
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_auto_estado_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_auto_estado_check
  check (auto_estado is null or auto_estado in ('aguardando_bairro', 'aguardando_numero', 'pedir_link', 'escolher_categoria') or auto_estado ~ '^escolher_item:[0-9]{1,3}$');
alter table public.whatsapp_conversas add column if not exists ia_bump_em timestamptz;

-- A função que grava o estado do robô também conhece os estados novos (só a checagem de p_estado mudou).
CREATE OR REPLACE FUNCTION public.whatsapp_auto_aplicar_v2(p_restaurante uuid, p_conversa uuid, p_mensagem uuid, p_acao text, p_estado text, p_estado_em timestamp with time zone, p_nao_entendeu integer, p_saudacao_em timestamp with time zone, p_silenciar text, p_audio_em timestamp with time zone, p_versao integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agora timestamptz := now();
  v_n integer;
begin
  if p_estado is not null and p_estado not in ('aguardando_bairro', 'aguardando_numero', 'pedir_link', 'escolher_categoria') and p_estado !~ '^escolher_item:[0-9]{1,3}$' then raise exception 'estado_invalido'; end if;
  if p_silenciar is not null and p_silenciar not in ('atendente', 'parar') then raise exception 'silenciar_invalido'; end if;
  update public.whatsapp_conversas set
    auto_versao = auto_versao + 1,
    auto_estado = p_estado,
    auto_estado_em = p_estado_em,
    auto_nao_entendeu = greatest(0, least(coalesce(p_nao_entendeu, 0), 10)),
    auto_saudacao_em = p_saudacao_em,
    auto_audio_em = p_audio_em,
    boas_vindas_em = coalesce(p_saudacao_em, boas_vindas_em),
    estado = case when p_silenciar is not null then 'silenciada' else estado end,
    silenciada_em = case when p_silenciar is not null then v_agora else silenciada_em end,
    silenciada_motivo = case p_silenciar when 'atendente' then 'cliente' when 'parar' then 'parar' else silenciada_motivo end,
    atendimento = case p_silenciar when 'atendente' then 'aguardando' when 'parar' then 'encerrada' else atendimento end,
    pediu_atendente_em = case when p_silenciar = 'atendente' then v_agora else pediu_atendente_em end
  where id = p_conversa and restaurante_id = p_restaurante and auto_versao = p_versao;
  get diagnostics v_n = row_count;
  -- Outra mensagem da mesma conversa decidiu antes (ex.: foto do mesmo álbum): esta não responde.
  if v_n = 0 then return false; end if;
  if p_silenciar = 'atendente' then
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, p_conversa, 'atendente', jsonb_build_object('modo', 'autoatendimento', 'acao', p_acao));
  end if;
  if p_mensagem is not null and p_acao is not null and p_acao <> 'nada' then
    update public.whatsapp_mensagens set acao_robo = left(p_acao, 40) where id = p_mensagem and restaurante_id = p_restaurante;
  end if;
  return true;
end $function$;
