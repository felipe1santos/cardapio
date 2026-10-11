-- Rollback da 0182 (robô único + pedindo atendente). Volta as 3 lojas sem WhatsApp ligadas pela migração e
-- recoloca a whatsapp_auto_aplicar_v2 da 0181.
alter table public.whatsapp_robo_config alter column autoatendimento_ativo set default false;
update public.whatsapp_robo_config set autoatendimento_ativo = false where atualizado_por_nome = 'Migração 0182 (robô único)';
drop function if exists public.whatsapp_atendimento_resolver(uuid, uuid, boolean, uuid, text);
create or replace function public.whatsapp_auto_aplicar_v2(
  p_restaurante uuid, p_conversa uuid, p_mensagem uuid, p_acao text,
  p_estado text, p_estado_em timestamptz, p_nao_entendeu integer, p_saudacao_em timestamptz, p_silenciar text,
  p_audio_em timestamptz, p_versao integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agora timestamptz := now();
  v_n integer;
begin
  if p_estado is not null and p_estado not in ('aguardando_bairro', 'aguardando_numero') then raise exception 'estado_invalido'; end if;
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
    atendimento = case p_silenciar when 'atendente' then 'aguardando' when 'parar' then 'encerrada' else atendimento end
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
end $$;
drop index if exists public.idx_wa_conversas_pediu_atendente;
alter table public.whatsapp_conversas drop column if exists pediu_atendente_em;
