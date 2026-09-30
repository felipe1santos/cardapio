-- Rollback da 0116. Voltar o CÓDIGO antes (o robô passa a ignorar sem_envio sozinho).
-- 1. configuração volta a ser de qualquer papel (policy da 0008)
drop trigger if exists restaurantes_config_so_gestao on public.restaurantes;
drop function if exists public.restaurantes_config_so_gestao();

-- 2. bucket volta a ser listável
drop policy if exists "Tenant members read their menu photos" on storage.objects;
drop policy if exists "Public read of menu photos" on storage.objects;
create policy "Public read of menu photos"
  on storage.objects for select
  using (bucket_id = 'cardapio');

-- 3 e 4. funções de entrada/saída como na 0107 (a coluna acao_robo fica: inofensiva)
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

revoke all on function public.whatsapp_registrar_saida(uuid, text, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.whatsapp_registrar_entrada(uuid, text, text, boolean, text, text, timestamptz, text, text, boolean) from public, anon, authenticated;
drop function if exists public.whatsapp_telefone_conversa(uuid, text);
drop function if exists public.whatsapp_variantes_telefone(text);
