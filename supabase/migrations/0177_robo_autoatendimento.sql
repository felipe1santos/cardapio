-- 0177 — Robô de autoatendimento por palavras-chave (10/10/2026). Decisões em docs/robo-whatsapp/autoatendimento-decisoes.md.
--
-- Interruptor próprio por loja (autoatendimento_ativo, padrão DESLIGADO). Com ele ligado, o webhook usa
-- whatsapp_auto_entrada/whatsapp_auto_aplicar (abaixo). Desligado, nada muda: o robô v1
-- (whatsapp_registrar_entrada, 0116) continua igual — esta migração não toca nele.
-- Ligado só na Menuzia no fim do arquivo.

alter table public.whatsapp_robo_config
  add column if not exists autoatendimento_ativo boolean not null default false,
  add column if not exists auto_assuntos_desligados text[] not null default '{}',
  add column if not exists auto_textos jsonb not null default '{}'::jsonb,
  add column if not exists auto_palavras jsonb not null default '{}'::jsonb,
  add column if not exists auto_tempo_entrega text,
  add column if not exists auto_limite_loja_min integer not null default 60,
  -- Chave Pix que o robô manda (servidor só: esta tabela não tem policy para o navegador).
  add column if not exists pix_chave text,
  add column if not exists pix_chave_tipo text;

alter table public.whatsapp_robo_config drop constraint if exists whatsapp_robo_config_auto_tempo_check;
alter table public.whatsapp_robo_config add constraint whatsapp_robo_config_auto_tempo_check check (auto_tempo_entrega is null or char_length(auto_tempo_entrega) <= 60);
alter table public.whatsapp_robo_config drop constraint if exists whatsapp_robo_config_auto_limite_check;
alter table public.whatsapp_robo_config add constraint whatsapp_robo_config_auto_limite_check check (auto_limite_loja_min between 5 and 600);
alter table public.whatsapp_robo_config drop constraint if exists whatsapp_robo_config_pix_check;
alter table public.whatsapp_robo_config add constraint whatsapp_robo_config_pix_check check (
  (pix_chave is null or char_length(pix_chave) between 1 and 140)
  and (pix_chave_tipo is null or pix_chave_tipo in ('cpf', 'cnpj', 'telefone', 'email', 'aleatoria')));

alter table public.whatsapp_conversas
  add column if not exists auto_estado text,
  add column if not exists auto_estado_em timestamptz,
  add column if not exists auto_nao_entendeu integer not null default 0,
  add column if not exists auto_saudacao_em timestamptz;
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_auto_estado_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_auto_estado_check
  check (auto_estado is null or auto_estado in ('aguardando_bairro', 'aguardando_numero'));

-- "parar": o cliente pediu para o robô não responder mais (só volta com "voltar" ou pelo painel).
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_silenciada_motivo_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_silenciada_motivo_check
  check (silenciada_motivo in ('cliente', 'loja', 'painel', 'protecao', 'parar'));

-- Intenção detectada em cada mensagem do cliente no modo novo.
alter table public.whatsapp_mensagens add column if not exists intencao_robo text;

-- Perguntas que o robô não entendeu (30 dias), para o dono "ensinar".
create table if not exists public.whatsapp_auto_nao_entendidas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 300),
  exemplo text check (exemplo is null or char_length(exemplo) <= 300),
  vezes integer not null default 1,
  primeira_em timestamptz not null default now(),
  ultima_em timestamptz not null default now(),
  ensinado_assunto text,
  unique (restaurante_id, texto)
);
alter table public.whatsapp_auto_nao_entendidas enable row level security;
revoke all on public.whatsapp_auto_nao_entendidas from anon, authenticated;
create index if not exists idx_wa_auto_nao_entendidas_loja on public.whatsapp_auto_nao_entendidas (restaurante_id, ultima_em desc);

-- Entrada no modo novo: grava a mensagem e faz o que exige trava (reentrega, loja assumiu, silêncio, proteções).
-- A decisão do que responder é do aplicativo (lib/robo-auto), que depois chama whatsapp_auto_aplicar.
create or replace function public.whatsapp_auto_entrada(
  p_restaurante uuid, p_telefone text, p_wa_id text, p_de_mim boolean,
  p_tipo text, p_texto text, p_instante timestamptz, p_intencao text, p_nome text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  d record;
  v_msg uuid;
  v_agora timestamptz := now();
  v_lim_curto integer;
  v_lim_longo integer;
  v_lim_loja integer;
  v_resp_curto integer;
  v_resp_longo integer;
  v_resp_min integer;
  v_resp_loja integer;
  v_iguais integer;
  v_previa text;
  v_tel text;
  v_reativada boolean := false;
begin
  select coalesce(max(protecao_curta), 8), coalesce(max(protecao_longa), 20), coalesce(max(auto_limite_loja_min), 60)
    into v_lim_curto, v_lim_longo, v_lim_loja
    from public.whatsapp_robo_config where restaurante_id = p_restaurante;

  v_tel := public.whatsapp_telefone_conversa(p_restaurante, p_telefone);
  insert into public.whatsapp_conversas (restaurante_id, telefone) values (p_restaurante, v_tel)
  on conflict (restaurante_id, telefone) do nothing;
  select * into c from public.whatsapp_conversas
   where restaurante_id = p_restaurante and telefone = v_tel for update;

  insert into public.whatsapp_mensagens (restaurante_id, conversa_id, wa_id, direcao, origem, tipo, texto, enviada_em, intencao_robo)
  values (p_restaurante, c.id, p_wa_id, case when p_de_mim then 'loja' else 'entrada' end,
          case when p_de_mim then 'loja' else 'cliente' end, p_tipo, left(p_texto, 4000), p_instante,
          case when p_de_mim then null else left(p_intencao, 40) end)
  on conflict (restaurante_id, wa_id) do nothing
  returning id into v_msg;
  if v_msg is null then
    select m.id, m.criado_em, m.direcao into d
      from public.whatsapp_mensagens m where m.restaurante_id = p_restaurante and m.wa_id = p_wa_id;
    if d.id is not null and d.direcao = 'entrada' and d.criado_em > v_agora - interval '10 minutes'
       and not exists (select 1 from public.whatsapp_envios e where e.origem_mensagem_id = d.id) then
      return jsonb_build_object('duplicada', true, 'sem_envio', true, 'conversa_id', c.id, 'mensagem_id', d.id, 'acao', 'decidir',
        'auto_estado', c.auto_estado, 'auto_estado_em', c.auto_estado_em, 'auto_nao_entendeu', c.auto_nao_entendeu,
        'auto_saudacao_em', c.auto_saudacao_em, 'nome', c.nome_contato);
    end if;
    return jsonb_build_object('duplicada', true, 'conversa_id', c.id, 'acao', 'nada');
  end if;

  v_previa := left(coalesce(nullif(btrim(p_texto), ''), case p_tipo when 'imagem' then '📷 Foto' when 'audio' then '🎤 Áudio'
    when 'video' then '🎬 Vídeo' when 'figurinha' then 'Figurinha' when 'localizacao' then '📍 Localização'
    when 'documento' then '📄 Documento' when 'contato' then '👤 Contato' else 'Mensagem' end), 160);
  update public.whatsapp_conversas set
    ultima_previa = v_previa,
    ultima_origem = case when p_de_mim then 'loja' else 'cliente' end,
    ultima_atividade_em = v_agora,
    nao_lidas = case when p_de_mim then 0 else nao_lidas + 1 end,
    nome_contato = case when p_nome is not null and btrim(p_nome) <> '' and not p_de_mim then left(btrim(p_nome), 80) else nome_contato end
  where id = c.id;

  -- Volta ao robô: 1 h sem mensagens depois de atendente/loja/painel/proteção; "parar" só volta com "voltar".
  if c.estado = 'silenciada' and (
       (coalesce(c.silenciada_motivo, 'cliente') <> 'parar' and greatest(c.ultima_mensagem_em, c.silenciada_em) < v_agora - interval '1 hour')
       or (c.silenciada_motivo = 'parar' and p_intencao = 'voltar' and not p_de_mim)) then
    v_reativada := c.silenciada_motivo = 'parar';
    c.estado := 'robo';
    update public.whatsapp_conversas set estado = 'robo', silenciada_em = null, silenciada_motivo = null, atendimento = 'robo',
      atendente_id = null, atendente_nome = null, assumida_em = null, auto_estado = null, auto_nao_entendeu = 0 where id = c.id;
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, c.id, 'retorno_robo', jsonb_build_object('motivo_anterior', c.silenciada_motivo, 'modo', 'autoatendimento'));
  end if;

  if p_de_mim then
    -- Dono/funcionário respondeu à mão: o robô sai da conversa (volta após 1 h sem mensagens).
    if c.estado <> 'silenciada' then
      insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo) values (p_restaurante, c.id, 'loja_assumiu');
    end if;
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = v_agora, silenciada_motivo = 'loja',
      ultima_mensagem_em = v_agora, atendimento = 'humano' where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada');
  end if;

  if c.estado = 'silenciada' then
    update public.whatsapp_conversas set ultima_mensagem_em = v_agora,
      atendimento = case when silenciada_motivo = 'parar' then atendimento
                         when atendimento in ('robo', 'encerrada') then 'aguardando' else atendimento end
    where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada', 'silenciada', true);
  end if;

  -- Proteções: loop (0105), 5 respostas/min na conversa, limite por loja, mesma mensagem 3× seguidas.
  select count(*) filter (where e.criado_em > v_agora - interval '2 minutes'),
         count(*),
         count(*) filter (where e.criado_em > v_agora - interval '1 minute')
    into v_resp_curto, v_resp_longo, v_resp_min
    from public.whatsapp_envios e
   where e.conversa_id = c.id and e.tipo = 'robo' and e.criado_em > v_agora - interval '20 minutes';
  select count(*) into v_iguais from (
    select m.texto from public.whatsapp_mensagens m
     where m.conversa_id = c.id and m.direcao = 'entrada' and m.criado_em > v_agora - interval '3 minutes'
     order by m.criado_em desc limit 3) u
   where u.texto is not distinct from left(p_texto, 4000) and p_texto is not null;
  if v_resp_curto >= v_lim_curto or v_resp_longo >= v_lim_longo or v_iguais >= 3 then
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = v_agora, silenciada_motivo = 'protecao',
      ultima_mensagem_em = v_agora, atendimento = 'humano' where id = c.id;
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, c.id, 'protecao_loop', jsonb_build_object('respostas_2min', v_resp_curto, 'respostas_20min', v_resp_longo,
      'mesma_mensagem', v_iguais >= 3, 'modo', 'autoatendimento'));
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada', 'protecao', true);
  end if;
  select count(*) into v_resp_loja from public.whatsapp_envios e
   where e.restaurante_id = p_restaurante and e.tipo = 'robo' and e.criado_em > v_agora - interval '1 minute';
  if v_resp_min >= 5 or v_resp_loja >= v_lim_loja then
    update public.whatsapp_conversas set ultima_mensagem_em = v_agora where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada', 'limite', true);
  end if;

  update public.whatsapp_conversas set ultima_mensagem_em = v_agora where id = c.id;
  return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'decidir', 'reativada', v_reativada,
    'auto_estado', c.auto_estado, 'auto_estado_em', c.auto_estado_em, 'auto_nao_entendeu', c.auto_nao_entendeu,
    'auto_saudacao_em', c.auto_saudacao_em, 'nome', coalesce(nullif(btrim(p_nome), ''), c.nome_contato));
end $$;

-- Grava o que o aplicativo decidiu: estado da conversa, ação na mensagem e silêncio (atendente/parar).
create or replace function public.whatsapp_auto_aplicar(
  p_restaurante uuid, p_conversa uuid, p_mensagem uuid, p_acao text,
  p_estado text, p_estado_em timestamptz, p_nao_entendeu integer, p_saudacao_em timestamptz, p_silenciar text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agora timestamptz := now();
begin
  if p_estado is not null and p_estado not in ('aguardando_bairro', 'aguardando_numero') then raise exception 'estado_invalido'; end if;
  if p_silenciar is not null and p_silenciar not in ('atendente', 'parar') then raise exception 'silenciar_invalido'; end if;
  update public.whatsapp_conversas set
    auto_estado = p_estado,
    auto_estado_em = p_estado_em,
    auto_nao_entendeu = greatest(0, least(coalesce(p_nao_entendeu, 0), 10)),
    auto_saudacao_em = p_saudacao_em,
    boas_vindas_em = coalesce(p_saudacao_em, boas_vindas_em),
    estado = case when p_silenciar is not null then 'silenciada' else estado end,
    silenciada_em = case when p_silenciar is not null then v_agora else silenciada_em end,
    silenciada_motivo = case p_silenciar when 'atendente' then 'cliente' when 'parar' then 'parar' else silenciada_motivo end,
    atendimento = case p_silenciar when 'atendente' then 'aguardando' when 'parar' then 'encerrada' else atendimento end
  where id = p_conversa and restaurante_id = p_restaurante;
  if p_silenciar = 'atendente' then
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, p_conversa, 'atendente', jsonb_build_object('modo', 'autoatendimento', 'acao', p_acao));
  end if;
  if p_mensagem is not null and p_acao is not null and p_acao <> 'nada' then
    update public.whatsapp_mensagens set acao_robo = left(p_acao, 40) where id = p_mensagem and restaurante_id = p_restaurante;
  end if;
end $$;

revoke all on function public.whatsapp_auto_entrada(uuid, text, text, boolean, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_auto_aplicar(uuid, uuid, uuid, text, text, timestamptz, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.whatsapp_auto_entrada(uuid, text, text, boolean, text, text, timestamptz, text, text) to service_role;
grant execute on function public.whatsapp_auto_aplicar(uuid, uuid, uuid, text, text, timestamptz, integer, timestamptz, text) to service_role;

-- Liberação (ordem do dono, 10/10): ligado só na Menuzia. As outras lojas ficam com o padrão (desligado).
update public.whatsapp_robo_config set autoatendimento_ativo = true
 where restaurante_id = (select id from public.restaurantes where slug = 'menuzia');
