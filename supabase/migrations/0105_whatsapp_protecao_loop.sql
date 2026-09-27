-- 0105 — Robô do WhatsApp: proteção contra loop (dois robôs se respondendo).
--
-- Aditiva. whatsapp_registrar_entrada ganha uma trava: se o robô já respondeu 8 vezes na
-- mesma conversa nos últimos 2 minutos (ou 20 nos últimos 20), ele sai da conversa
-- (silenciada, motivo 'protecao') e registra o evento 'protecao_loop' com as contagens.
-- Os limites ficam em whatsapp_robo_config (protecao_curta / protecao_longa), com esses
-- padrões; o piloto teve no máximo 14 respostas em ~17 min numa conversa humana.
-- Mensagem do cliente continua sendo gravada; nada mais muda no robô.
--
-- Rollback: docs/rollback/0105_whatsapp_protecao_loop.down.sql

alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_silenciada_motivo_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_silenciada_motivo_check
  check (silenciada_motivo in ('cliente', 'loja', 'painel', 'protecao'));

alter table public.whatsapp_eventos drop constraint if exists whatsapp_eventos_tipo_check;
alter table public.whatsapp_eventos add constraint whatsapp_eventos_tipo_check
  check (tipo in ('webhook', 'atendente', 'loja_assumiu', 'retorno_robo', 'painel_devolveu', 'painel_pausou', 'protecao_loop'));

alter table public.whatsapp_robo_config
  add column if not exists protecao_curta integer not null default 8 check (protecao_curta between 3 and 200),
  add column if not exists protecao_longa integer not null default 20 check (protecao_longa between 5 and 500);

create index if not exists whatsapp_envios_conversa_idx on public.whatsapp_envios (conversa_id, criado_em) where conversa_id is not null;

create or replace function public.whatsapp_registrar_entrada(
  p_restaurante uuid, p_telefone text, p_wa_id text, p_de_mim boolean,
  p_tipo text, p_texto text, p_instante timestamptz, p_intencao text, p_nome text default null)
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
begin
  if p_intencao not in ('menu', 'status', 'atendente', 'cardapio', 'horario', 'taxa', 'outro', 'midia') then
    raise exception 'intencao_invalida';
  end if;
  -- Tempos da loja (padrão 12h e 12h quando ela não configurou).
  select make_interval(hours => coalesce(max(boas_vindas_horas), 12)), make_interval(mins => coalesce(max(retorno_minutos), 720)),
         coalesce(max(protecao_curta), 8), coalesce(max(protecao_longa), 20)
    into v_janela, v_retorno, v_lim_curto, v_lim_longo
    from public.whatsapp_robo_config where restaurante_id = p_restaurante;

  insert into public.whatsapp_conversas (restaurante_id, telefone) values (p_restaurante, p_telefone)
  on conflict (restaurante_id, telefone) do nothing;
  select * into c from public.whatsapp_conversas
   where restaurante_id = p_restaurante and telefone = p_telefone for update;

  insert into public.whatsapp_mensagens (restaurante_id, conversa_id, wa_id, direcao, tipo, texto, enviada_em)
  values (p_restaurante, c.id, p_wa_id, case when p_de_mim then 'loja' else 'entrada' end, p_tipo, left(p_texto, 1000), p_instante)
  on conflict (restaurante_id, wa_id) do nothing
  returning id into v_msg;
  if v_msg is null then
    return jsonb_build_object('duplicada', true, 'conversa_id', c.id, 'acao', 'nada');
  end if;

  if p_nome is not null and btrim(p_nome) <> '' and c.nome_contato is distinct from left(btrim(p_nome), 80) and not p_de_mim then
    update public.whatsapp_conversas set nome_contato = left(btrim(p_nome), 80) where id = c.id;
  end if;

  -- Volta sozinho ao robô depois do tempo da loja sem mensagens (contado da última
  -- mensagem ou do momento do silêncio, o que for mais recente — a pausa manual conta).
  if c.estado = 'silenciada' and greatest(c.ultima_mensagem_em, c.silenciada_em) < v_agora - v_retorno then
    c.estado := 'robo';
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, c.id, 'retorno_robo', jsonb_build_object('motivo_anterior', c.silenciada_motivo));
  end if;

  if p_de_mim then
    -- A loja respondeu pelo celular: o robô sai da conversa.
    if c.estado <> 'silenciada' then
      insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo) values (p_restaurante, c.id, 'loja_assumiu');
    end if;
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = v_agora, silenciada_motivo = 'loja',
      ultima_mensagem_em = v_agora where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada');
  end if;

  if c.estado = 'silenciada' then
    update public.whatsapp_conversas set ultima_mensagem_em = v_agora where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada');
  end if;

  -- Proteção contra loop (0105): outro robô ou uma resposta automática do outro lado faz
  -- a conversa virar pingue-pongue. Se o robô já respondeu 8 vezes nesta conversa nos
  -- últimos 2 minutos (ou 20 nos últimos 20; limites por loja), ele sai dela — como se a loja tivesse
  -- assumido — e registra o motivo. Uma pessoa não chega nesse ritmo; a loja vê a
  -- conversa em Integrações e pode devolver ao robô. Volta sozinho pelo tempo da loja.
  select count(*) filter (where e.criado_em > v_agora - interval '2 minutes'), count(*)
    into v_resp_curto, v_resp_longo
    from public.whatsapp_envios e
   where e.conversa_id = c.id and e.tipo = 'robo' and e.criado_em > v_agora - interval '20 minutes';
  if v_resp_curto >= v_lim_curto or v_resp_longo >= v_lim_longo then
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = v_agora, silenciada_motivo = 'protecao',
      ultima_mensagem_em = v_agora where id = c.id;
    insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
    values (p_restaurante, c.id, 'protecao_loop', jsonb_build_object('respostas_2min', v_resp_curto, 'respostas_20min', v_resp_longo, 'limite_2min', v_lim_curto, 'limite_20min', v_lim_longo));
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada', 'protecao', true);
  end if;

  -- Boas-vindas: primeira conversa ou 12h sem mensagens. Uma vez por janela.
  v_boas_vindas := c.boas_vindas_em is null or c.ultima_mensagem_em is null or c.ultima_mensagem_em < v_agora - v_janela;

  -- Pedido explícito responde sempre (com a saudação junto, se for a primeira da
  -- janela). "Oi"/"menu" mostra o menu. Texto não reconhecido e mídia: na primeira da
  -- janela, as boas-vindas; depois, a resposta padrão no máximo a cada 10 minutos.
  if p_intencao in ('atendente', 'status', 'cardapio', 'horario', 'taxa') then
    v_acao := p_intencao;
  elsif p_intencao = 'midia' and v_boas_vindas then
    -- Áudio/foto/localização logo de cara: a resposta própria do tipo, com a saudação.
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
    boas_vindas_em = case when v_boas_vindas or v_acao = 'boas_vindas' then v_agora else boas_vindas_em end,
    resposta_padrao_em = case when v_acao = 'padrao' then v_agora else resposta_padrao_em end,
    ultima_mensagem_em = v_agora
  where id = c.id;

  return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', v_acao, 'boas_vindas', v_boas_vindas);
end $$;
