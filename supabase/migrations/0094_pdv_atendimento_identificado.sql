-- ============================================================================
-- 0094 — PDV v2: atendimento identificado (mesa e balcão) e entrega manual
--
-- 1. Nome obrigatório para ABRIR atendimento de mesa em loja com pdv_v2 — no banco,
--    além da tela e da API. Comanda antiga sem nome continua legível; o próximo
--    lançamento (ou o fechamento) pede o nome antes. Nenhum NOT NULL em dado antigo,
--    nenhum nome inventado.
-- 2. Telefone opcional, normalizado (DDI 55 + DDD + número), vinculado ao cadastro
--    `clientes` DA MESMA LOJA (cria se não existir; nunca sobrescreve nome existente).
--    Sem telefone: nome fica só como snapshot, nunca vincula por nome.
-- 3. Entrega manual pelo mesmo card "Balcão": comanda de balcão com `entrega = true`,
--    endereço no mesmo formato do delivery (pedidos.endereco_*), taxa de entrega da
--    conta. Os pedidos dela saem `tipo = 'entrega'` e seguem para a logística (única
--    exceção à regra "presencial nunca vai para em rota").
-- 4. `pedidos.lancado_via` ('pdv' | 'salao'): de onde saiu o lançamento de mesa, só
--    para a etiqueta do Kanban. Pedido antigo fica NULL e mantém o rótulo de sempre.
-- 5. Mesa só abre ativa, desbloqueada e fora de limpeza (0095) — agora também no banco,
--    para todo caminho (inclusive o PDV antigo, que não conferia bloqueio).
--
-- Tudo aditivo: colunas novas com default constante (sem reescrever tabela), funções
-- novas, e redefinições que preservam o comportamento de lojas sem pdv_v2.
-- ============================================================================

-- ─── 1. colunas ────────────────────────────────────────────────────────────────
alter table public.comandas add column if not exists cliente_id uuid references public.clientes(id) on delete set null;
alter table public.comandas add column if not exists entrega boolean not null default false;
alter table public.comandas add column if not exists entrega_cep text;
alter table public.comandas add column if not exists entrega_rua text;
alter table public.comandas add column if not exists entrega_numero text;
alter table public.comandas add column if not exists entrega_complemento text;
alter table public.comandas add column if not exists entrega_bairro text;
alter table public.comandas add column if not exists entrega_cidade text;
alter table public.comandas add column if not exists entrega_referencia text;
alter table public.comandas add column if not exists entrega_observacao text;
alter table public.comandas add column if not exists taxa_entrega numeric(10,2) not null default 0;
alter table public.comandas add column if not exists taxa_entrega_manual boolean not null default false;

alter table public.comandas drop constraint if exists comandas_entrega_so_balcao_check;
alter table public.comandas add constraint comandas_entrega_so_balcao_check
  check (not entrega or tipo = 'balcao');
alter table public.comandas drop constraint if exists comandas_taxa_entrega_check;
alter table public.comandas add constraint comandas_taxa_entrega_check
  check (taxa_entrega >= 0 and (entrega or taxa_entrega = 0));
alter table public.comandas drop constraint if exists comandas_entrega_endereco_check;
alter table public.comandas add constraint comandas_entrega_endereco_check
  check (not entrega or (nullif(btrim(coalesce(entrega_rua, '')), '') is not null
                         and nullif(btrim(coalesce(entrega_numero, '')), '') is not null
                         and nullif(btrim(coalesce(entrega_bairro, '')), '') is not null));
-- Estado "em limpeza" da mesa (lógica na 0095; colunas aqui porque a guarda de abertura já as lê).
alter table public.mesas add column if not exists limpeza_desde timestamptz;
-- Sem FK de propósito: uma segunda relação mesas↔comandas deixaria ambíguos os embeds
-- `comandas → mesas ( nome )` que o código já usa (PostgREST PGRST201).
alter table public.mesas add column if not exists limpeza_comanda_id uuid;
alter table public.mesas add column if not exists limpeza_cliente_nome text;
alter table public.mesas add column if not exists limpeza_fechada_por_nome text;
alter table public.mesas add column if not exists liberada_em timestamptz;
alter table public.mesas add column if not exists liberada_por_nome text;
-- mesas tem grant por coluna (0071): o painel lê o estado de limpeza; escrever, só o servidor.
grant select (limpeza_desde, limpeza_comanda_id, limpeza_cliente_nome, limpeza_fechada_por_nome, liberada_em, liberada_por_nome)
  on public.mesas to authenticated;

create index if not exists idx_comandas_cliente on public.comandas (cliente_id) where cliente_id is not null;

alter table public.pedidos add column if not exists lancado_via text;
alter table public.pedidos drop constraint if exists pedidos_lancado_via_check;
alter table public.pedidos add constraint pedidos_lancado_via_check check (lancado_via is null or lancado_via in ('pdv', 'salao'));

-- ─── 2. telefone e cadastro do cliente ─────────────────────────────────────────
-- Mesma regra de lib/telefone-br.ts (telefoneWhatsapp): decide pelo COMPRIMENTO.
create or replace function public.telefone_br_normalizar(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when length(d) in (10, 11) then '55' || d
    when length(d) in (12, 13) and left(d, 2) = '55' then d
    else null end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

-- Cliente da loja pelo telefone já normalizado: acha ou cria. Nunca troca o nome de
-- quem já existe, nunca olha outra loja.
create or replace function public.cliente_vincular(p_restaurante uuid, p_telefone text, p_nome text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_telefone is null then return null; end if;
  select id into v_id from public.clientes where restaurante_id = p_restaurante and telefone = p_telefone;
  if v_id is not null then return v_id; end if;
  insert into public.clientes (restaurante_id, telefone, nome)
  values (p_restaurante, p_telefone, left(coalesce(btrim(p_nome), ''), 120))
  on conflict (restaurante_id, telefone) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.clientes where restaurante_id = p_restaurante and telefone = p_telefone;
  end if;
  return v_id;
end $$;

-- ─── 3. guarda de abertura (todo caminho que cria comanda de mesa) ─────────────
create or replace function public.comanda_validar_abertura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_v2 boolean;
begin
  if new.tipo <> 'mesa' then return new; end if;
  -- Trava a mesa: duas aberturas simultâneas esperam uma pela outra (o índice único
  -- de comanda aberta por mesa continua sendo a última linha de defesa).
  select ativa, bloqueada_em, limpeza_desde into m
    from public.mesas where id = new.mesa_id and restaurante_id = new.restaurante_id for update;
  if not found then raise exception 'mesa_inexistente' using errcode = 'P0001'; end if;
  if m.ativa = false or m.bloqueada_em is not null then raise exception 'mesa_indisponivel' using errcode = 'P0001'; end if;
  if m.limpeza_desde is not null then raise exception 'mesa_em_limpeza' using errcode = 'P0001'; end if;
  select coalesce(pdv_v2, false) into v_v2 from public.restaurantes where id = new.restaurante_id;
  if v_v2 and nullif(btrim(coalesce(new.cliente_nome, '')), '') is null then
    raise exception 'nome_obrigatorio' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ─── 4. lançamento só em comanda identificada (pdv_v2) ─────────────────────────
create or replace function public.pedidos_exige_comanda_aberta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_v2 boolean;
begin
  if new.comanda_id is null then return new; end if;
  select status, restaurante_id, tipo, cliente_nome into c
    from public.comandas where id = new.comanda_id for update;
  if c.restaurante_id is null or c.restaurante_id <> new.restaurante_id then
    raise exception 'comanda_inexistente' using errcode = 'P0001';
  end if;
  if c.status <> 'aberta' then
    raise exception 'comanda_nao_aberta' using errcode = 'P0001';
  end if;
  -- Comanda antiga de mesa, aberta sem nome: o próximo lançamento pede o nome antes.
  if c.tipo = 'mesa' and nullif(btrim(coalesce(c.cliente_nome, '')), '') is null then
    select coalesce(pdv_v2, false) into v_v2 from public.restaurantes where id = new.restaurante_id;
    if v_v2 then raise exception 'comanda_sem_nome' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

-- ─── 5. presencial não vai para "em rota" — exceto a entrega manual ────────────
create or replace function public.pedidos_transicao_valida()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_presencial boolean := new.canal in ('mesa', 'balcao');
begin
  if new.status is not distinct from old.status then return new; end if;

  if old.status = 'cancelado'
     or (old.status = 'entregue' and not (v_presencial and new.status = 'cancelado')) then
    raise exception 'transicao_invalida:%>%', old.status, new.status using errcode = 'P0001';
  end if;
  -- Balcão com dados de entrega (0094) é o único presencial que sai para entrega.
  if v_presencial and new.status = 'em_rota' and not (new.canal = 'balcao' and new.tipo = 'entrega') then
    raise exception 'transicao_invalida:%>%', old.status, new.status using errcode = 'P0001';
  end if;

  if new.status = 'cancelado' then
    new.reimprimir := false;
  end if;

  if new.status = 'entregue' and new.atendimento_status in ('aguardando_servico', 'aguardando_retirada') then
    new.atendimento_status := case when new.atendimento_status = 'aguardando_servico' then 'servido' else 'entregue_balcao' end;
    new.atendido_em := coalesce(new.atendido_em, now());
    if new.atendido_por is null then
      select u.id, u.nome into new.atendido_por, new.atendido_por_nome
        from public.usuarios u where u.id = auth.uid();
    end if;
  end if;
  return new;
end $$;

-- ─── 6. totais da conta: taxa de entrega entra no total ───────────────────────
-- Sem entrega, taxa_entrega = 0 (constraint) e o resultado é idêntico ao de antes.
create or replace function public.comanda_totais(p_comanda uuid)
returns table(subtotal numeric, taxa_servico numeric, desconto numeric, total numeric, pago numeric, restante numeric)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select coalesce(sum(i.preco_unitario * i.quantidade), 0)::numeric as sub
      from public.pedidos p
      join public.pedido_itens i on i.pedido_id = p.id
     where p.comanda_id = p_comanda
       and p.status <> 'cancelado'
       and i.cancelado_em is null
  ),
  c as (
    select taxa_servico_percentual as pct, desconto_tipo as tipo, desconto_valor as desc_valor,
           desconto_percentual as desc_pct, coalesce(taxa_entrega, 0) as entrega
      from public.comandas where id = p_comanda
  ),
  pg as (
    select coalesce(sum(valor), 0)::numeric as pago
      from public.pagamentos_comanda where comanda_id = p_comanda and estornado_em is null
  ),
  bruto as (
    select round(base.sub, 2) as sub,
           round(base.sub * c.pct / 100, 2) as taxa,
           case when c.tipo = 'percentual' then round(base.sub * c.desc_pct / 100, 2)
                else c.desc_valor end as desc_pedido,
           c.entrega,
           pg.pago
      from base, c, pg
  ),
  calc as (
    select sub, taxa, least(desc_pedido, sub + taxa) as desc_aplicado, entrega, pago from bruto
  )
  select sub, taxa, desc_aplicado, round(sub + taxa + entrega - desc_aplicado, 2), pago,
         greatest(round(sub + taxa + entrega - desc_aplicado - pago, 2), 0)
    from calc
$$;

-- ─── 7. abrir balcão (nome, telefone, entrega opcional) ────────────────────────
-- p_entrega: null (balcão comum) ou {cep, rua, numero, complemento, bairro, cidade,
-- referencia, observacao, taxa, taxa_manual}. A taxa chega decidida pelo servidor
-- (tabela de frete da loja ou valor manual do operador) — nunca do navegador cru.
create or replace function public.comanda_balcao_abrir(
  p_restaurante uuid, p_nome text, p_telefone text, p_ator uuid, p_ator_nome text, p_chave text,
  p_entrega jsonb, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := nullif(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), '');
  v_tel text := public.telefone_br_normalizar(p_telefone);
  v_cliente uuid;
  v_ent boolean := p_entrega is not null and jsonb_typeof(p_entrega) = 'object';
  v_taxa numeric := 0;
  v record;
  t text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
begin
  if v_nome is null then raise exception 'nome_obrigatorio'; end if;
  if length(v_nome) > 60 then raise exception 'nome_longo'; end if;
  if t is not null and v_tel is null then raise exception 'telefone_invalido'; end if;
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;

  select id, senha, numero into v from public.comandas
   where restaurante_id = p_restaurante and chave_abertura = p_chave;
  if v.id is not null then
    return jsonb_build_object('id', v.id, 'senha', v.senha, 'numero', v.numero, 'idempotente', true);
  end if;

  if v_ent then
    v_taxa := round(coalesce((p_entrega->>'taxa')::numeric, -1), 2);
    if v_taxa < 0 then raise exception 'taxa_entrega_invalida'; end if;
    if nullif(btrim(coalesce(p_entrega->>'rua', '')), '') is null
       or nullif(btrim(coalesce(p_entrega->>'numero', '')), '') is null
       or nullif(btrim(coalesce(p_entrega->>'bairro', '')), '') is null then
      raise exception 'endereco_incompleto';
    end if;
  end if;

  v_cliente := public.cliente_vincular(p_restaurante, v_tel, v_nome);

  begin
    insert into public.comandas
      (restaurante_id, tipo, mesa_id, cliente_nome, cliente_telefone, cliente_id, aberta_por, aberta_por_nome,
       responsavel_id, responsavel_nome, chave_abertura,
       entrega, entrega_cep, entrega_rua, entrega_numero, entrega_complemento, entrega_bairro, entrega_cidade,
       entrega_referencia, entrega_observacao, taxa_entrega, taxa_entrega_manual)
    values
      (p_restaurante, 'balcao', null, v_nome, v_tel, v_cliente, p_ator, p_ator_nome, p_ator, p_ator_nome, p_chave,
       v_ent,
       case when v_ent then left(btrim(p_entrega->>'cep'), 20) end,
       case when v_ent then left(btrim(p_entrega->>'rua'), 200) end,
       case when v_ent then left(btrim(p_entrega->>'numero'), 20) end,
       case when v_ent then left(nullif(btrim(p_entrega->>'complemento'), ''), 200) end,
       case when v_ent then left(btrim(p_entrega->>'bairro'), 120) end,
       case when v_ent then left(nullif(btrim(p_entrega->>'cidade'), ''), 120) end,
       case when v_ent then left(nullif(btrim(p_entrega->>'referencia'), ''), 200) end,
       case when v_ent then left(nullif(btrim(p_entrega->>'observacao'), ''), 300) end,
       v_taxa, v_ent and coalesce((p_entrega->>'taxa_manual')::boolean, false))
    returning id, senha, numero into v;
  exception when unique_violation then
    select id, senha, numero into v from public.comandas
     where restaurante_id = p_restaurante and chave_abertura = p_chave;
    return jsonb_build_object('id', v.id, 'senha', v.senha, 'numero', v.numero, 'idempotente', true);
  end;

  -- Telefone e endereço NÃO vão para a auditoria: são dados do cliente, ficam na comanda.
  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'balcao.abriu', 'comanda', v.id,
    jsonb_build_object('senha', v.senha, 'nome', v_nome, 'de', 'nova', 'para', 'aberta', 'origem', coalesce(p_origem, 'pdv'),
                       'telefone_informado', v_tel is not null, 'cliente_vinculado', v_cliente is not null,
                       'entrega', v_ent,
                       'resumo', 'Senha ' || v.senha || ' · ' || v_nome || case when v_ent then ' · entrega' else '' end));
  if v_ent then
    perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'balcao.entrega_ativada', 'comanda', v.id,
      jsonb_build_object('senha', v.senha, 'bairro', btrim(p_entrega->>'bairro'), 'taxa_entrega', v_taxa,
                         'taxa_manual', coalesce((p_entrega->>'taxa_manual')::boolean, false), 'origem', coalesce(p_origem, 'pdv'),
                         'resumo', 'Entrega · taxa R$ ' || to_char(v_taxa, 'FM999990.00')
                                   || case when coalesce((p_entrega->>'taxa_manual')::boolean, false) then ' (manual)' else '' end));
  end if;

  return jsonb_build_object('id', v.id, 'senha', v.senha, 'numero', v.numero, 'idempotente', false);
end $$;

-- Assinatura antiga (0085): balcão comum, sem entrega.
create or replace function public.comanda_balcao_abrir(
  p_restaurante uuid, p_nome text, p_telefone text, p_ator uuid, p_ator_nome text, p_chave text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.comanda_balcao_abrir(p_restaurante, p_nome, p_telefone, p_ator, p_ator_nome, p_chave, null, 'pdv');
$$;

-- ─── 8. abrir mesa (nome obrigatório, telefone opcional) ───────────────────────
create or replace function public.comanda_mesa_abrir(
  p_restaurante uuid, p_mesa uuid, p_nome text, p_telefone text, p_ator uuid, p_ator_nome text, p_chave text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := nullif(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), '');
  v_tel text := public.telefone_br_normalizar(p_telefone);
  t text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  m record;
  v record;
  v_aberta uuid;
  v_cliente uuid;
begin
  if v_nome is null then raise exception 'nome_obrigatorio'; end if;
  if length(v_nome) > 60 then raise exception 'nome_longo'; end if;
  if t is not null and v_tel is null then raise exception 'telefone_invalido'; end if;
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;

  -- Trava a mesa primeiro: o segundo operador espera o primeiro terminar e então vê a
  -- comanda dele (mesa_ocupada) — nunca duas sessões.
  select id, nome, ativa, bloqueada_em, limpeza_desde into m
    from public.mesas where id = p_mesa and restaurante_id = p_restaurante for update;
  if m.id is null then raise exception 'mesa_inexistente'; end if;

  select id, numero into v from public.comandas where restaurante_id = p_restaurante and chave_abertura = p_chave;
  if v.id is not null then
    return jsonb_build_object('id', v.id, 'numero', v.numero, 'idempotente', true);
  end if;

  if m.ativa = false or m.bloqueada_em is not null then raise exception 'mesa_indisponivel'; end if;
  if m.limpeza_desde is not null then raise exception 'mesa_em_limpeza'; end if;
  select id into v_aberta from public.comandas where mesa_id = p_mesa and status = 'aberta';
  if v_aberta is not null then raise exception 'mesa_ocupada:%', v_aberta; end if;

  v_cliente := public.cliente_vincular(p_restaurante, v_tel, v_nome);
  insert into public.comandas
    (restaurante_id, tipo, mesa_id, cliente_nome, cliente_telefone, cliente_id, aberta_por, aberta_por_nome,
     responsavel_id, responsavel_nome, chave_abertura)
  values
    (p_restaurante, 'mesa', p_mesa, v_nome, v_tel, v_cliente, p_ator, p_ator_nome, p_ator, p_ator_nome, p_chave)
  returning id, numero into v;

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'mesa.abriu', 'comanda', v.id,
    jsonb_build_object('mesa', m.nome, 'nome', v_nome, 'de', 'livre', 'para', 'ocupada', 'numero', v.numero,
                       'origem', coalesce(p_origem, 'pdv'), 'telefone_informado', v_tel is not null,
                       'cliente_vinculado', v_cliente is not null,
                       'resumo', m.nome || ' · ' || v_nome));
  return jsonb_build_object('id', v.id, 'numero', v.numero, 'idempotente', false);
end $$;

-- ─── 9. corrigir nome/telefone do atendimento ──────────────────────────────────
create or replace function public.comanda_identificar(
  p_restaurante uuid, p_comanda uuid, p_nome text, p_telefone text, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := nullif(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), '');
  v_tel text := public.telefone_br_normalizar(p_telefone);
  t text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
  c record;
  v_cliente uuid;
begin
  if v_nome is null then raise exception 'nome_obrigatorio'; end if;
  if length(v_nome) > 60 then raise exception 'nome_longo'; end if;
  if t is not null and v_tel is null then raise exception 'telefone_invalido'; end if;

  select id, status, tipo, cliente_nome, cliente_telefone, senha, mesa_id into c
    from public.comandas where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  if c.cliente_nome is not distinct from v_nome and c.cliente_telefone is not distinct from v_tel then
    return jsonb_build_object('id', c.id, 'idempotente', true);
  end if;

  v_cliente := public.cliente_vincular(p_restaurante, v_tel, v_nome);
  update public.comandas set cliente_nome = v_nome, cliente_telefone = v_tel, cliente_id = v_cliente where id = c.id;
  -- Os pedidos desta conta são o mesmo atendimento: levam a identificação corrigida
  -- (histórico do cliente e etiqueta do Kanban). Cancelados ficam como estavam.
  update public.pedidos set cliente_nome = left(v_nome, 120), cliente_telefone = coalesce(v_tel, '')
   where comanda_id = c.id and status <> 'cancelado';

  perform public.auditoria_registrar(p_restaurante, p_ator, p_ator_nome, 'comanda.identificou', 'comanda', c.id,
    jsonb_build_object('de', c.cliente_nome, 'para', v_nome, 'nome_anterior', c.cliente_nome, 'nome_novo', v_nome,
                       'telefone_alterado', c.cliente_telefone is distinct from v_tel,
                       'telefone_informado', v_tel is not null, 'cliente_vinculado', v_cliente is not null,
                       'origem', coalesce(p_origem, 'pdv'), 'senha', c.senha,
                       'resumo', coalesce(c.cliente_nome, '(sem nome)') || ' → ' || v_nome));
  return jsonb_build_object('id', c.id, 'idempotente', false);
end $$;

-- ─── 10. lançar (identificação e entrega viajam da conta para o pedido) ────────
create or replace function public.comanda_lancar(
  p_restaurante uuid, p_comanda uuid, p_pedido jsonb, p_itens jsonb, p_ator uuid, p_ator_nome text, p_chave text,
  p_lancado_via text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_mesa_nome text;
  v_existente record;
  v_id uuid;
  v_numero int;
  v_cliente text;
  v_primeiro boolean;
  v_taxa numeric := 0;
  v_sub numeric := (p_pedido->>'subtotal')::numeric;
begin
  if p_chave is null or p_chave !~* '^[0-9a-f-]{36}$' then raise exception 'chave_invalida'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'nenhum_item';
  end if;
  if p_lancado_via is not null and p_lancado_via not in ('pdv', 'salao') then raise exception 'origem_invalida'; end if;

  select * into c from public.comandas where id = p_comanda and restaurante_id = p_restaurante for update;
  if c.id is null then raise exception 'comanda_inexistente'; end if;

  select id, numero into v_existente from public.pedidos
   where restaurante_id = p_restaurante and chave_idempotencia = p_chave;
  if v_existente.id is not null then
    return jsonb_build_object('id', v_existente.id, 'numero', v_existente.numero, 'idempotente', true);
  end if;
  if c.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;

  if c.tipo = 'mesa' then
    select nome into v_mesa_nome from public.mesas where id = c.mesa_id;
    v_cliente := coalesce(nullif(btrim(c.cliente_nome), ''), nullif(btrim(p_pedido->>'cliente_nome'), ''), v_mesa_nome);
  else
    v_cliente := c.cliente_nome;
  end if;

  -- A taxa de entrega é da conta; o primeiro pedido a carrega para a ficha e a logística.
  if c.entrega then
    select not exists (select 1 from public.pedidos where comanda_id = c.id) into v_primeiro;
    if v_primeiro then v_taxa := c.taxa_entrega; end if;
  end if;

  insert into public.pedidos
    (restaurante_id, tipo, status, cliente_nome, cliente_telefone, telefone_verificado,
     forma_pagamento, troco_para, pago, subtotal, desconto, taxa_entrega, total, observacao,
     endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, endereco_cidade, endereco_referencia,
     origem, canal, mesa, comanda_id, criado_por, criado_por_nome, chave_idempotencia, lancado_via)
  values
    (p_restaurante, case when c.entrega then 'entrega'::tipo_pedido else 'retirada'::tipo_pedido end, 'recebido',
     left(v_cliente, 120), coalesce(c.cliente_telefone, ''), true,
     'dinheiro', null, false,
     v_sub, 0, v_taxa, round(v_sub + v_taxa, 2), coalesce(case when c.entrega then c.entrega_observacao end, ''),
     coalesce(case when c.entrega then c.entrega_rua end, ''), coalesce(case when c.entrega then c.entrega_numero end, ''),
     coalesce(case when c.entrega then c.entrega_complemento end, ''), coalesce(case when c.entrega then c.entrega_bairro end, ''),
     coalesce(case when c.entrega then c.entrega_cep end, ''), coalesce(case when c.entrega then c.entrega_cidade end, ''),
     coalesce(case when c.entrega then c.entrega_referencia end, ''),
     'pdv', c.tipo, v_mesa_nome, c.id, p_ator, p_ator_nome, p_chave, p_lancado_via)
  returning id, numero into v_id, v_numero;

  insert into public.pedido_itens
    (pedido_id, item_id, nome, preco_unitario, quantidade, observacao, complementos,
     tamanho_nome, sabor_nome, borda_nome, massa_nome)
  select v_id, x.item_id, x.nome, x.preco_unitario, x.quantidade, coalesce(x.observacao, ''),
         coalesce(x.complementos, '[]'::jsonb), coalesce(x.tamanho_nome, ''), coalesce(x.sabor_nome, ''),
         coalesce(x.borda_nome, ''), coalesce(x.massa_nome, '')
    from jsonb_to_recordset(p_itens) as x(
      item_id uuid, nome text, preco_unitario numeric, quantidade int, observacao text, complementos jsonb,
      tamanho_nome text, sabor_nome text, borda_nome text, massa_nome text);

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'idempotente', false);
end $$;

-- Assinatura antiga (0085): lançamento do PDV.
create or replace function public.comanda_lancar(
  p_restaurante uuid, p_comanda uuid, p_pedido jsonb, p_itens jsonb, p_ator uuid, p_ator_nome text, p_chave text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.comanda_lancar(p_restaurante, p_comanda, p_pedido, p_itens, p_ator, p_ator_nome, p_chave, 'pdv');
$$;

-- ─── 11. transferência de itens para mesa livre ────────────────────────────────
CREATE OR REPLACE FUNCTION public.itens_transferir(p_restaurante uuid, p_itens uuid[], p_destino uuid, p_ator uuid, p_ator_nome text, p_quantidades integer[], p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_comanda_destino uuid;
  v_destino_ativa boolean;
  v_destino_bloqueada timestamptz;
  v_destino_nome text;
  v_item uuid[] := '{}';
  v_pedido uuid[] := '{}';
  v_qtd_mover int[] := '{}';
  v_inteiro boolean[] := '{}';
  v_origens uuid[] := '{}';
  r record;
  v_movidos int := 0;
  v_ativos int;
  v_inteiros int;
  v_do_pedido int;
  v_pedido_destino uuid;
  i int;
  v_qtd int;
  v_linha record;
  v_origem uuid;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then raise exception 'motivo_obrigatorio'; end if;
  if coalesce(array_length(p_itens, 1), 0) = 0 then raise exception 'nenhum_item'; end if;
  if p_quantidades is not null
     and coalesce(array_length(p_quantidades, 1), 0) <> array_length(p_itens, 1) then
    raise exception 'quantidades_incompativeis';
  end if;

  select ativa, bloqueada_em, nome into v_destino_ativa, v_destino_bloqueada, v_destino_nome
    from public.mesas where id = p_destino and restaurante_id = p_restaurante;
  if v_destino_ativa is null then raise exception 'destino_inexistente'; end if;
  if v_destino_ativa = false then raise exception 'destino_inativo'; end if;
  if v_destino_bloqueada is not null then raise exception 'destino_bloqueado'; end if;

  select id into v_comanda_destino from public.comandas
   where restaurante_id = p_restaurante and mesa_id = p_destino and status = 'aberta' for update;
  if v_comanda_destino is null then
    -- 0094: a comanda nova do destino é o mesmo atendimento — leva nome/telefone/cliente
    -- da origem (loja com pdv_v2 não abre mesa sem nome).
    insert into public.comandas (restaurante_id, mesa_id, cliente_nome, cliente_telefone, cliente_id)
    select p_restaurante, p_destino, oc.cliente_nome, oc.cliente_telefone, oc.cliente_id
      from (select 1) x
      left join lateral (
        select c.cliente_nome, c.cliente_telefone, c.cliente_id
          from public.pedido_itens it join public.pedidos p on p.id = it.pedido_id join public.comandas c on c.id = p.comanda_id
         where it.id = any(p_itens) and p.restaurante_id = p_restaurante and c.cliente_nome is not null
         limit 1) oc on true
    returning id into v_comanda_destino;
  end if;

  for i in 1 .. array_length(p_itens, 1) loop
    if p_itens[i] = any(v_item) then continue; end if;

    select it.id, it.pedido_id, it.quantidade, p.comanda_id
      into v_linha
      from public.pedido_itens it
      join public.pedidos p on p.id = it.pedido_id
      join public.comandas c on c.id = p.comanda_id
     where it.id = p_itens[i]
       and it.cancelado_em is null
       and p.restaurante_id = p_restaurante
       and p.status <> 'cancelado'
       and c.status = 'aberta';
    if v_linha.id is null then continue; end if;
    if v_linha.comanda_id = v_comanda_destino then continue; end if;

    v_qtd := case when p_quantidades is null then v_linha.quantidade else p_quantidades[i] end;
    if v_qtd is null or v_qtd >= v_linha.quantidade then
      v_qtd := v_linha.quantidade;
    elsif v_qtd < 1 then
      raise exception 'quantidade_invalida';
    end if;

    v_item := v_item || v_linha.id;
    v_pedido := v_pedido || v_linha.pedido_id;
    v_qtd_mover := v_qtd_mover || v_qtd;
    v_inteiro := v_inteiro || (v_qtd = v_linha.quantidade);
    if not (v_linha.comanda_id = any(v_origens)) then v_origens := v_origens || v_linha.comanda_id; end if;
  end loop;

  -- Comandas de origem travadas em ordem fixa, antes de mexer em qualquer linha delas.
  perform 1 from public.comandas where id = any(v_origens) order by id for update;

  for r in select distinct pid from unnest(v_pedido) as pid order by pid loop
    perform 1 from public.pedidos where id = r.pid for update;

    select count(*) into v_ativos from public.pedido_itens
     where pedido_id = r.pid and cancelado_em is null;
    select count(*) into v_inteiros
      from unnest(v_pedido, v_inteiro) as t(pid, inteiro)
     where t.pid = r.pid and t.inteiro;
    select coalesce(sum(t.qtd), 0) into v_do_pedido
      from unnest(v_pedido, v_qtd_mover) as t(pid, qtd)
     where t.pid = r.pid;

    if v_inteiros = v_ativos then
      update public.pedidos
         set comanda_id = v_comanda_destino,
             cliente_nome = case when cliente_nome = mesa then v_destino_nome else cliente_nome end,
             mesa = v_destino_nome
       where id = r.pid;
      v_movidos := v_movidos + v_do_pedido;
      continue;
    end if;

    insert into public.pedidos
      (restaurante_id, tipo, status, cliente_nome, forma_pagamento, subtotal, total, origem, canal, mesa,
       comanda_id, impresso, criado_por, criado_por_nome)
    select p.restaurante_id, p.tipo, p.status, v_destino_nome, p.forma_pagamento, 0, 0, p.origem, 'mesa',
           v_destino_nome, v_comanda_destino, true, p_ator, p_ator_nome
      from public.pedidos p where p.id = r.pid
    returning id into v_pedido_destino;

    update public.pedido_itens set pedido_id = v_pedido_destino
     where pedido_id = r.pid
       and id in (
         select t.it_id from unnest(v_item, v_pedido, v_inteiro) as t(it_id, pid, inteiro)
          where t.pid = r.pid and t.inteiro
       );

    for v_linha in
      select it.*, t.qtd as mover
        from unnest(v_item, v_pedido, v_qtd_mover, v_inteiro) as t(it_id, pid, qtd, inteiro)
        join public.pedido_itens it on it.id = t.it_id
       where t.pid = r.pid and not t.inteiro
    loop
      update public.pedido_itens set quantidade = quantidade - v_linha.mover where id = v_linha.id;
      insert into public.pedido_itens
        (pedido_id, item_id, nome, quantidade, preco_unitario, observacao, complementos,
         tamanho_nome, sabor_nome, borda_nome, massa_nome)
      values
        (v_pedido_destino, v_linha.item_id, v_linha.nome, v_linha.mover, v_linha.preco_unitario,
         v_linha.observacao, v_linha.complementos, v_linha.tamanho_nome, v_linha.sabor_nome,
         v_linha.borda_nome, v_linha.massa_nome);
    end loop;

    perform public.pedido_recalcular(r.pid);
    perform public.pedido_recalcular(v_pedido_destino);
    v_movidos := v_movidos + v_do_pedido;
  end loop;

  if v_movidos = 0 then raise exception 'nenhum_item_transferivel'; end if;

  -- Item que saiu de uma conta que já recebeu dinheiro não pode deixar a origem
  -- devendo negativo: estorne antes.
  foreach v_origem in array v_origens loop
    perform public.comanda_conferir_pago(v_origem);
  end loop;

  insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
  values (p_restaurante, 'usuario', p_ator, p_ator_nome, 'mesa.transferiu_itens', 'comanda', v_comanda_destino,
          jsonb_build_object('mesa_destino', p_destino, 'para', v_destino_nome, 'itens', v_movidos,
                             'comandas_origem', to_jsonb(v_origens), 'motivo', v_motivo));

  return jsonb_build_object('comanda', v_comanda_destino, 'itens', v_movidos);
end $function$;

-- ─── gatilhos e grants ─────────────────────────────────────────────────────────
drop trigger if exists comanda_validar_abertura on public.comandas;
create trigger comanda_validar_abertura before insert on public.comandas
  for each row execute function public.comanda_validar_abertura();

do $$
declare
  f text;
begin
  foreach f in array array[
    'telefone_br_normalizar(text)',
    'cliente_vincular(uuid,text,text)',
    'comanda_validar_abertura()',
    'comanda_balcao_abrir(uuid,text,text,uuid,text,text,jsonb,text)',
    'comanda_balcao_abrir(uuid,text,text,uuid,text,text)',
    'comanda_mesa_abrir(uuid,uuid,text,text,uuid,text,text,text)',
    'comanda_identificar(uuid,uuid,text,text,uuid,text,text)',
    'comanda_lancar(uuid,uuid,jsonb,jsonb,uuid,text,text,text)',
    'comanda_lancar(uuid,uuid,jsonb,jsonb,uuid,text,text)',
    'comanda_totais(uuid)',
    'itens_transferir(uuid,uuid[],uuid,uuid,text,integer[],text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
