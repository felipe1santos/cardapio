-- 0182 — Robô único + "cliente pedindo atendente" na central (11/10/2026, ordem do dono).
--  (1) whatsapp_conversas.pediu_atendente_em: o robô transferiu para atendente (cliente pediu, reclamou ou não foi
--      entendido 2×). A central destaca em amarelo e põe no topo até a loja marcar "Resolvido".
--  (2) whatsapp_atendimento_resolver: "Resolvido" → devolve ao robô OU continua atendendo (humano); limpa o destaque.
--  (3) Robô de atendimento (autoatendimento) LIGADO por padrão em loja nova; lojas sem WhatsApp conectado ficam ligadas
--      (sem efeito até conectar). As com o robô antigo ligado são passadas UMA A UMA (fora desta migração).
-- Rollback: docs/rollback/0182_robo_unico.down.sql.

alter table public.whatsapp_conversas add column if not exists pediu_atendente_em timestamptz;
create index if not exists idx_wa_conversas_pediu_atendente on public.whatsapp_conversas (restaurante_id) where pediu_atendente_em is not null;

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
end $$;

create or replace function public.whatsapp_atendimento_resolver(
  p_restaurante uuid, p_conversa uuid, p_devolver boolean, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from public.whatsapp_conversas where id = p_conversa and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'conversa_inexistente'; end if;
  if p_devolver then
    update public.whatsapp_conversas set pediu_atendente_em = null, estado = 'robo', silenciada_em = null, silenciada_motivo = null,
      atendimento = 'robo', atendente_id = null, atendente_nome = null, assumida_em = null, nao_lidas = 0,
      auto_estado = null, auto_nao_entendeu = 0
    where id = c.id;
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, c.id, 'painel_devolveu', jsonb_build_object('acao', 'resolvido_devolver', 'ator', left(coalesce(p_ator_nome, ''), 80)));
  else
    update public.whatsapp_conversas set pediu_atendente_em = null, estado = 'silenciada', silenciada_em = now(), silenciada_motivo = 'painel',
      atendimento = 'humano', atendente_id = p_ator, atendente_nome = left(p_ator_nome, 80), assumida_em = coalesce(assumida_em, now()), nao_lidas = 0
    where id = c.id;
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, c.id, 'painel_pausou', jsonb_build_object('acao', 'resolvido_continuar', 'ator', left(coalesce(p_ator_nome, ''), 80)));
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.whatsapp_atendimento_resolver(uuid, uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_atendimento_resolver(uuid, uuid, boolean, uuid, text) to service_role;

-- Robô único: ligado por padrão em loja nova.
alter table public.whatsapp_robo_config alter column autoatendimento_ativo set default true;
-- Lojas SEM WhatsApp conectado: ligado (sem efeito até conectar). Quem tem WhatsApp e o robô antigo desligado fica como está.
update public.whatsapp_robo_config w set autoatendimento_ativo = true, atualizado_em = now(), atualizado_por_nome = 'Migração 0182 (robô único)'
  from public.restaurantes r
 where r.id = w.restaurante_id and r.evolution_instance is null and w.autoatendimento_ativo = false;

-- Quem já está esperando atendente (pedido ao robô nas últimas 12 h, igual à faixa antiga do Kanban) entra destacado.
update public.whatsapp_conversas set pediu_atendente_em = silenciada_em
 where pediu_atendente_em is null and estado = 'silenciada' and silenciada_motivo = 'cliente' and atendimento = 'aguardando'
   and silenciada_em > now() - interval '12 hours';
