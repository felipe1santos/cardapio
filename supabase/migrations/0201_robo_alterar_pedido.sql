-- 0201 — Robô simples: estado "alterar_pedido:<pedido>" (18/10/2026). O cliente escolheu "Alterar ou cancelar meu
-- pedido" e o robô espera a mensagem seguinte com o que mudar. Só a lista de estados aceitos muda (0193 + um padrão).
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_auto_estado_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_auto_estado_check
  check (auto_estado is null or auto_estado in ('aguardando_bairro', 'aguardando_numero', 'pedir_link', 'escolher_categoria')
    or auto_estado ~ '^escolher_item:[0-9]{1,3}$' or auto_estado ~ '^alterar_pedido:[0-9a-f-]{36}$');

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
  if p_estado is not null and p_estado not in ('aguardando_bairro', 'aguardando_numero', 'pedir_link', 'escolher_categoria')
     and p_estado !~ '^escolher_item:[0-9]{1,3}$' and p_estado !~ '^alterar_pedido:[0-9a-f-]{36}$' then raise exception 'estado_invalido'; end if;
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
