-- 0136 — Financeiro Fase 3: motoboy (login/app, link revogável, pagamento na entrega, troco, acerto).
--
--   entregadores + usuario_id (login do app) + desativado_em (link revogável: desativado não entra).
--   pedidos + saiu_para_entrega_em ("Saí para entrega" do app).
--   fin_config + troco_modo ('pedido' | 'fundo'), troco_modo_proximo, fundo_padrao_centavos.
--   fin_entregas_pagamento: como o cliente pagou na entrega (imutável; um por pedido).
--   entrega_registrar(): registro + livro-caixa + status numa transação, idempotente pela chave.
--   caixa_turno_abre_na_entrega(): a pendência automática da 0135 não nasce se a entrega já foi registrada.
-- Só age com restaurantes.financeiro_ativo (a RPC recusa sem a flag). Rollback: docs/rollback/0136_financeiro_motoboy.down.sql

-- ── cadastro ────────────────────────────────────────────────────────────────────────────────
alter table public.entregadores
  add column if not exists usuario_id uuid references public.usuarios(id) on delete set null,
  add column if not exists desativado_em timestamptz;
create unique index if not exists entregadores_usuario_uidx on public.entregadores (usuario_id) where usuario_id is not null;

alter table public.pedidos add column if not exists saiu_para_entrega_em timestamptz;

alter table public.fin_config
  add column if not exists troco_modo text not null default 'pedido',
  add column if not exists troco_modo_proximo text,
  add column if not exists fundo_padrao_centavos bigint not null default 5000;
alter table public.fin_config drop constraint if exists fin_config_troco_modo_check;
alter table public.fin_config add constraint fin_config_troco_modo_check
  check (troco_modo in ('pedido', 'fundo') and (troco_modo_proximo is null or troco_modo_proximo in ('pedido', 'fundo'))
         and fundo_padrao_centavos between 0 and 1000000);

-- ── pagamento informado na entrega ──────────────────────────────────────────────────────────
create table if not exists public.fin_entregas_pagamento (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  entregador_id uuid references public.entregadores(id) on delete restrict,
  forma text not null check (forma in ('dinheiro', 'cartao', 'pix', 'nao_pago', 'ja_pago')),
  total_centavos bigint not null,
  recebido_centavos bigint,
  troco_dado_centavos bigint,
  nsu text check (nsu is null or length(nsu) <= 40),
  motivo text check (motivo is null or length(motivo) <= 300),
  nexta boolean not null default false,
  origem text not null check (origem in ('motoboy', 'operador')),
  registrado_por uuid,
  registrado_por_nome text not null,
  chave_idempotencia text not null check (length(chave_idempotencia) between 8 and 120),
  criado_em timestamptz not null default now()
);
create unique index if not exists fin_entregas_pagamento_pedido_uidx on public.fin_entregas_pagamento (pedido_id);
create unique index if not exists fin_entregas_pagamento_chave_uidx on public.fin_entregas_pagamento (restaurante_id, chave_idempotencia);
create index if not exists fin_entregas_pagamento_loja on public.fin_entregas_pagamento (restaurante_id, criado_em desc);
drop trigger if exists fin_entregas_pagamento_imutavel on public.fin_entregas_pagamento;
create trigger fin_entregas_pagamento_imutavel before update or delete on public.fin_entregas_pagamento
  for each row execute function public.fin_imutavel();
alter table public.fin_entregas_pagamento enable row level security;
revoke all on public.fin_entregas_pagamento from anon, authenticated;
grant select on public.fin_entregas_pagamento to authenticated;
drop policy if exists "Gestor vê pagamentos de entrega" on public.fin_entregas_pagamento;
create policy "Gestor vê pagamentos de entrega" on public.fin_entregas_pagamento for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor());

-- ── registrar a entrega (motoboy no app, ou operador na volta) ─────────────────────────────
create or replace function public.entrega_registrar(
  p_restaurante uuid, p_pedido uuid, p_entregador uuid, p_forma text, p_recebido_centavos bigint, p_nsu text,
  p_motivo text, p_chave text, p_ator uuid, p_ator_nome text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_ja record;
  v_total bigint;
  v_troco bigint := null;
  v_recebido bigint := null;
  v_forma text := p_forma;
  v_pago_antes boolean;
  v_turno uuid;
  v_grupo uuid := gen_random_uuid();
  v_linha int := 0;
  v_pend bigint;
  v_nexta boolean;
  v_chave text := 'entrega:' || p_pedido;
  v_nome text := coalesce(nullif(btrim(p_ator_nome), ''), 'Sistema');
  v_ent uuid;
begin
  if p_chave is null or length(p_chave) < 8 then raise exception 'chave_invalida'; end if;
  if p_origem not in ('motoboy', 'operador') then raise exception 'origem_invalida'; end if;
  if p_forma not in ('dinheiro', 'cartao', 'pix', 'nao_pago') then raise exception 'forma_invalida'; end if;
  if not exists (select 1 from public.restaurantes where id = p_restaurante and financeiro_ativo) then raise exception 'financeiro_inativo'; end if;

  select * into p from public.pedidos where id = p_pedido and restaurante_id = p_restaurante for update;
  if p.id is null then raise exception 'pedido_inexistente'; end if;

  -- Repetição (internet instável, clique duplo): devolve o que já foi gravado.
  select * into v_ja from public.fin_entregas_pagamento where pedido_id = p_pedido;
  if v_ja.id is not null then
    if v_ja.chave_idempotencia = p_chave then return jsonb_build_object('id', v_ja.id, 'forma', v_ja.forma, 'idempotente', true); end if;
    raise exception 'ja_registrado';
  end if;

  if p.tipo <> 'entrega' or p.status = 'cancelado' then raise exception 'pedido_invalido'; end if;
  if p_origem = 'motoboy' then
    -- O motoboy só registra a entrega DELE, ainda em rota.
    if p_entregador is null or p.entregador_id is distinct from p_entregador then raise exception 'pedido_de_outro'; end if;
    if p.status <> 'em_rota' then raise exception 'pedido_nao_em_rota'; end if;
  else
    if p.status not in ('em_rota', 'entregue') then raise exception 'pedido_nao_saiu'; end if;
  end if;

  v_ent := coalesce(p_entregador, p.entregador_id);
  v_total := round(p.total * 100)::bigint;
  v_pago_antes := p.pago or (p.comanda_id is not null and exists (
    select 1 from public.comanda_totais(p.comanda_id) t where t.total > 0 and t.restante <= 0.004));
  if v_pago_antes then v_forma := 'ja_pago'; end if;
  v_nexta := exists (select 1 from public.nexta_entregas n where n.pedido_id = p.id);

  if v_forma = 'dinheiro' then
    v_recebido := coalesce(p_recebido_centavos, v_total);
    if v_recebido < v_total then raise exception 'recebido_menor_que_total:%', round(v_total / 100.0, 2); end if;
    v_troco := v_recebido - v_total;
  elsif v_forma = 'nao_pago' then
    if coalesce(length(btrim(p_motivo)), 0) < 3 then raise exception 'motivo_obrigatorio'; end if;
  end if;

  select id into v_turno from public.caixa_turnos where restaurante_id = p_restaurante and fechado_em is null limit 1;

  insert into public.fin_entregas_pagamento (restaurante_id, pedido_id, entregador_id, forma, total_centavos, recebido_centavos,
    troco_dado_centavos, nsu, motivo, nexta, origem, registrado_por, registrado_por_nome, chave_idempotencia)
  values (p_restaurante, p.id, case when p_origem = 'motoboy' then p_entregador else p.entregador_id end, v_forma, v_total, v_recebido,
    v_troco, nullif(btrim(p_nsu), ''), nullif(btrim(p_motivo), ''), v_nexta, p_origem, p_ator, v_nome, p_chave);

  if v_forma <> 'ja_pago' then
    -- Pendência automática da 0135 (entregue sem registro): desfaz, o registro manda.
    select coalesce(sum(valor_centavos), 0) into v_pend from public.fin_lancamentos
     where restaurante_id = p_restaurante and pedido_id = p.id and tipo = 'pendencia_motoboy';
    if v_pend <> 0 then
      v_linha := v_linha + 1;
      insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem,
        pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
      values (p_restaurante, v_grupo, v_linha, null, 'motoboy', p.entregador_id, 'ajuste', -v_pend, 'dinheiro', 'delivery',
        p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('motivo', 'pendência substituída pelo registro da entrega'));
    end if;

    if v_forma = 'dinheiro' and v_ent is not null then
      -- Dinheiro na mão do motoboy: entra o que o cliente deu, sai o troco que ele devolveu.
      v_linha := v_linha + 1;
      insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem,
        pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
      values (p_restaurante, v_grupo, v_linha, null, 'motoboy', v_ent, 'recebimento', v_recebido, 'dinheiro', 'motoboy',
        p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('numero', p.numero));
      if v_troco > 0 then
        v_linha := v_linha + 1;
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem,
          pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
        values (p_restaurante, v_grupo, v_linha, null, 'motoboy', v_ent, 'troco', -v_troco, 'dinheiro', 'motoboy',
          p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('numero', p.numero));
      end if;
    else
      v_linha := v_linha + 1;
      if v_forma = 'dinheiro' and v_nexta then
        -- Nexta: o entregador terceirizado recebeu; fica a receber até o repasse.
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
          pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
        values (p_restaurante, v_grupo, v_linha, null, 'a_receber', 'recebimento', v_total, 'dinheiro', 'delivery',
          p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('numero', p.numero, 'nexta', true));
      elsif v_forma = 'dinheiro' then
        -- Sem motoboy: quem registra recebeu o dinheiro na volta — vai para a gaveta do caixa aberto.
        if v_turno is null then raise exception 'caixa_fechado'; end if;
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
          pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
        values (p_restaurante, v_grupo, v_linha, v_turno, 'gaveta', 'recebimento', v_total, 'dinheiro', 'delivery',
          p.id, p.comanda_id, p_ator, v_nome, v_chave, jsonb_build_object('numero', p.numero, 'recebido_centavos', v_recebido, 'troco_centavos', v_troco));
      else
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem,
          pedido_id, comanda_id, usuario_id, usuario_nome, chave_idempotencia, dados)
        values (p_restaurante, v_grupo, v_linha, null,
          case v_forma when 'cartao' then 'cartao' when 'pix' then 'pix_conferir' else 'a_receber' end,
          p.entregador_id, 'recebimento', v_total, case v_forma when 'nao_pago' then null else v_forma end, 'delivery',
          p.id, p.comanda_id, p_ator, v_nome, v_chave,
          jsonb_build_object('numero', p.numero, 'nsu', nullif(btrim(p_nsu), ''), 'motivo', nullif(btrim(p_motivo), ''), 'nexta', v_nexta));
      end if;
    end if;
  end if;

  -- Status: o motoboy conclui a entrega; dinheiro e cartão ficam pagos (Pix só depois de conferido).
  update public.pedidos
     set status = case when status = 'em_rota' then 'entregue'::status_pedido else status end,
         pago = pago or v_forma in ('dinheiro', 'cartao')
   where id = p.id;

  perform public.auditoria_registrar(p_restaurante, p_ator, v_nome, 'entrega.pagamento_registrado', 'pedido', p.id,
    jsonb_build_object('numero', p.numero, 'forma', v_forma, 'total_centavos', v_total, 'recebido_centavos', v_recebido,
      'troco_dado_centavos', v_troco, 'nsu', nullif(btrim(p_nsu), ''), 'motivo', nullif(btrim(p_motivo), ''), 'origem', p_origem, 'nexta', v_nexta));

  return jsonb_build_object('forma', v_forma, 'total_centavos', v_total, 'troco_dado_centavos', v_troco, 'idempotente', false);
end $$;
revoke execute on function public.entrega_registrar(uuid, uuid, uuid, text, bigint, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.entrega_registrar(uuid, uuid, uuid, text, bigint, text, text, text, uuid, text, text) to service_role;

-- ── pendência automática: não duplica o que foi registrado ─────────────────────────────────
create or replace function public.caixa_turno_abre_na_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fin boolean;
  v_turno uuid;
  v_pago boolean;
begin
  if not (new.status = 'entregue' and old.status is distinct from 'entregue' and new.entregador_id is not null) then
    return null;
  end if;
  select financeiro_ativo into v_fin from public.restaurantes where id = new.restaurante_id;

  if coalesce(v_fin, false) then
    -- Já registrado no ato da entrega (0136): o registro manda, nada de pendência automática.
    if exists (select 1 from public.fin_entregas_pagamento where pedido_id = new.id) then return null; end if;
    if new.forma_pagamento = 'dinheiro' then
      v_pago := new.pago or (new.comanda_id is not null and exists (
        select 1 from public.comanda_totais(new.comanda_id) t where t.total > 0 and t.restante <= 0.004));
      if not v_pago then
        select id into v_turno from public.caixa_turnos where restaurante_id = new.restaurante_id and fechado_em is null limit 1;
        insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos,
          forma, origem, pedido_id, comanda_id, usuario_nome, chave_idempotencia, dados)
        values (new.restaurante_id, gen_random_uuid(), 1, v_turno, 'motoboy', new.entregador_id, 'pendencia_motoboy',
          round(new.total * 100)::bigint, 'dinheiro', 'delivery', new.id, new.comanda_id, 'Sistema', 'pend:' || new.id,
          jsonb_build_object('troco_para_centavos', round(coalesce(new.troco_para, 0) * 100)::bigint, 'numero', new.numero))
        on conflict do nothing;
      end if;
    end if;
    return null;
  end if;

  perform public.caixa_turno_virar_dia(new.restaurante_id);
  insert into public.caixa_turnos (restaurante_id, aberto_em, aberto_por_nome)
  values (new.restaurante_id, now(), 'Automático (1ª entrega)')
  on conflict (restaurante_id) where fechado_em is null do nothing;
  return null;
end $$;
revoke execute on function public.caixa_turno_abre_na_entrega() from public, anon, authenticated;
