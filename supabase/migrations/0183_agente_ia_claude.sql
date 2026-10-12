-- 0183 — Agente de IA (Claude) no WhatsApp, modo híbrido com o robô (11/10/2026, ordem do dono).
--  (1) Conversa em "modo IA": ia_desde (entrou), ia_respostas (teto 25), ia_carrinho (pedido em montagem),
--      ia_resumo_em (quando o resumo com total foi mostrado — criar_pedido só vale com confirmação DEPOIS dele),
--      ia_pedido_id/ia_pedido_em (último pedido criado pela IA; link na central).
--      Silenciar a conversa (atendente assumiu, cliente pediu atendente, loja respondeu) tira do modo IA (gatilho).
--  (2) Loja: whatsapp_robo_config.ia_ativo (interruptor do Agente, padrão DESLIGADO) e ia_teto_usd_dia (teto por
--      loja, editável no Super Admin; nulo = padrão LIMITE_IA_USD_DIA_LOJA, US$ 0,50).
--  (3) Origens novas: mensagem/envio 'ia' (etiqueta "IA" na central) e pedido origem_canal 'whatsapp_ia'.
--  (4) Robô sem IA: estado 'pedir_link' (mandou o link a quem quer pedir pela conversa; se insistir, oferece atendente).
-- Rollback: docs/rollback/0183_agente_ia_claude.down.sql.

alter table public.whatsapp_conversas
  add column if not exists ia_desde timestamptz,
  add column if not exists ia_respostas integer not null default 0,
  add column if not exists ia_carrinho jsonb,
  add column if not exists ia_resumo_em timestamptz,
  add column if not exists ia_pedido_id uuid references public.pedidos(id) on delete set null,
  add column if not exists ia_pedido_em timestamptz;

alter table public.whatsapp_robo_config
  add column if not exists ia_ativo boolean not null default false,
  add column if not exists ia_teto_usd_dia numeric(6,2) check (ia_teto_usd_dia is null or (ia_teto_usd_dia >= 0 and ia_teto_usd_dia <= 50));

alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_auto_estado_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_auto_estado_check
  check (auto_estado is null or auto_estado in ('aguardando_bairro', 'aguardando_numero', 'pedir_link'));

alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_origem_check;
alter table public.whatsapp_mensagens add constraint whatsapp_mensagens_origem_check
  check (origem in ('cliente', 'atendente', 'robo', 'automatico', 'disparo', 'loja', 'ia'));

alter table public.whatsapp_envios drop constraint if exists whatsapp_envios_tipo_check;
alter table public.whatsapp_envios add constraint whatsapp_envios_tipo_check
  check (tipo in ('robo', 'aviso_pedido', 'descadastro', 'ia'));

alter table public.pedidos drop constraint if exists pedidos_origem_canal_check;
alter table public.pedidos add constraint pedidos_origem_canal_check
  check (origem_canal is null or origem_canal in ('direto', 'instagram', 'facebook', 'meta', 'google_anuncio', 'google_busca', 'whatsapp', 'qrcode', 'outros', 'whatsapp_ia'));

-- Eventos da IA (falha com o motivo, pedido criado) no registro da conversa.
alter table public.whatsapp_eventos drop constraint if exists whatsapp_eventos_tipo_check;
alter table public.whatsapp_eventos add constraint whatsapp_eventos_tipo_check
  check (tipo in ('webhook', 'atendente', 'loja_assumiu', 'retorno_robo', 'painel_devolveu', 'painel_pausou', 'protecao_loop', 'ia_falha', 'ia_pedido'));


-- Silenciou (qualquer motivo) → sai do modo IA. O robô e a IA só voltam pelo fluxo normal.
create or replace function public.whatsapp_conversa_sai_do_modo_ia()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado = 'silenciada' and old.estado is distinct from 'silenciada' then
    new.ia_desde := null;
    new.ia_carrinho := null;
    new.ia_resumo_em := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_whatsapp_conversa_sai_do_modo_ia on public.whatsapp_conversas;
create trigger trg_whatsapp_conversa_sai_do_modo_ia before update of estado on public.whatsapp_conversas
  for each row execute function public.whatsapp_conversa_sai_do_modo_ia();

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
  if p_estado is not null and p_estado not in ('aguardando_bairro', 'aguardando_numero', 'pedir_link') then raise exception 'estado_invalido'; end if;
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
      auto_estado = null, auto_nao_entendeu = 0, ia_desde = null, ia_respostas = 0, ia_carrinho = null, ia_resumo_em = null
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

CREATE OR REPLACE FUNCTION public.whatsapp_registrar_saida(p_restaurante uuid, p_telefone text, p_texto text, p_texto_hash text, p_origem text, p_tipo text DEFAULT 'texto'::text, p_midia_url text DEFAULT NULL::text, p_autor_id uuid DEFAULT NULL::uuid, p_autor_nome text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c record;
  v_msg uuid;
  v_agora timestamptz := now();
  v_tel text;
begin
  if p_origem not in ('atendente', 'robo', 'automatico', 'disparo', 'ia') then raise exception 'origem_invalida'; end if;
  if p_telefone !~ '^[0-9]{10,15}$' then raise exception 'telefone_invalido'; end if;
  v_tel := public.whatsapp_telefone_conversa(p_restaurante, p_telefone);
  insert into public.whatsapp_conversas (restaurante_id, telefone) values (p_restaurante, v_tel)
  on conflict (restaurante_id, telefone) do nothing;
  select * into c from public.whatsapp_conversas where restaurante_id = p_restaurante and telefone = v_tel for update;

  insert into public.whatsapp_mensagens (restaurante_id, conversa_id, wa_id, direcao, origem, tipo, texto, texto_hash, midia_url,
                                         autor_id, autor_nome, status_envio, enviada_em)
  values (p_restaurante, c.id, 'local:' || gen_random_uuid()::text, 'loja', p_origem, coalesce(p_tipo, 'texto'), left(p_texto, 4000),
          p_texto_hash, p_midia_url, p_autor_id, left(p_autor_nome, 120), 'enviando', v_agora)
  returning id into v_msg;

  update public.whatsapp_conversas set
    ultima_previa = left(coalesce(nullif(btrim(p_texto), ''), case when p_tipo = 'imagem' then '📷 Foto' else 'Mensagem' end), 160),
    ultima_origem = p_origem,
    ultima_atividade_em = v_agora
  where id = c.id;

  if p_origem = 'atendente' then
    -- Quem responde assume: o robô para nesta conversa.
    update public.whatsapp_conversas set
      estado = 'silenciada',
      silenciada_em = v_agora,
      silenciada_motivo = coalesce(case when estado = 'silenciada' then silenciada_motivo end, 'painel'),
      atendimento = 'humano',
      atendente_id = coalesce(atendente_id, p_autor_id),
      atendente_nome = coalesce(atendente_nome, left(p_autor_nome, 120)),
      assumida_em = coalesce(assumida_em, v_agora),
      nao_lidas = 0,
      ultima_mensagem_em = v_agora
    where id = c.id;
  end if;
  return jsonb_build_object('mensagem_id', v_msg, 'conversa_id', c.id);
end $function$
;
