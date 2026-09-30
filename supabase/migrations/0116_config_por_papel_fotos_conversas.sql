-- 0116 — Configuração só pela gestão; fotos não listáveis; uma conversa por cliente;
--        resposta do robô não se perde.
--
-- 1. restaurantes (varredura 2026-09-29, item 9): a policy da 0008 deixa QUALQUER papel
--    da loja (atendente, garçom, cozinha, entregador) alterar QUALQUER coluna — taxas,
--    slug, horário, pixels — direto no PostgREST. Agora, pelo navegador, só dono e
--    gerente mudam configuração; os outros papéis só mexem no que a operação usa:
--    abrir/fechar a loja no Kanban (status_loja), o despacho de rotas (despacho_aberto) e o
--    modo "entrega sem entregador" da Logística (entrega_sem_entregador).
--    Servidor (service_role) e conexão direta passam, como na 0071/0111.
--
-- 2. storage 'cardapio' (B14): o bucket é público (as fotos abrem pela URL pública, que
--    não passa por policy), mas a policy de SELECT para todos deixava o anon LISTAR o
--    bucket — inclusive as fotos que o atendente manda pela central. Listar passa a ser
--    só do próprio logado, na pasta da própria loja.
--
-- 3. conversas (M8): a saída é gravada com o número completo (com o 9) e a resposta chega
--    pelo número que o WhatsApp informa (muitas vezes sem o 9) → duas conversas para o
--    mesmo cliente. Entrada e saída agora usam a conversa que já existe em qualquer das
--    duas formas. As duplicadas antigas ficam como estão (não se funde histórico).
--
-- 4. robô (B11): se a resposta não entrasse na fila depois de a mensagem ser registrada,
--    o reenvio do webhook virava "duplicada" e o cliente ficava sem resposta. A decisão do
--    robô fica gravada na mensagem (acao_robo) e a duplicada recente sem envio devolve essa
--    decisão para a aplicação enfileirar (a chave resposta:<mensagem> não duplica).
--
-- Aditiva: nenhuma linha existente é alterada.
-- Rollback: docs/rollback/0116_config_por_papel_fotos_conversas.down.sql

-- ─── 1. restaurantes: configuração só pela gestão ─────────────────────────────
create or replace function public.restaurantes_config_so_gestao()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(public.auth_papel(), '') not in ('dono', 'gerente')
     and (to_jsonb(new) - array['status_loja', 'despacho_aberto', 'entrega_sem_entregador']) is distinct from (to_jsonb(old) - array['status_loja', 'despacho_aberto', 'entrega_sem_entregador'])
  then
    raise exception 'configuracao_so_gestao' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists restaurantes_config_so_gestao on public.restaurantes;
create trigger restaurantes_config_so_gestao
  before update on public.restaurantes
  for each row execute function public.restaurantes_config_so_gestao();

-- ─── 2. storage: bucket 'cardapio' não listável pelo anon ────────────────────
drop policy if exists "Public read of menu photos" on storage.objects;
drop policy if exists "Tenant members read their menu photos" on storage.objects;
create policy "Tenant members read their menu photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cardapio'
    and (storage.foldername(name))[1] = public.auth_restaurante_id()::text
  );

-- ─── 3. uma conversa por cliente (com ou sem o 9) ────────────────────────────
-- Espelho de variantesTelefone (lib/mensageria/robo.ts): mesmas formas, com e sem 55.
create or replace function public.whatsapp_variantes_telefone(p_telefone text)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  d text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_ddd text;
  v_resto text;
  v_locais text[];
  v_out text[] := '{}';
  l text;
begin
  if (length(d) = 12 or length(d) = 13) and left(d, 2) = '55' then d := substr(d, 3); end if;
  if length(d) not in (10, 11) then return '{}'; end if;
  v_ddd := left(d, 2);
  v_resto := substr(d, 3);
  v_locais := array[d];
  if length(v_resto) = 8 then v_locais := v_locais || (v_ddd || '9' || v_resto); end if;
  if length(v_resto) = 9 and left(v_resto, 1) = '9' then v_locais := v_locais || (v_ddd || substr(v_resto, 2)); end if;
  foreach l in array v_locais loop
    v_out := v_out || l || ('55' || l);
  end loop;
  return v_out;
end $$;

-- Telefone da conversa a usar: a exata, se existe; senão a de outra forma do mesmo número
-- (a mais recente); senão o próprio (conversa nova).
create or replace function public.whatsapp_telefone_conversa(p_restaurante uuid, p_telefone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select telefone from public.whatsapp_conversas where restaurante_id = p_restaurante and telefone = p_telefone),
    (select telefone from public.whatsapp_conversas
      where restaurante_id = p_restaurante and telefone = any(public.whatsapp_variantes_telefone(p_telefone))
      order by ultima_atividade_em desc nulls last limit 1),
    p_telefone)
$$;

revoke all on function public.whatsapp_telefone_conversa(uuid, text) from public, anon, authenticated;

-- ─── 4. decisão do robô gravada na mensagem ──────────────────────────────────
alter table public.whatsapp_mensagens add column if not exists acao_robo text;
comment on column public.whatsapp_mensagens.acao_robo is
  'O que o robô decidiu responder a esta mensagem (0116). Reentrega do webhook sem envio na fila reaproveita a decisão.';

-- Saída: igual à 0107, mas na conversa que já existe em qualquer forma do número.
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
  v_tel text;
begin
  if p_origem not in ('atendente', 'robo', 'automatico', 'disparo') then raise exception 'origem_invalida'; end if;
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
end $$;

-- Entrada: igual à 0107, com (3) a conversa em qualquer forma do número e (4) a decisão
-- gravada e devolvida na reentrega sem envio.
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
  d record;
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
  v_tel text;
begin
  if p_intencao not in ('menu', 'status', 'atendente', 'cardapio', 'horario', 'taxa', 'outro', 'midia') then
    raise exception 'intencao_invalida';
  end if;
  select make_interval(hours => coalesce(max(boas_vindas_horas), 12)), make_interval(mins => coalesce(max(retorno_minutos), 720)),
         coalesce(max(protecao_curta), 8), coalesce(max(protecao_longa), 20)
    into v_janela, v_retorno, v_lim_curto, v_lim_longo
    from public.whatsapp_robo_config where restaurante_id = p_restaurante;

  v_tel := public.whatsapp_telefone_conversa(p_restaurante, p_telefone);
  insert into public.whatsapp_conversas (restaurante_id, telefone) values (p_restaurante, v_tel)
  on conflict (restaurante_id, telefone) do nothing;
  select * into c from public.whatsapp_conversas
   where restaurante_id = p_restaurante and telefone = v_tel for update;

  insert into public.whatsapp_mensagens (restaurante_id, conversa_id, wa_id, direcao, origem, tipo, texto, enviada_em)
  values (p_restaurante, c.id, p_wa_id, case when p_de_mim then 'loja' else 'entrada' end,
          case when p_de_mim then 'loja' else 'cliente' end, p_tipo, left(p_texto, 4000), p_instante)
  on conflict (restaurante_id, wa_id) do nothing
  returning id into v_msg;
  if v_msg is null then
    -- Reentrega. Se é recente, do cliente, e nada entrou na fila para ela, devolve a
    -- decisão gravada para a aplicação enfileirar de novo (B11).
    select m.id, m.acao_robo, m.criado_em, m.direcao into d
      from public.whatsapp_mensagens m where m.restaurante_id = p_restaurante and m.wa_id = p_wa_id;
    if d.id is not null and d.direcao = 'entrada' and d.criado_em > v_agora - interval '10 minutes'
       and not exists (select 1 from public.whatsapp_envios e where e.origem_mensagem_id = d.id) then
      return jsonb_build_object('duplicada', true, 'sem_envio', true, 'conversa_id', c.id, 'mensagem_id', d.id,
                                'acao', coalesce(d.acao_robo, 'nada'));
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

  if v_acao <> 'nada' then
    update public.whatsapp_mensagens set acao_robo = v_acao where id = v_msg;
  end if;

  return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', v_acao, 'boas_vindas', v_boas_vindas);
end $$;

revoke all on function public.whatsapp_registrar_saida(uuid, text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.whatsapp_registrar_entrada(uuid, text, text, boolean, text, text, timestamptz, text, text, boolean) from public, anon, authenticated;
