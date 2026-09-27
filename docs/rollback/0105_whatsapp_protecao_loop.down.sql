-- Rollback da 0105 (proteção contra loop do robô). Voltar o código antes.
-- Conversas silenciadas por proteção ficam como pausadas pelo painel (a loja devolve ao
-- robô quando quiser); os eventos 'protecao_loop' são removidos.

begin;

update public.whatsapp_conversas set silenciada_motivo = 'painel' where silenciada_motivo = 'protecao';
delete from public.whatsapp_eventos where tipo = 'protecao_loop';

alter table public.whatsapp_conversas drop constraint if exists whatsapp_conversas_silenciada_motivo_check;
alter table public.whatsapp_conversas add constraint whatsapp_conversas_silenciada_motivo_check
  check (silenciada_motivo in ('cliente', 'loja', 'painel'));
alter table public.whatsapp_eventos drop constraint if exists whatsapp_eventos_tipo_check;
alter table public.whatsapp_eventos add constraint whatsapp_eventos_tipo_check
  check (tipo in ('webhook', 'atendente', 'loja_assumiu', 'retorno_robo', 'painel_devolveu', 'painel_pausou'));
drop index if exists public.whatsapp_envios_conversa_idx;
alter table public.whatsapp_robo_config drop column if exists protecao_curta, drop column if exists protecao_longa;

-- Função como na 0103:
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
begin
  if p_intencao not in ('menu', 'status', 'atendente', 'cardapio', 'horario', 'taxa', 'outro', 'midia') then
    raise exception 'intencao_invalida';
  end if;
  -- Tempos da loja (padrão 12h e 12h quando ela não configurou).
  select make_interval(hours => coalesce(max(boas_vindas_horas), 12)), make_interval(mins => coalesce(max(retorno_minutos), 720))
    into v_janela, v_retorno
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

commit;
