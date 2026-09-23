-- ============================================================================
-- 0090 — Impressão: fila de trabalhos (pré-conta e teste de impressora)
--
-- A ficha da cozinha continua na fila antiga (pedidos.impresso / reservas da 0086).
-- Esta fila é para documentos que NÃO são pedido: a pré-conta de uma comanda e o
-- teste de impressora.
--
-- Garantias:
--   · o SNAPSHOT (tudo o que sai no papel) é montado aqui, no banco, com a comanda
--     travada, a partir de comanda_totais — o navegador manda só comanda + chave;
--   · snapshot, destino, via e autor são IMUTÁVEIS depois de criados (trigger);
--   · destino resolvido pela função `caixa` da loja — sem função, erro claro;
--     nunca cai na impressora da cozinha;
--   · reserva por agente autenticado, FOR UPDATE SKIP LOCKED, 60 s; abandonada
--     volta; 5 tentativas e vira `falhou`; pré-conta com mais de 10 min vira
--     `expirado` e NUNCA é impressa depois disso;
--   · `enviado_spooler` quer dizer "o Windows aceitou" — não que o papel saiu.
-- ============================================================================

create table if not exists public.impressao_trabalhos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  tipo text not null check (tipo in ('pre_conta', 'teste_impressora')),
  comanda_id uuid references public.comandas(id) on delete cascade,
  dispositivo_id uuid not null references public.impressao_dispositivos(id) on delete cascade,
  agente_id uuid not null references public.impressao_agentes(id) on delete cascade,
  snapshot jsonb not null,
  via int not null default 1 check (via >= 1),
  chave text not null check (length(chave) between 8 and 64),
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_por_nome text not null,
  criado_em timestamptz not null default now(),
  estado text not null default 'pendente'
    check (estado in ('pendente', 'reservado', 'enviado_spooler', 'falhou', 'expirado', 'cancelado')),
  tentativas int not null default 0,
  erro text,
  reservado_ate timestamptz,
  enviado_em timestamptz,
  expira_em timestamptz not null,
  unique (restaurante_id, chave),
  check (tipo <> 'pre_conta' or comanda_id is not null)
);
create index if not exists idx_impressao_trabalhos_agente on public.impressao_trabalhos (agente_id, estado);
create index if not exists idx_impressao_trabalhos_comanda on public.impressao_trabalhos (comanda_id, criado_em desc);
alter table public.impressao_trabalhos enable row level security;
revoke all on public.impressao_trabalhos from anon, authenticated;

-- O que foi impresso não muda: só estado, tentativas, erro e carimbos de entrega.
create or replace function public.impressao_trabalho_imutavel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.snapshot is distinct from old.snapshot or new.tipo is distinct from old.tipo
     or new.comanda_id is distinct from old.comanda_id or new.dispositivo_id is distinct from old.dispositivo_id
     or new.agente_id is distinct from old.agente_id or new.via is distinct from old.via
     or new.chave is distinct from old.chave or new.restaurante_id is distinct from old.restaurante_id
     or new.criado_por is distinct from old.criado_por or new.criado_por_nome is distinct from old.criado_por_nome
     or new.criado_em is distinct from old.criado_em or new.expira_em is distinct from old.expira_em then
    raise exception 'trabalho_imutavel' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists impressao_trabalho_imutavel on public.impressao_trabalhos;
create trigger impressao_trabalho_imutavel before update on public.impressao_trabalhos
  for each row execute function public.impressao_trabalho_imutavel();

-- ─── snapshot da pré-conta ──────────────────────────────────────────────────
create or replace function public.impressao_snapshot_pre_conta(p_comanda uuid, p_via int, p_operador text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  t record;
  v_itens jsonb;
  v_cancelados jsonb;
  v_pagamentos jsonb;
begin
  select co.id, co.tipo, co.numero, co.senha, co.cliente_nome, co.aberta_em, co.taxa_servico_percentual,
         m.nome as mesa_nome, r.nome as loja_nome
    into c
    from public.comandas co
    join public.restaurantes r on r.id = co.restaurante_id
    left join public.mesas m on m.id = co.mesa_id
   where co.id = p_comanda;
  select * into t from public.comanda_totais(p_comanda);

  select coalesce(jsonb_agg(jsonb_build_object(
           'quantidade', i.quantidade, 'nome', i.nome,
           'tamanho', nullif(i.tamanho_nome, ''), 'sabor', nullif(i.sabor_nome, ''),
           'borda', nullif(i.borda_nome, ''), 'massa', nullif(i.massa_nome, ''),
           'complementos', coalesce((select jsonb_agg(jsonb_build_object('nome', x->>'nome', 'preco', round(coalesce((x->>'preco')::numeric, 0), 2)))
                                       from jsonb_array_elements(coalesce(i.complementos, '[]'::jsonb)) x), '[]'::jsonb),
           'preco_unitario', round(i.preco_unitario, 2),
           'subtotal', round(i.preco_unitario * i.quantidade, 2))
           order by p.criado_em, p.numero, i.id), '[]'::jsonb)
    into v_itens
    from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
   where p.comanda_id = p_comanda and p.status <> 'cancelado' and i.cancelado_em is null;

  select coalesce(jsonb_agg(jsonb_build_object('quantidade', i.quantidade, 'nome', i.nome) order by p.criado_em, i.id), '[]'::jsonb)
    into v_cancelados
    from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
   where p.comanda_id = p_comanda and (p.status = 'cancelado' or i.cancelado_em is not null);

  select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', soma) order by forma), '[]'::jsonb)
    into v_pagamentos
    from (select forma, round(sum(valor), 2) as soma from public.pagamentos_comanda
           where comanda_id = p_comanda and estornado_em is null group by forma) f;

  return jsonb_build_object(
    'versao', 1,
    'loja', c.loja_nome,
    'tipo', c.tipo,
    'mesa', c.mesa_nome,
    'comanda_numero', c.numero,
    'senha', c.senha,
    'cliente_nome', case when c.tipo = 'balcao' then c.cliente_nome end,
    'aberta_em', c.aberta_em,
    'impresso_em', now(),
    'operador', p_operador,
    'via', p_via,
    'itens', v_itens,
    'cancelados', v_cancelados,
    'subtotal', t.subtotal,
    'taxa_percentual', c.taxa_servico_percentual,
    'taxa', t.taxa_servico,
    'desconto', t.desconto,
    'total', t.total,
    'pago', t.pago,
    'restante', t.restante,
    'pagamentos', v_pagamentos);
end $$;

-- ─── criar pré-conta ────────────────────────────────────────────────────────
create or replace function public.impressao_pre_conta_criar(
  p_restaurante uuid, p_comanda uuid, p_chave text, p_reimpressao boolean, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  j record;
  d record;
  v_via int;
  v_id uuid;
begin
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;

  -- Mesma chave (clique duplo, reenvio): o mesmo trabalho.
  select id, via, estado into j from public.impressao_trabalhos where restaurante_id = p_restaurante and chave = p_chave;
  if j.id is not null then
    return jsonb_build_object('id', j.id, 'via', j.via, 'estado', j.estado, 'idempotente', true);
  end if;

  -- Trava a comanda: o snapshot sai coerente com pagamentos e ajustes concorrentes.
  select id, status into c from public.comandas where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;
  if c.status not in ('aberta', 'fechada') then raise exception 'comanda_indisponivel'; end if;

  -- Duas abas / dois operadores pedindo a PRIMEIRA via ao mesmo tempo: um trabalho só.
  if not coalesce(p_reimpressao, false) then
    select id, via, estado into j from public.impressao_trabalhos
     where comanda_id = p_comanda and tipo = 'pre_conta' and criado_em > now() - interval '10 seconds'
       and estado in ('pendente', 'reservado', 'enviado_spooler')
     order by criado_em desc limit 1;
    if j.id is not null then
      return jsonb_build_object('id', j.id, 'via', j.via, 'estado', j.estado, 'idempotente', true);
    end if;
  end if;

  select dsp.id, dsp.agente_id, dsp.apelido, dsp.nome_sistema, a.revogado_em into d
    from public.impressao_funcoes f
    join public.impressao_dispositivos dsp on dsp.id = f.dispositivo_id
    join public.impressao_agentes a on a.id = dsp.agente_id
   where f.restaurante_id = p_restaurante and f.funcao = 'caixa';
  if d.id is null then raise exception 'impressora_caixa_nao_configurada'; end if;
  if d.revogado_em is not null then raise exception 'impressora_caixa_indisponivel'; end if;

  select count(*) + 1 into v_via from public.impressao_trabalhos where comanda_id = p_comanda and tipo = 'pre_conta';

  insert into public.impressao_trabalhos
    (restaurante_id, tipo, comanda_id, dispositivo_id, agente_id, snapshot, via, chave, criado_por, criado_por_nome, expira_em)
  values
    (p_restaurante, 'pre_conta', p_comanda, d.id, d.agente_id,
     public.impressao_snapshot_pre_conta(p_comanda, v_via, p_ator_nome), v_via, p_chave, p_ator, p_ator_nome,
     now() + interval '10 minutes')
  returning id into v_id;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'impressao.pre_conta', 'comanda', p_comanda,
    jsonb_build_object('trabalho_id', v_id, 'via', v_via, 'reimpressao', v_via > 1,
                       'impressora', coalesce(d.apelido, d.nome_sistema),
                       'resumo', case when v_via > 1 then v_via || 'ª via' else '1ª via' end || ' · ' || coalesce(d.apelido, d.nome_sistema)));

  return jsonb_build_object('id', v_id, 'via', v_via, 'estado', 'pendente', 'idempotente', false,
                            'impressora', coalesce(d.apelido, d.nome_sistema));
end $$;

-- ─── teste de impressora ────────────────────────────────────────────────────
create or replace function public.impressao_teste_criar(
  p_restaurante uuid, p_dispositivo uuid, p_chave text, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  j record;
  v_id uuid;
begin
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;
  select id, estado into j from public.impressao_trabalhos where restaurante_id = p_restaurante and chave = p_chave;
  if j.id is not null then return jsonb_build_object('id', j.id, 'estado', j.estado, 'idempotente', true); end if;

  select dsp.id, dsp.agente_id, dsp.apelido, dsp.nome_sistema, dsp.largura_mm, a.revogado_em, a.nome as agente_nome, r.nome as loja
    into d
    from public.impressao_dispositivos dsp
    join public.impressao_agentes a on a.id = dsp.agente_id
    join public.restaurantes r on r.id = dsp.restaurante_id
   where dsp.id = p_dispositivo and dsp.restaurante_id = p_restaurante;
  if d.id is null then raise exception 'dispositivo_inexistente'; end if;
  if d.revogado_em is not null then raise exception 'impressora_caixa_indisponivel'; end if;

  insert into public.impressao_trabalhos
    (restaurante_id, tipo, dispositivo_id, agente_id, snapshot, chave, criado_por, criado_por_nome, expira_em)
  values
    (p_restaurante, 'teste_impressora', d.id, d.agente_id,
     jsonb_build_object('versao', 1, 'loja', d.loja, 'impressora', coalesce(d.apelido, d.nome_sistema),
                        'nome_sistema', d.nome_sistema, 'computador', d.agente_nome, 'largura_mm', d.largura_mm,
                        'operador', p_ator_nome, 'impresso_em', now()),
     p_chave, p_ator, p_ator_nome, now() + interval '10 minutes')
  returning id into v_id;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'impressao.teste', 'impressao_dispositivo', d.id,
    jsonb_build_object('trabalho_id', v_id, 'impressora', coalesce(d.apelido, d.nome_sistema), 'resumo', coalesce(d.apelido, d.nome_sistema)));
  return jsonb_build_object('id', v_id, 'estado', 'pendente', 'idempotente', false);
end $$;

-- ─── reserva pelo agente ────────────────────────────────────────────────────
create or replace function public.impressao_trabalhos_reservar(p_agente uuid, p_limite int)
returns table (id uuid, tipo text, via int, snapshot jsonb, nome_sistema text, largura_mm int, dispositivo_id uuid,
               segundos_restantes int, tentativas int)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Vencidos nunca saem: cliente pode já ter ido embora.
  update public.impressao_trabalhos t set estado = 'expirado', reservado_ate = null
   where t.agente_id = p_agente and t.estado in ('pendente', 'reservado') and t.expira_em <= now();
  -- Reservado e abandonado depois da 5ª tentativa: falhou.
  update public.impressao_trabalhos t set estado = 'falhou', erro = coalesce(t.erro, 'sem confirmação do Assistente após 5 tentativas')
   where t.agente_id = p_agente and t.estado = 'reservado' and t.reservado_ate < now() and t.tentativas >= 5;

  return query
  with alvo as (
    select t.id from public.impressao_trabalhos t
      join public.impressao_agentes a on a.id = t.agente_id and a.revogado_em is null
     where t.agente_id = p_agente
       and (t.estado = 'pendente' or (t.estado = 'reservado' and t.reservado_ate < now()))
       and t.tentativas < 5 and t.expira_em > now()
     order by t.criado_em
     for update of t skip locked
     limit greatest(1, least(coalesce(p_limite, 10), 20))
  ),
  upd as (
    update public.impressao_trabalhos t
       set estado = 'reservado', tentativas = t.tentativas + 1, reservado_ate = now() + interval '60 seconds'
      from alvo where t.id = alvo.id
    returning t.id, t.tipo, t.via, t.snapshot, t.dispositivo_id, t.expira_em, t.tentativas, t.criado_em
  )
  select u.id, u.tipo, u.via, u.snapshot, dsp.nome_sistema, dsp.largura_mm, u.dispositivo_id,
         greatest(0, extract(epoch from (u.expira_em - now()))::int), u.tentativas
    from upd u join public.impressao_dispositivos dsp on dsp.id = u.dispositivo_id
   order by u.criado_em;
end $$;

-- ─── resultado informado pelo agente ────────────────────────────────────────
create or replace function public.impressao_trabalho_resultado(p_agente uuid, p_trabalho uuid, p_ok boolean, p_erro text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_estado text;
begin
  select * into t from public.impressao_trabalhos where id = p_trabalho and agente_id = p_agente for update;
  if t.id is null then raise exception 'trabalho_inexistente'; end if;

  if t.estado in ('enviado_spooler', 'falhou', 'cancelado') then
    return jsonb_build_object('id', t.id, 'estado', t.estado, 'ignorado', true);
  end if;

  if p_ok then
    -- Mesmo vencido: se o agente diz que o Windows aceitou, é o fato que registramos.
    update public.impressao_trabalhos set estado = 'enviado_spooler', enviado_em = now(), erro = null, reservado_ate = null where id = t.id;
    update public.impressao_dispositivos set ultimo_uso_em = now(), disponivel = true where id = t.dispositivo_id;
    v_estado := 'enviado_spooler';
  else
    v_estado := case when t.estado = 'expirado' then 'expirado' when t.tentativas >= 5 then 'falhou' else 'pendente' end;
    update public.impressao_trabalhos
       set estado = v_estado, erro = left(coalesce(nullif(btrim(p_erro), ''), 'erro sem descrição'), 300), reservado_ate = null
     where id = t.id;
    update public.impressao_dispositivos
       set ultimo_erro = left(coalesce(nullif(btrim(p_erro), ''), 'erro sem descrição'), 300), ultimo_erro_em = now()
     where id = t.dispositivo_id;
  end if;
  return jsonb_build_object('id', t.id, 'estado', v_estado, 'ignorado', false);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'impressao_snapshot_pre_conta(uuid,int,text)',
    'impressao_pre_conta_criar(uuid,uuid,text,boolean,uuid,text)',
    'impressao_teste_criar(uuid,uuid,text,uuid,text)',
    'impressao_trabalhos_reservar(uuid,int)',
    'impressao_trabalho_resultado(uuid,uuid,boolean,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
