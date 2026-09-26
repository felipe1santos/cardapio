-- 0102 — Robô de atendimento pelo WhatsApp (v1, sem IA) e fila de envios.
--
-- Aditiva. Nada muda para as lojas até alguém ligar o robô em Integrações (nasce
-- DESLIGADO) e registrar o webhook da instância. Os avisos de etapa do pedido passam a
-- entrar na fila (idempotência por pedido+etapa, nova tentativa com espera crescente),
-- com os mesmos textos de antes.
--
--   whatsapp_robo_config  — por loja: ligado, texto de boas-vindas, segredo do webhook.
--                           Só o servidor lê (nenhuma policy): o segredo nunca vai ao navegador.
--   whatsapp_conversas    — loja + telefone: robô ou silenciada (humano), janelas de tempo.
--   whatsapp_mensagens    — o que chegou e o que saiu; id do WhatsApp ÚNICO por loja
--                           (mensagem reentregue não é processada de novo).
--   whatsapp_envios       — fila: chave de idempotência única por loja; no máximo UMA
--                           resposta por mensagem recebida.
--
-- Retenção: 90 dias (whatsapp_limpar_antigos). Leitura pelo painel: dono e gerente da
-- própria loja (RLS). Escrita: só service_role (webhook, fila, rotas do painel).
--
-- Rollback: docs/rollback/0102_whatsapp_robo_e_fila.down.sql

-- ─── configuração por loja ───────────────────────────────────────────────────
create table if not exists public.whatsapp_robo_config (
  restaurante_id uuid primary key references public.restaurantes(id) on delete cascade,
  robo_ativo boolean not null default false,
  boas_vindas text,
  webhook_segredo text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  constraint whatsapp_boas_vindas_tamanho check (boas_vindas is null or char_length(boas_vindas) <= 500)
);
alter table public.whatsapp_robo_config enable row level security;
revoke all on public.whatsapp_robo_config from anon, authenticated;

-- ─── conversas ───────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_conversas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  telefone text not null check (telefone ~ '^[0-9]{10,15}$'),
  estado text not null default 'robo' check (estado in ('robo', 'silenciada')),
  silenciada_em timestamptz,
  silenciada_motivo text check (silenciada_motivo in ('cliente', 'loja', 'painel')),
  ultima_mensagem_em timestamptz,
  boas_vindas_em timestamptz,
  resposta_padrao_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (restaurante_id, telefone)
);
create index if not exists whatsapp_conversas_silenciadas_idx on public.whatsapp_conversas (restaurante_id) where estado = 'silenciada';
alter table public.whatsapp_conversas enable row level security;

-- ─── mensagens ───────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_mensagens (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  conversa_id uuid not null references public.whatsapp_conversas(id) on delete cascade,
  wa_id text not null check (char_length(wa_id) between 1 and 200),
  direcao text not null check (direcao in ('entrada', 'loja')),
  tipo text not null check (tipo in ('texto', 'audio', 'imagem', 'video', 'figurinha', 'localizacao', 'documento', 'contato', 'outro')),
  texto text check (texto is null or char_length(texto) <= 1000),
  enviada_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (restaurante_id, wa_id)
);
create index if not exists whatsapp_mensagens_conversa_idx on public.whatsapp_mensagens (conversa_id, criado_em);
alter table public.whatsapp_mensagens enable row level security;

-- ─── fila de envios ──────────────────────────────────────────────────────────
create table if not exists public.whatsapp_envios (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  conversa_id uuid references public.whatsapp_conversas(id) on delete set null,
  origem_mensagem_id uuid unique references public.whatsapp_mensagens(id) on delete set null,
  chave text not null check (char_length(chave) between 1 and 200),
  tipo text not null check (tipo in ('robo', 'aviso_pedido')),
  pedido_id uuid references public.pedidos(id) on delete set null,
  telefone text not null check (telefone ~ '^[0-9]{10,15}$'),
  texto text not null check (char_length(texto) between 1 and 4000),
  estado text not null default 'pendente' check (estado in ('pendente', 'enviando', 'enviado', 'falhou', 'incerto')),
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  travado_ate timestamptz,
  id_externo text,
  ultimo_erro text check (ultimo_erro is null or char_length(ultimo_erro) <= 300),
  enviado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (restaurante_id, chave)
);
create index if not exists whatsapp_envios_fila_idx on public.whatsapp_envios (proxima_tentativa_em) where estado in ('pendente', 'enviando');
create index if not exists whatsapp_envios_externo_idx on public.whatsapp_envios (restaurante_id, id_externo) where id_externo is not null;
alter table public.whatsapp_envios enable row level security;

-- ─── leitura pelo painel: dono e gerente, só a própria loja ────────────────────
do $$
declare t text;
begin
  foreach t in array array['whatsapp_conversas', 'whatsapp_mensagens', 'whatsapp_envios'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_leitura_gestao', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (restaurante_id = public.auth_restaurante_id() and public.auth_papel() in ('dono', 'gerente'))$p$, t || '_leitura_gestao', t);
  end loop;
end $$;

-- ─── entrada: registra a mensagem e decide a ação, sob trava da conversa ─────────
-- Idempotente pelo wa_id. A trava (for update) serializa duas mensagens simultâneas do
-- mesmo cliente: boas-vindas e silêncio nunca são decididos duas vezes.
--   p_intencao: 'status' | 'atendente' | 'outro' | 'midia' (classificada no servidor)
-- Retorna { duplicada, conversa_id, mensagem_id, acao, boas_vindas }
--   acao: 'nada' | 'boas_vindas' | 'status' | 'atendente' | 'padrao'
create or replace function public.whatsapp_registrar_entrada(
  p_restaurante uuid, p_telefone text, p_wa_id text, p_de_mim boolean,
  p_tipo text, p_texto text, p_instante timestamptz, p_intencao text)
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
begin
  if p_intencao not in ('status', 'atendente', 'outro', 'midia') then raise exception 'intencao_invalida'; end if;

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

  -- Volta sozinho ao robô depois de 2h sem nenhuma mensagem na conversa.
  if c.estado = 'silenciada' and c.ultima_mensagem_em is not null and c.ultima_mensagem_em < v_agora - interval '2 hours' then
    c.estado := 'robo';
  end if;

  if p_de_mim then
    -- A loja respondeu pelo celular: o robô sai da conversa.
    update public.whatsapp_conversas set estado = 'silenciada', silenciada_em = v_agora, silenciada_motivo = 'loja',
      ultima_mensagem_em = v_agora where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada');
  end if;

  if c.estado = 'silenciada' then
    update public.whatsapp_conversas set ultima_mensagem_em = v_agora where id = c.id;
    return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', 'nada');
  end if;

  -- Boas-vindas: primeira conversa ou 12h sem mensagens. Uma vez por janela.
  v_boas_vindas := c.boas_vindas_em is null or c.ultima_mensagem_em is null or c.ultima_mensagem_em < v_agora - interval '12 hours';

  if p_intencao = 'atendente' then
    v_acao := 'atendente';
  elsif p_intencao = 'status' then
    v_acao := 'status';
  elsif v_boas_vindas then
    v_acao := 'boas_vindas';
  elsif c.resposta_padrao_em is null or c.resposta_padrao_em < v_agora - interval '10 minutes' then
    -- Texto não reconhecido / mídia: resposta padrão, no máximo uma a cada 10 minutos.
    v_acao := 'padrao';
  end if;

  update public.whatsapp_conversas set
    estado = case when v_acao = 'atendente' then 'silenciada' else 'robo' end,
    silenciada_em = case when v_acao = 'atendente' then v_agora else null end,
    silenciada_motivo = case when v_acao = 'atendente' then 'cliente' else null end,
    boas_vindas_em = case when v_boas_vindas then v_agora else boas_vindas_em end,
    resposta_padrao_em = case when v_acao = 'padrao' then v_agora else resposta_padrao_em end,
    ultima_mensagem_em = v_agora
  where id = c.id;

  return jsonb_build_object('duplicada', false, 'conversa_id', c.id, 'mensagem_id', v_msg, 'acao', v_acao, 'boas_vindas', v_boas_vindas);
end $$;

-- ─── fila: reivindicar e concluir ─────────────────────────────────────────────
-- skip locked: dois processadores nunca pegam o mesmo envio. Um envio 'enviando' cuja
-- trava venceu (processo caiu no meio) NÃO volta sozinho: pode já ter saído — vira
-- 'incerto' e só sai de novo por decisão humana (sem mensagem duplicada automática).
create or replace function public.whatsapp_reivindicar_envios(p_limite integer, p_restaurante uuid default null)
returns setof public.whatsapp_envios
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.whatsapp_envios set estado = 'incerto', ultimo_erro = 'processo interrompido durante o envio'
   where estado = 'enviando' and travado_ate < now();
  return query
  update public.whatsapp_envios e set estado = 'enviando', travado_ate = now() + interval '60 seconds', tentativas = e.tentativas + 1
   where e.id in (
     select id from public.whatsapp_envios
      where estado = 'pendente' and proxima_tentativa_em <= now()
        and (p_restaurante is null or restaurante_id = p_restaurante)
      order by proxima_tentativa_em
      limit greatest(1, least(p_limite, 50))
      for update skip locked)
  returning e.*;
end $$;

-- p_resultado: 'enviado' | 'transitorio' (nova tentativa com espera) | 'definitivo' | 'incerto'
create or replace function public.whatsapp_concluir_envio(p_id uuid, p_resultado text, p_id_externo text, p_erro text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare e record;
begin
  select * into e from public.whatsapp_envios where id = p_id for update;
  if e.id is null or e.estado <> 'enviando' then return; end if;
  if p_resultado = 'enviado' then
    update public.whatsapp_envios set estado = 'enviado', enviado_em = now(), id_externo = left(p_id_externo, 200), travado_ate = null, ultimo_erro = null where id = p_id;
  elsif p_resultado = 'transitorio' and e.tentativas < 5 then
    -- 30s, 60s, 120s, 240s
    update public.whatsapp_envios set estado = 'pendente', travado_ate = null, ultimo_erro = left(p_erro, 300),
      proxima_tentativa_em = now() + (interval '30 seconds' * power(2, e.tentativas - 1)) where id = p_id;
  elsif p_resultado = 'incerto' then
    update public.whatsapp_envios set estado = 'incerto', travado_ate = null, ultimo_erro = left(p_erro, 300) where id = p_id;
  else
    update public.whatsapp_envios set estado = 'falhou', travado_ate = null, ultimo_erro = left(p_erro, 300) where id = p_id;
  end if;
end $$;

-- ─── retenção: 90 dias ───────────────────────────────────────────────────────
create or replace function public.whatsapp_limpar_antigos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare m integer; e integer; c integer;
begin
  delete from public.whatsapp_mensagens where criado_em < now() - interval '90 days';
  get diagnostics m = row_count;
  delete from public.whatsapp_envios where criado_em < now() - interval '90 days' and estado not in ('pendente', 'enviando');
  get diagnostics e = row_count;
  delete from public.whatsapp_conversas c2 where coalesce(c2.ultima_mensagem_em, c2.criado_em) < now() - interval '90 days'
     and not exists (select 1 from public.whatsapp_mensagens m2 where m2.conversa_id = c2.id);
  get diagnostics c = row_count;
  return jsonb_build_object('mensagens', m, 'envios', e, 'conversas', c);
end $$;

revoke all on function public.whatsapp_registrar_entrada(uuid, text, text, boolean, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.whatsapp_reivindicar_envios(integer, uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_concluir_envio(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_limpar_antigos() from public, anon, authenticated;
