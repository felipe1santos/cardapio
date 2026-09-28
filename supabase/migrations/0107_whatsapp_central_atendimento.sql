-- 0107 — Central de atendimento do WhatsApp no painel (fase 2).
--
-- Aditiva. Plano: docs/robo-whatsapp/central-atendimento.md.
--   1. whatsapp_conversas: estado de atendimento (robo | aguardando | humano | encerrada),
--      atendente, não lidas e a última atividade (prévia, origem, hora).
--   2. whatsapp_mensagens: origem (cliente | atendente | robo | automatico | disparo | loja),
--      autor, status do envio, mídia e hash do texto (reconhecer o eco do que a Menuzia
--      mandou). Texto até 4000.
--   3. Tags por cliente (nome + cor), várias por conversa.
--   4. Funções: registrar_entrada (com o robô desligado a mensagem é gravada e a conversa
--      entra como atendimento humano), registrar_saida / concluir_saida, atendimento_acao,
--      alterar_conversa (mantém o atendimento em dia) e a retenção.
--   5. Realtime para conversas e mensagens (RLS: dono e gerente da própria loja).
--
-- Rollback: docs/rollback/0107_whatsapp_central_atendimento.down.sql

-- ─── 1. conversas ─────────────────────────────────────────────────────────────
alter table public.whatsapp_conversas
  add column if not exists atendimento text not null default 'robo',
  add column if not exists atendente_id uuid,
  add column if not exists atendente_nome text,
  add column if not exists assumida_em timestamptz,
  add column if not exists nao_lidas integer not null default 0,
  add column if not exists ultima_previa text,
  add column if not exists ultima_origem text,
  add column if not exists ultima_atividade_em timestamptz;

alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_atendimento_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_atendimento_check
  check (atendimento in ('robo', 'aguardando', 'humano', 'encerrada'));
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_atendente_nome_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_atendente_nome_check
  check (atendente_nome is null or char_length(atendente_nome) <= 120);
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_previa_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_previa_check
  check (ultima_previa is null or char_length(ultima_previa) <= 160);
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_nao_lidas_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_nao_lidas_check check (nao_lidas >= 0);

-- Conversas que já existiam: silenciada pelo cliente = aguardando; outras silenciadas =
-- humano; o resto (e as que já voltariam ao robô) = robo.
update public.whatsapp_conversas c set
  atendimento = case
    when c.estado = 'silenciada'
     and greatest(c.ultima_mensagem_em, c.silenciada_em) >= now() - make_interval(mins => coalesce((select retorno_minutos from public.whatsapp_robo_config r where r.restaurante_id = c.restaurante_id), 720))
      then case when c.silenciada_motivo = 'cliente' then 'aguardando' else 'humano' end
    else 'robo' end,
  ultima_atividade_em = coalesce(c.ultima_atividade_em, c.ultima_mensagem_em, c.criado_em)
where c.ultima_atividade_em is null;

create index if not exists whatsapp_conversas_atividade_idx on public.whatsapp_conversas (restaurante_id, ultima_atividade_em desc, id);
create index if not exists whatsapp_conversas_atendimento_idx on public.whatsapp_conversas (restaurante_id, atendimento) where atendimento in ('aguardando', 'humano');

-- ─── 2. mensagens ─────────────────────────────────────────────────────────────
alter table public.whatsapp_mensagens
  add column if not exists origem text,
  add column if not exists autor_id uuid,
  add column if not exists autor_nome text,
  add column if not exists status_envio text,
  add column if not exists erro text,
  add column if not exists midia_url text,
  add column if not exists texto_hash text;

update public.whatsapp_mensagens set origem = case when direcao = 'entrada' then 'cliente' else 'loja' end where origem is null;
alter table public.whatsapp_mensagens alter column origem set default 'cliente';
alter table public.whatsapp_mensagens alter column origem set not null;

alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_origem_check;
alter table public.whatsapp_mensagens add constraint whatsapp_mensagens_origem_check
  check (origem in ('cliente', 'atendente', 'robo', 'automatico', 'disparo', 'loja'));
alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_status_envio_check;
alter table public.whatsapp_mensagens add constraint whatsapp_mensagens_status_envio_check
  check (status_envio is null or status_envio in ('enviando', 'enviado', 'falhou'));
alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_extras_check;
alter table public.whatsapp_mensagens add constraint whatsapp_mensagens_extras_check check (
  (autor_nome is null or char_length(autor_nome) <= 120)
  and (erro is null or char_length(erro) <= 300)
  and (midia_url is null or (char_length(midia_url) <= 1000 and midia_url ~ '^https://'))
  and (texto_hash is null or texto_hash ~ '^[0-9a-f]{64}$'));
-- Atendente e avisos passam de 1000 caracteres.
alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_texto_check;
alter table public.whatsapp_mensagens add constraint whatsapp_mensagens_texto_check check (texto is null or char_length(texto) <= 4000);

create index if not exists whatsapp_mensagens_conversa_idx on public.whatsapp_mensagens (conversa_id, criado_em desc, id);
create index if not exists whatsapp_mensagens_hash_idx on public.whatsapp_mensagens (conversa_id, texto_hash, criado_em) where texto_hash is not null;

-- ─── 3. tags ──────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_tags (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 30),
  cor text not null default '#0688D4' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  criado_em timestamptz not null default now()
);
create unique index if not exists whatsapp_tags_nome_unico on public.whatsapp_tags (restaurante_id, lower(btrim(nome)));

create table if not exists public.whatsapp_conversa_tags (
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  conversa_id uuid not null references public.whatsapp_conversas(id) on delete cascade,
  tag_id uuid not null references public.whatsapp_tags(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (conversa_id, tag_id)
);
create index if not exists whatsapp_conversa_tags_tag_idx on public.whatsapp_conversa_tags (restaurante_id, tag_id);

alter table public.whatsapp_tags enable row level security;
alter table public.whatsapp_conversa_tags enable row level security;
do $$
declare t text;
begin
  foreach t in array array['whatsapp_tags', 'whatsapp_conversa_tags'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_leitura_gestao', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (restaurante_id = public.auth_restaurante_id() and public.auth_papel() in ('dono', 'gerente'))$p$, t || '_leitura_gestao', t);
  end loop;
end $$;

-- ─── 4a. entrada (webhook) ────────────────────────────────────────────────────
-- Igual à 0105, mais: a mensagem sempre atualiza a última atividade e as não lidas, e com
-- o robô DESLIGADO (p_robo_ativo = false) ela é gravada e a conversa entra como
-- atendimento humano (aguardando), sem resposta do robô.
drop function if exists public.whatsapp_registrar_entrada(uuid, text, text, boolean, text, text, timestamptz, text, text);
create or replace function public.whatsapp_registrar_entrada(
  p_restaurante uuid, p_telefone text, p_wa_id text, p_de_mim boolean,
  p_tipo text, p_texto text, p_instante timestamptz, p_intencao text, p_nome text default null,
  p_robo_ativo boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_msg uuid;
  v_agora timestamptz := now();
  v_boas_vindas boolean := false;
  v_acao text := 'nada';
  v_janela interval;
  v_retorno interval;
  v_resp_curto integer;
  v_resp_longo integer;
  v_lim_curto integer;
  v_lim_longo integer;
  v_previa text;
begin
  if p_intencao not in ('menu', 'status', 'atendente', 'cardapio', 'horario', 'taxa', 'outro', 'midia') then
    raise exception 'intencao_invalida';
  end if;
  select make_interval(hours => coalesce(max(boas_vindas_horas), 12)), make_interval(mins => coalesce(max(retorno_minutos), 720)),
         coalesce(max(protecao_curta), 8), coalesce(max(protecao_longa), 20)
    into v_janela, v_retorno, v_lim_curto, v_lim_longo
    from public.whatsapp_robo_config where restaurante_id = p_restaurante;

  insert into public.whatsapp_conversas (restaurante_id, telefone) values (p_restaurante, p_telefone)
  on conflict (restaurante_id, telefone) do nothing;
  select * into c from public.whatsapp_conversas
   where restaurante_id = p_restaurante and telefone = p_telefone for update;

  insert into public.whatsapp_mensagens (restaurante_id, conversa_id, wa_id, direcao, origem, tipo, texto, enviada_em)
  values (p_restaurante, c.id, p_wa_id, case when p_de_mim then 'loja' else 'entrada' end,
          case when p_de_mim then 'loja' else 'cliente' end, p_tipo, left(p_texto, 4000), p_instante)
  on conflict (restaurante_id, wa_id) do nothing
  returning id into v_msg;
  if v_msg is null then
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

  -- Volta sozinho ao robô depois do tempo da loja sem mensagens (só com o robô ligado).
  if p_robo_ativo and c.estado = 'silenciada' and greatest(c.ultima_mensagem_em, c.silenciada_em) < v_agora - v_retorno then
    c.estado := 'robo';
    update public.whatsapp_conversas set atendimento = 'robo', atendente_id = null, atendente_nome = null, assumida_em = null where id = c.id;
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, c.id, 'retorno_robo', jsonb_build_object('motivo_anterior', c.silenciada_motivo));
  end if;

  if p_de_mim then
    -- A loja respondeu pelo celular: o robô sai da conversa e ela vira atendimento humano.
    if c.estado <> 'silenciada' then
      insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo) values (p_restaurante, c.id, 'loja_assumiu');
    end if;
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = v_agora, silenciada_motivo = 'loja',
      ultima_mensagem_em = v_agora, atendimento = 'humano' where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada');
  end if;

  -- Robô da loja desligado: a conversa entra direto como atendimento humano.
  if not p_robo_ativo then
    update public.whatsapp_conversas set
      estado = 'silenciada',
      silenciada_em = coalesce(silenciada_em, v_agora),
      silenciada_motivo = coalesce(silenciada_motivo, 'cliente'),
      atendimento = case when atendimento = 'humano' then 'humano' else 'aguardando' end,
      ultima_mensagem_em = v_agora
    where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada', 'robo_desligado', true);
  end if;

  if c.estado = 'silenciada' then
    update public.whatsapp_conversas set ultima_mensagem_em = v_agora,
      atendimento = case when atendimento in ('robo', 'encerrada') then 'aguardando' else atendimento end
    where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada');
  end if;

  -- Proteção contra loop (0105).
  select count(*) filter (where e.criado_em > v_agora - interval '2 minutes'), count(*)
    into v_resp_curto, v_resp_longo
    from public.whatsapp_envios e
   where e.conversa_id = c.id and e.tipo = 'robo' and e.criado_em > v_agora - interval '20 minutes';
  if v_resp_curto >= v_lim_curto or v_resp_longo >= v_lim_longo then
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = v_agora, silenciada_motivo = 'protecao',
      ultima_mensagem_em = v_agora, atendimento = 'humano' where id = c.id;
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, c.id, 'protecao_loop', jsonb_build_object('respostas_2min', v_resp_curto, 'respostas_20min', v_resp_longo, 'limite_2min', v_lim_curto, 'limite_20min', v_lim_longo));
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada', 'protecao', true);
  end if;

  v_boas_vindas := c.boas_vindas_em is null or c.ultima_mensagem_em is null or c.ultima_mensagem_em < v_agora - v_janela;

  if p_intencao in ('atendente', 'status', 'cardapio', 'horario', 'taxa') then
    v_acao := p_intencao;
  elsif p_intencao = 'midia' and v_boas_vindas then
    v_acao := 'padrao';
  elsif p_intencao = 'menu' or v_boas_vindas then
    v_acao := 'boas_vindas';
  elsif c.resposta_padrao_em is null or c.resposta_padrao_em < v_agora - interval '10 minutes' then
    v_acao := 'padrao';
  end if;

  if v_acao = 'atendente' then
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo) values (p_restaurante, c.id, 'atendente');
  end if;

  update public.whatsapp_conversas set
    estado = case when v_acao = 'atendente' then 'silenciada' else 'robo' end,
    silenciada_em = case when v_acao = 'atendente' then v_agora else null end,
    silenciada_motivo = case when v_acao = 'atendente' then 'cliente' else null end,
    atendimento = case when v_acao = 'atendente' then 'aguardando' else 'robo' end,
    boas_vindas_em = case when v_boas_vindas or v_acao = 'boas_vindas' then v_agora else boas_vindas_em end,
    resposta_padrao_em = case when v_acao = 'padrao' then v_agora else resposta_padrao_em end,
    ultima_mensagem_em = v_agora
  where id = c.id;

  return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', v_acao, 'boas_vindas', v_boas_vindas);
end $$;

-- ─── 4b. saída (atendente, robô, avisos, disparos) ────────────────────────────
-- Grava ANTES de enviar (wa_id provisório 'local:<uuid>'); concluir_saida põe o id do
-- provedor. Mensagem do atendente para o robô naquela conversa.
create or replace function public.whatsapp_registrar_saida(
  p_restaurante uuid, p_telefone text, p_texto text, p_texto_hash text, p_origem text,
  p_tipo text default 'texto', p_midia_url text default null, p_autor_id uuid default null, p_autor_nome text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_msg uuid;
  v_agora timestamptz := now();
begin
  if p_origem not in ('atendente', 'robo', 'automatico', 'disparo') then raise exception 'origem_invalida'; end if;
  if p_telefone !~ '^[0-9]{10,15}$' then raise exception 'telefone_invalido'; end if;
  insert into public.whatsapp_conversas (restaurante_id, telefone) values (p_restaurante, p_telefone)
  on conflict (restaurante_id, telefone) do nothing;
  select * into c from public.whatsapp_conversas where restaurante_id = p_restaurante and telefone = p_telefone for update;

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
end $$;

create or replace function public.whatsapp_concluir_saida(p_mensagem uuid, p_ok boolean, p_wa_id text, p_erro text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.whatsapp_mensagens set status_envio = case when p_ok then 'enviado' else 'falhou' end,
    erro = case when p_ok then null else left(p_erro, 300) end
  where id = p_mensagem;
  if p_ok and p_wa_id is not null and btrim(p_wa_id) <> '' then
    begin
      update public.whatsapp_mensagens set wa_id = left(p_wa_id, 200) where id = p_mensagem;
    exception when unique_violation then
      -- O eco do webhook chegou antes e já ocupou o id: fica a nossa (com autor/origem) e sai o eco.
      delete from public.whatsapp_mensagens m using public.whatsapp_mensagens nossa
       where nossa.id = p_mensagem and m.restaurante_id = nossa.restaurante_id and m.wa_id = left(p_wa_id, 200) and m.id <> p_mensagem;
      update public.whatsapp_mensagens set wa_id = left(p_wa_id, 200) where id = p_mensagem;
    end;
  end if;
end $$;

-- ─── 4c. ações do painel na conversa ──────────────────────────────────────────
create or replace function public.whatsapp_atendimento_acao(
  p_restaurante uuid, p_conversa uuid, p_acao text, p_ator uuid, p_ator_nome text, p_robo_ativo boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c record; v_agora timestamptz := now();
begin
  if p_acao not in ('assumir', 'encerrar', 'pausar', 'retomar', 'lida') then raise exception 'acao_invalida'; end if;
  select * into c from public.whatsapp_conversas where id = p_conversa and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'conversa_inexistente'; end if;

  if p_acao = 'lida' then
    update public.whatsapp_conversas set nao_lidas = 0 where id = c.id;
    return jsonb_build_object('atendimento', c.atendimento);
  elsif p_acao = 'assumir' then
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = v_agora,
      silenciada_motivo = coalesce(case when c.estado = 'silenciada' then c.silenciada_motivo end, 'painel'),
      atendimento = 'humano', atendente_id = p_ator, atendente_nome = left(p_ator_nome, 120), assumida_em = v_agora, nao_lidas = 0
    where id = c.id;
  elsif p_acao = 'pausar' then
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = v_agora, silenciada_motivo = 'painel',
      atendimento = case when c.atendimento in ('robo', 'encerrada') then 'humano' else c.atendimento end
    where id = c.id;
  elsif p_acao = 'retomar' or (p_acao = 'encerrar' and p_robo_ativo) then
    update public.whatsapp_conversas set estado = 'robo', silenciada_em = null, silenciada_motivo = null,
      atendimento = 'robo', atendente_id = null, atendente_nome = null, assumida_em = null, nao_lidas = 0
    where id = c.id;
  else
    -- Encerrar com o robô da loja desligado: sem robô para devolver.
    update public.whatsapp_conversas set atendimento = 'encerrada', atendente_id = null, atendente_nome = null, assumida_em = null, nao_lidas = 0
    where id = c.id;
  end if;

  insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
  values (p_restaurante, c.id, case when p_acao in ('retomar', 'encerrar') then 'painel_devolveu' else 'painel_pausou' end,
          jsonb_build_object('acao', p_acao, 'atendimento_anterior', c.atendimento));
  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome,
    case when p_acao in ('retomar', 'encerrar') then 'whatsapp.conversa_reativada' else 'whatsapp.conversa_pausada' end,
    'whatsapp_conversa', c.id, jsonb_build_object('acao', p_acao, 'atendimento_anterior', c.atendimento));
  select atendimento into c from public.whatsapp_conversas where id = p_conversa;
  return jsonb_build_object('atendimento', c.atendimento);
end $$;

-- "Devolver ao robô" / "Pausar robô" de Integrações (0103): mesmo comportamento, com o
-- estado de atendimento acompanhando.
create or replace function public.whatsapp_alterar_conversa(
  p_restaurante uuid, p_conversa uuid, p_acao text, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c record;
begin
  if p_acao not in ('devolver', 'pausar') then raise exception 'acao_invalida'; end if;
  select * into c from public.whatsapp_conversas where id = p_conversa and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'conversa_inexistente'; end if;
  if p_acao = 'devolver' then
    if c.estado <> 'silenciada' then return jsonb_build_object('estado', c.estado, 'mudou', false); end if;
    update public.whatsapp_conversas set estado = 'robo', silenciada_em = null, silenciada_motivo = null,
      atendimento = 'robo', atendente_id = null, atendente_nome = null, assumida_em = null where id = c.id;
  else
    if c.estado = 'silenciada' then return jsonb_build_object('estado', c.estado, 'mudou', false); end if;
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = now(), silenciada_motivo = 'painel',
      atendimento = case when c.atendimento in ('robo', 'encerrada') then 'humano' else c.atendimento end where id = c.id;
  end if;
  insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
  values (p_restaurante, c.id, case when p_acao = 'devolver' then 'painel_devolveu' else 'painel_pausou' end,
          jsonb_build_object('motivo_anterior', c.silenciada_motivo));
  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome,
    case when p_acao = 'devolver' then 'whatsapp.conversa_reativada' else 'whatsapp.conversa_pausada' end,
    'whatsapp_conversa', c.id, jsonb_build_object('motivo_anterior', c.silenciada_motivo));
  return jsonb_build_object('estado', case when p_acao = 'devolver' then 'robo' else 'silenciada' end, 'mudou', true);
end $$;

-- ─── 4d. retenção (0103 + prévia e autor) ─────────────────────────────────────
create or replace function public.whatsapp_limpar_antigos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare am integer; ae integer; ac integer; m integer; e integer; ev integer; c integer;
begin
  update public.whatsapp_mensagens set texto = null, texto_hash = null, midia_url = null
   where criado_em < now() - interval '90 days' and (texto is not null or midia_url is not null);
  get diagnostics am = row_count;
  update public.whatsapp_envios set texto = '[conteúdo removido após 90 dias]'
   where criado_em < now() - interval '90 days' and estado not in ('pendente', 'enviando')
     and texto <> '[conteúdo removido após 90 dias]';
  get diagnostics ae = row_count;
  update public.whatsapp_conversas set nome_contato = null, ultima_previa = null
   where coalesce(ultima_atividade_em, ultima_mensagem_em, criado_em) < now() - interval '90 days'
     and (nome_contato is not null or ultima_previa is not null);
  get diagnostics ac = row_count;

  delete from public.whatsapp_envios where criado_em < now() - interval '12 months' and estado not in ('pendente', 'enviando');
  get diagnostics e = row_count;
  delete from public.whatsapp_mensagens where criado_em < now() - interval '12 months';
  get diagnostics m = row_count;
  delete from public.whatsapp_eventos where criado_em < now() - interval '12 months';
  get diagnostics ev = row_count;
  delete from public.whatsapp_conversas c2 where coalesce(c2.ultima_atividade_em, c2.ultima_mensagem_em, c2.criado_em) < now() - interval '12 months'
     and not exists (select 1 from public.whatsapp_mensagens m2 where m2.conversa_id = c2.id);
  get diagnostics c = row_count;
  return jsonb_build_object('anonimizadas', jsonb_build_object('mensagens', am, 'envios', ae, 'conversas', ac),
                            'apagadas', jsonb_build_object('mensagens', m, 'envios', e, 'eventos', ev, 'conversas', c));
end $$;

revoke all on function public.whatsapp_registrar_entrada(uuid, text, text, boolean, text, text, timestamptz, text, text, boolean) from public, anon, authenticated;
revoke all on function public.whatsapp_registrar_saida(uuid, text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.whatsapp_concluir_saida(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_atendimento_acao(uuid, uuid, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.whatsapp_alterar_conversa(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.whatsapp_limpar_antigos() from public, anon, authenticated;

-- ─── 5. tempo real ────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'whatsapp_conversas') then
      alter publication supabase_realtime add table public.whatsapp_conversas;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'whatsapp_mensagens') then
      alter publication supabase_realtime add table public.whatsapp_mensagens;
    end if;
  end if;
end $$;
