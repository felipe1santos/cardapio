-- Rollback da 0107 (central de atendimento). Rodar DEPOIS de voltar o código (redeploy do
-- commit anterior à fase 2). Apaga as tags e as colunas novas; mensagens e conversas do
-- robô continuam (só perdem origem/autor/estado de atendimento). As mensagens de saída
-- gravadas pela central (origem atendente/automatico/disparo/robo) SAEM também: o robô da
-- 0105 trataria essas linhas como "a loja respondeu".

begin;

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'whatsapp_mensagens') then
    alter publication supabase_realtime drop table public.whatsapp_mensagens;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'whatsapp_conversas') then
    alter publication supabase_realtime drop table public.whatsapp_conversas;
  end if;
end $$;

drop function if exists public.whatsapp_registrar_saida(uuid, text, text, text, text, text, text, uuid, text);
drop function if exists public.whatsapp_concluir_saida(uuid, boolean, text, text);
drop function if exists public.whatsapp_atendimento_acao(uuid, uuid, text, uuid, text, boolean);
drop function if exists public.whatsapp_registrar_entrada(uuid, text, text, boolean, text, text, timestamptz, text, text, boolean);

drop table if exists public.whatsapp_conversa_tags;
drop table if exists public.whatsapp_tags;

delete from public.whatsapp_mensagens where origem in ('atendente', 'robo', 'automatico', 'disparo');
update public.whatsapp_mensagens set texto = left(texto, 1000) where char_length(texto) > 1000;
alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_texto_check;
alter table public.whatsapp_mensagens add constraint whatsapp_mensagens_texto_check check (texto is null or char_length(texto) <= 1000);
alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_origem_check;
alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_status_envio_check;
alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_extras_check;
drop index if exists public.whatsapp_mensagens_conversa_idx;
drop index if exists public.whatsapp_mensagens_hash_idx;
alter table public.whatsapp_mensagens
  drop column if exists origem, drop column if exists autor_id, drop column if exists autor_nome,
  drop column if exists status_envio, drop column if exists erro, drop column if exists midia_url, drop column if exists texto_hash;

alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_atendimento_check;
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_atendente_nome_check;
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_previa_check;
alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_nao_lidas_check;
drop index if exists public.whatsapp_conversas_atividade_idx;
drop index if exists public.whatsapp_conversas_atendimento_idx;
alter table public.whatsapp_conversas
  drop column if exists atendimento, drop column if exists atendente_id, drop column if exists atendente_nome,
  drop column if exists assumida_em, drop column if exists nao_lidas, drop column if exists ultima_previa,
  drop column if exists ultima_origem, drop column if exists ultima_atividade_em;

-- Funções como estavam (0105 / 0103).
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
    update public.whatsapp_conversas set estado = 'robo', silenciada_em = null, silenciada_motivo = null where id = c.id;
  else
    if c.estado = 'silenciada' then return jsonb_build_object('estado', c.estado, 'mudou', false); end if;
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = now(), silenciada_motivo = 'painel' where id = c.id;
  end if;
  insert into public.whatsapp_eventos (restaurante_id, conversa_id, tipo, resultado)
  values (p_restaurante, c.id, case when p_acao = 'devolver' then 'painel_devolveu' else 'painel_pausou' end,
          jsonb_build_object('motivo_anterior', c.silenciada_motivo));
  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome,
    case when p_acao = 'devolver' then 'whatsapp.conversa_reativada' else 'whatsapp.conversa_pausada' end,
    'whatsapp_conversa', c.id, jsonb_build_object('motivo_anterior', c.silenciada_motivo));
  return jsonb_build_object('estado', case when p_acao = 'devolver' then 'robo' else 'silenciada' end, 'mudou', true);
end $$;

create or replace function public.whatsapp_limpar_antigos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare am integer; ae integer; ac integer; m integer; e integer; ev integer; c integer;
begin
  update public.whatsapp_mensagens set texto = null
   where criado_em < now() - interval '90 days' and texto is not null;
  get diagnostics am = row_count;
  update public.whatsapp_envios set texto = '[conteúdo removido após 90 dias]'
   where criado_em < now() - interval '90 days' and estado not in ('pendente', 'enviando')
     and texto <> '[conteúdo removido após 90 dias]';
  get diagnostics ae = row_count;
  update public.whatsapp_conversas set nome_contato = null
   where coalesce(ultima_mensagem_em, criado_em) < now() - interval '90 days' and nome_contato is not null;
  get diagnostics ac = row_count;

  delete from public.whatsapp_envios where criado_em < now() - interval '12 months' and estado not in ('pendente', 'enviando');
  get diagnostics e = row_count;
  delete from public.whatsapp_mensagens where criado_em < now() - interval '12 months';
  get diagnostics m = row_count;
  delete from public.whatsapp_eventos where criado_em < now() - interval '12 months';
  get diagnostics ev = row_count;
  delete from public.whatsapp_conversas c2 where coalesce(c2.ultima_mensagem_em, c2.criado_em) < now() - interval '12 months'
     and not exists (select 1 from public.whatsapp_mensagens m2 where m2.conversa_id = c2.id);
  get diagnostics c = row_count;
  return jsonb_build_object('anonimizadas', jsonb_build_object('mensagens', am, 'envios', ae, 'conversas', ac),
                            'apagadas', jsonb_build_object('mensagens', m, 'envios', e, 'eventos', ev, 'conversas', c));
end $$;


revoke all on function public.whatsapp_registrar_entrada(uuid, text, text, boolean, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_alterar_conversa(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.whatsapp_limpar_antigos() from public, anon, authenticated;

commit;
