-- 0144 — Financeiro Fase 6: dashboard financeiro, alertas por varredura, regras de PIN no fechamento,
-- aprovação pelo celular e relatório de risco por funcionário.
--
--   fin_config +           tolerância do fechamento (R$ 2,00), limite de mesas/comandas abertas no fechamento
--                          (R$ 100,00), minutos para avisar caixa sem abrir (30), meta de faturamento por dia
--                          (opcional, só desenha a linha de meta no gráfico) — todos PROVISÓRIOS e editáveis por loja
--   fin_aprovacao_pedidos  pedido de aprovação remota: o funcionário pede, o gerente/dono aprova ou recusa no
--                          celular com o PIN DELE; a aprovação vale UMA vez, para a mesma ação, valor e pessoa,
--                          por 10 minutos (o servidor confere tudo ao usar)
--   fin_pendencias_fechamento()   mesas/comandas abertas e entregas "não pago" do turno (regras do fechamento)
--   fin_dashboard()               números do dashboard a partir do livro-caixa (por dia/semana/mês)
--   fin_risco_funcionarios()      contagens por funcionário para o relatório de risco
-- Rollback: docs/rollback/0144_dashboard_alertas_pin_risco.down.sql

-- ── configuração ───────────────────────────────────────────────────────────────────────────────
alter table public.fin_config add column if not exists tolerancia_fechamento_centavos bigint not null default 200
  check (tolerancia_fechamento_centavos between 0 and 100000);
alter table public.fin_config add column if not exists limite_comandas_fechamento_centavos bigint not null default 10000
  check (limite_comandas_fechamento_centavos between 0 and 10000000);
alter table public.fin_config add column if not exists minutos_caixa_sem_abrir integer not null default 30
  check (minutos_caixa_sem_abrir between 5 and 600);
alter table public.fin_config add column if not exists meta_faturamento_dia_centavos bigint
  check (meta_faturamento_dia_centavos is null or meta_faturamento_dia_centavos between 0 and 1000000000);

-- ── aprovação pelo celular ─────────────────────────────────────────────────────────────────────
create table if not exists public.fin_aprovacao_pedidos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  acao text not null check (length(acao) between 3 and 60),
  valor_centavos bigint,
  motivo text check (motivo is null or length(motivo) <= 500),
  contexto jsonb,
  solicitante_id uuid not null,
  solicitante_nome text not null,
  dispositivo text check (dispositivo is null or length(dispositivo) <= 200),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado', 'usado', 'cancelado')),
  aprovador_id uuid,
  aprovador_nome text,
  aprovacao_id uuid references public.fin_aprovacoes(id) on delete restrict,
  decidido_em timestamptz,
  recusa_motivo text check (recusa_motivo is null or length(recusa_motivo) <= 300),
  usado_em timestamptz,
  expira_em timestamptz not null default now() + interval '10 minutes',
  criado_em timestamptz not null default now(),
  constraint fin_aprovacao_pedidos_pessoas check (aprovador_id is null or aprovador_id <> solicitante_id)
);
create index if not exists fin_aprovacao_pedidos_pendentes on public.fin_aprovacao_pedidos (restaurante_id, status, criado_em desc);

-- Só anda para frente: pendente → aprovado | recusado | cancelado; aprovado → usado. Nada se apaga.
create or replace function public.fin_aprovacao_pedidos_guardar() returns trigger language plpgsql as $$
begin
  if public.fin_manutencao() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'registro_imutavel: pedido de aprovação não se apaga' using errcode = '42501'; end if;
  if new.restaurante_id <> old.restaurante_id or new.acao <> old.acao or new.valor_centavos is distinct from old.valor_centavos
     or new.solicitante_id <> old.solicitante_id or new.criado_em <> old.criado_em or new.contexto is distinct from old.contexto then
    raise exception 'registro_imutavel: pedido de aprovação não muda' using errcode = '42501';
  end if;
  if not ((old.status = 'pendente' and new.status in ('pendente', 'aprovado', 'recusado', 'cancelado'))
          or (old.status = 'aprovado' and new.status in ('aprovado', 'usado'))
          or (old.status = new.status and old.status in ('recusado', 'usado', 'cancelado') and new is not distinct from old)) then
    raise exception 'transicao_invalida: % → %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists fin_aprovacao_pedidos_guardar on public.fin_aprovacao_pedidos;
create trigger fin_aprovacao_pedidos_guardar before update or delete on public.fin_aprovacao_pedidos
  for each row execute function public.fin_aprovacao_pedidos_guardar();
drop trigger if exists fin_aprovacao_pedidos_sem_truncate on public.fin_aprovacao_pedidos;
create trigger fin_aprovacao_pedidos_sem_truncate before truncate on public.fin_aprovacao_pedidos for each statement execute function public.fin_imutavel();

alter table public.fin_aprovacao_pedidos enable row level security;
revoke all on public.fin_aprovacao_pedidos from anon, authenticated;

-- ── pendências do fechamento ───────────────────────────────────────────────────────────────────
create or replace function public.fin_pendencias_fechamento(p_restaurante uuid, p_desde timestamptz)
  returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'comandas_abertas', (select count(*) from public.comandas c where c.restaurante_id = p_restaurante and c.status = 'aberta'),
    'comandas_abertas_centavos', (select coalesce(sum(round(t.restante * 100)), 0)::bigint from public.comandas c
                                    cross join lateral public.comanda_totais(c.id) t
                                   where c.restaurante_id = p_restaurante and c.status = 'aberta'),
    'nao_pagos', (select count(*) from public.fin_entregas_pagamento e where e.restaurante_id = p_restaurante and e.forma = 'nao_pago' and e.criado_em >= p_desde),
    'nao_pagos_centavos', (select coalesce(sum(e.total_centavos), 0)::bigint from public.fin_entregas_pagamento e
                            where e.restaurante_id = p_restaurante and e.forma = 'nao_pago' and e.criado_em >= p_desde)
  )
$$;
revoke execute on function public.fin_pendencias_fechamento(uuid, timestamptz) from public, anon, authenticated;

-- ── dashboard (livro-caixa) ────────────────────────────────────────────────────────────────────
-- Vendas = recebimento/troco/estorno fora das contrapartidas (mesma regra do Fluxo e do DRE), pela data da linha.
-- "A conferir" = Pix ainda em pix_conferir sem resolução; "não pago" = carteira a_receber; o resto, pago.
create or replace function public.fin_dashboard(p_restaurante uuid, p_de date, p_ate date, p_grupo text)
  returns jsonb language sql stable security definer set search_path = public as $$
  with lim as (
    select (p_de::timestamp at time zone 'America/Sao_Paulo') ini, ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo') fim
  ), l as (
    select x.*, (x.criado_em at time zone 'America/Sao_Paulo')::date dia from public.fin_lancamentos x, lim
     where x.restaurante_id = p_restaurante and x.criado_em >= lim.ini and x.criado_em < lim.fim
  ), v as (
    select * from l where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado')
  ), pixpend as (
    select coalesce(sum(l.valor_centavos), 0) s from l
     where l.carteira = 'pix_conferir' and l.valor_centavos > 0 and l.tipo in ('recebimento')
       and not exists (select 1 from public.fin_lancamentos r where r.restaurante_id = p_restaurante and r.referencia_id = l.id and r.carteira = 'pix_conferir')
  ), b as (
    select case p_grupo when 'mes' then date_trunc('month', dia)::date when 'semana' then date_trunc('week', dia)::date else dia end bucket, l.*
      from l
  ), serie as (
    select g.bucket,
      coalesce(sum(b.valor_centavos) filter (where b.tipo in ('recebimento', 'troco', 'estorno') and b.carteira not in ('empresa', 'resultado')), 0) faturamento,
      coalesce(-sum(b.valor_centavos) filter (where b.carteira = 'resultado' and b.tipo <> 'conta_receber'
               and coalesce(b.dados->>'categoria_grupo', '') not in ('insumo', 'fora') and b.tipo <> 'compra'), 0) despesas,
      count(distinct coalesce(b.comanda_id::text, b.pedido_id::text)) filter (where b.tipo = 'recebimento' and b.carteira not in ('empresa', 'resultado')) vendas
    from (select distinct case p_grupo when 'mes' then date_trunc('month', d)::date when 'semana' then date_trunc('week', d)::date else d::date end bucket
            from generate_series(p_de::timestamp, p_ate::timestamp, interval '1 day') d) g
    left join b on b.bucket = g.bucket
    group by g.bucket order by g.bucket
  )
  select jsonb_build_object(
    'faturamento', (select coalesce(sum(valor_centavos), 0) from v),
    'vendas', (select count(distinct coalesce(comanda_id::text, pedido_id::text)) from v where tipo = 'recebimento'),
    'por_origem', (select coalesce(jsonb_object_agg(o, s), '{}'::jsonb) from (select public.fin_grupo_origem(origem) o, sum(valor_centavos) s from v group by 1) q),
    'por_forma', (select coalesce(jsonb_object_agg(f, s), '{}'::jsonb) from (select public.fin_grupo_forma(forma) f, sum(valor_centavos) s from v group by 1) q),
    'a_receber', (select coalesce(sum(valor_centavos), 0) from v where carteira = 'a_receber'),
    'a_conferir', (select s from pixpend),
    'sangrias', (select coalesce(-sum(valor_centavos), 0) from l where carteira = 'gaveta' and tipo in ('sangria', 'retirada')),
    'despesas', (select coalesce(-sum(valor_centavos), 0) from l where carteira = 'resultado' and tipo not in ('conta_receber', 'compra')
                  and coalesce(dados->>'categoria_grupo', '') not in ('insumo', 'fora')),
    'divergencias_centavos', (select coalesce(sum(abs(valor_centavos)), 0) from l where carteira = 'gaveta' and tipo = 'ajuste'),
    'turnos_divergentes', (select count(*) from public.caixa_turnos t, lim where t.restaurante_id = p_restaurante and t.fechado_em >= lim.ini and t.fechado_em < lim.fim
                             and (coalesce(t.diferenca_centavos, 0) <> 0 or coalesce(t.diferenca_cartao_centavos, 0) <> 0)),
    'motoboy_agora', (select coalesce(sum(valor_centavos), 0) from public.fin_lancamentos m where m.restaurante_id = p_restaurante and m.carteira = 'motoboy'),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'faturamento', faturamento, 'despesas', despesas, 'vendas', vendas) order by bucket), '[]'::jsonb) from serie)
  )
$$;
revoke execute on function public.fin_dashboard(uuid, date, date, text) from public, anon, authenticated;

-- ── risco por funcionário ──────────────────────────────────────────────────────────────────────
-- Contagem de ações da auditoria por pessoa (o servidor classifica a ação) + divergências dos fechamentos dela.
create or replace function public.fin_risco_funcionarios(p_restaurante uuid, p_de date, p_ate date)
  returns table (usuario_id uuid, usuario_nome text, papel text, acao text, qtd integer, valor_centavos bigint)
  language sql stable security definer set search_path = public as $$
  with lim as (
    select (p_de::timestamp at time zone 'America/Sao_Paulo') ini, ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo') fim
  )
  select e.usuario_id, max(e.usuario_nome), max(e.papel::text), e.acao, count(*)::int,
         coalesce(sum(case when e.dados ? 'valor_centavos' then abs((e.dados->>'valor_centavos')::numeric)
                           when e.dados ? 'valor_afetado' then round(abs((e.dados->>'valor_afetado')::numeric) * 100) else 0 end), 0)::bigint
    from public.eventos_auditoria e, lim
   where e.restaurante_id = p_restaurante and e.criado_em >= lim.ini and e.criado_em < lim.fim and e.usuario_id is not null
     and (e.acao like 'conta.%' or e.acao like 'pedido.%' or e.acao like 'caixa.%' or e.acao like 'contas.%' or e.acao like 'compras.%'
          or e.acao like 'fin.%' or e.acao like 'motoboy.%' or e.acao like 'pdv_legado.%')
   group by e.usuario_id, e.acao
  union all
  select t.fechado_por, max(t.fechado_por_nome), null, 'caixa.divergencia', count(*)::int, coalesce(sum(abs(t.diferenca_centavos) + abs(coalesce(t.diferenca_cartao_centavos, 0))), 0)::bigint
    from public.caixa_turnos t, lim
   where t.restaurante_id = p_restaurante and t.fechado_em >= lim.ini and t.fechado_em < lim.fim and t.fechado_por is not null
     and (coalesce(t.diferenca_centavos, 0) <> 0 or coalesce(t.diferenca_cartao_centavos, 0) <> 0)
   group by t.fechado_por
$$;
revoke execute on function public.fin_risco_funcionarios(uuid, date, date) from public, anon, authenticated;

-- ── aprovação pelo celular consumida NA MESMA transação do dinheiro ────────────────────────────
-- Aprovação dada pelo celular (fin_aprovacao_pedidos.aprovacao_id) só vira "usada" junto com a gravação que ela
-- liberou; se a gravação falhar, ela continua valendo. Usar duas vezes é recusado aqui (corrida entre abas).
create or replace function public.fin_usar_aprovacao(p_aprovacao uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if p_aprovacao is null then return; end if;
  select id, status into v from public.fin_aprovacao_pedidos where aprovacao_id = p_aprovacao for update;
  if not found then return; end if; -- PIN digitado no terminal: não há pedido remoto
  if v.status <> 'aprovado' then raise exception 'aprovacao_usada'; end if;
  update public.fin_aprovacao_pedidos set status = 'usado', usado_em = now() where id = v.id;
end $$;
revoke execute on function public.fin_usar_aprovacao(uuid) from public, anon, authenticated;

-- Mesmo grupo do livro-caixa da 0143, agora consumindo a aprovação remota na mesma transação.
create or replace function public.fin_lancar_grupo(p_restaurante uuid, p_turno uuid, p_chave text, p_origem text, p_usuario uuid, p_usuario_nome text,
  p_motivo text, p_aprovacao uuid, p_aprovado_por text, p_dispositivo text, p_linhas jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_grupo uuid; v_i int := 0; l jsonb;
begin
  select grupo_id into v_grupo from public.fin_lancamentos where restaurante_id = p_restaurante and chave_idempotencia = p_chave limit 1;
  if v_grupo is not null then return v_grupo; end if;
  perform public.fin_usar_aprovacao(p_aprovacao);
  v_grupo := gen_random_uuid();
  for l in select * from jsonb_array_elements(p_linhas) loop
    v_i := v_i + 1;
    insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, entregador_id, tipo, valor_centavos, forma, origem, pedido_id,
      comanda_id, pagamento_id, referencia_id, motivo, usuario_id, usuario_nome, aprovacao_id, aprovado_por_nome, chave_idempotencia, dispositivo, dados)
    values (p_restaurante, v_grupo, v_i, case when l->>'carteira' = 'gaveta' then p_turno else nullif(l->>'turno_id', '')::uuid end,
      l->>'carteira', nullif(l->>'entregador_id', '')::uuid, l->>'tipo', (l->>'valor_centavos')::bigint, nullif(l->>'forma', ''), p_origem,
      nullif(l->>'pedido_id', '')::uuid, nullif(l->>'comanda_id', '')::uuid, nullif(l->>'pagamento_id', '')::uuid, nullif(l->>'referencia_id', '')::bigint,
      left(p_motivo, 500), p_usuario, left(p_usuario_nome, 120), p_aprovacao, p_aprovado_por, p_chave, left(p_dispositivo, 200), l->'dados');
  end loop;
  return v_grupo;
end $$;

-- Fechamento do caixa: ajuste da contagem + turno fechado + aprovação usada + auditoria, tudo junto.
create or replace function public.fin_caixa_fechar(p_restaurante uuid, p_turno uuid, p_chave text, p_linhas jsonb, p_campos jsonb, p_usuario uuid,
  p_usuario_nome text, p_aprovacao uuid, p_aprovado_por text, p_dispositivo text, p_motivo text, p_auditoria jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.caixa_turnos where id = p_turno and restaurante_id = p_restaurante for update;
  if not found or t.fechado_em is not null then raise exception 'ja_fechado'; end if;
  if jsonb_array_length(coalesce(p_linhas, '[]'::jsonb)) > 0 then
    perform public.fin_lancar_grupo(p_restaurante, p_turno, p_chave, 'manual', p_usuario, p_usuario_nome, p_motivo, p_aprovacao, p_aprovado_por, p_dispositivo, p_linhas);
  else
    perform public.fin_usar_aprovacao(p_aprovacao);
  end if;
  update public.caixa_turnos set
    fechado_em = now(), fechado_por = p_usuario, fechado_por_nome = p_usuario_nome,
    contado_dinheiro_centavos = (p_campos->>'contado_dinheiro_centavos')::bigint, contado_cartao_centavos = (p_campos->>'contado_cartao_centavos')::bigint,
    esperado_dinheiro_centavos = (p_campos->>'esperado_dinheiro_centavos')::bigint, esperado_cartao_centavos = (p_campos->>'esperado_cartao_centavos')::bigint,
    diferenca_centavos = (p_campos->>'diferenca_centavos')::bigint, diferenca_cartao_centavos = (p_campos->>'diferenca_cartao_centavos')::bigint,
    pendencias = p_campos->'pendencias', resumo = p_campos->'resumo', justificativa = nullif(p_campos->>'justificativa', ''),
    fechamento_aprovacao_id = p_aprovacao, fechamento_aprovado_por_nome = p_aprovado_por, dispositivo_fechamento = left(p_dispositivo, 200)
   where id = p_turno;
  perform public.fin_auditar(p_restaurante, p_usuario, p_usuario_nome, 'caixa.fechou_turno', 'caixa', p_turno, p_auditoria);
  return p_turno;
end $$;
revoke execute on function public.fin_caixa_fechar(uuid, uuid, text, jsonb, jsonb, uuid, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Decisão do aprovador no celular: aprovação gravada + pedido decidido + auditoria, tudo junto.
create or replace function public.fin_aprovacao_remota_decidir(p_restaurante uuid, p_pedido uuid, p_decisao text, p_aprovador uuid, p_aprovador_nome text,
  p_motivo text, p_dispositivo text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare ped record; v_apr uuid;
begin
  select * into ped from public.fin_aprovacao_pedidos where id = p_pedido and restaurante_id = p_restaurante for update;
  if not found then raise exception 'pedido_nao_encontrado' using errcode = 'P0002'; end if;
  if ped.solicitante_id = p_aprovador then raise exception 'aprovacao_propria'; end if;
  if ped.status <> 'pendente' then raise exception 'pedido_decidido'; end if;
  if ped.expira_em < now() then raise exception 'pedido_expirado'; end if;
  if p_decisao = 'recusar' then
    update public.fin_aprovacao_pedidos set status = 'recusado', aprovador_id = p_aprovador, aprovador_nome = p_aprovador_nome, decidido_em = now(),
      recusa_motivo = left(nullif(btrim(p_motivo), ''), 300) where id = p_pedido;
    perform public.fin_auditar(p_restaurante, p_aprovador, p_aprovador_nome, 'fin.recusou_aprovacao', 'aprovacao_pedido', p_pedido,
      jsonb_build_object('acao', ped.acao, 'solicitante', ped.solicitante_nome, 'valor_centavos', ped.valor_centavos, 'motivo', p_motivo, 'dispositivo', p_dispositivo));
    return null;
  end if;
  insert into public.fin_aprovacoes (restaurante_id, acao, solicitante_id, solicitante_nome, aprovador_id, aprovador_nome, valor_centavos, motivo, contexto)
  values (p_restaurante, ped.acao, ped.solicitante_id, ped.solicitante_nome, p_aprovador, p_aprovador_nome, ped.valor_centavos, ped.motivo,
    coalesce(ped.contexto, '{}'::jsonb) || jsonb_build_object('remota', true, 'pedido', p_pedido, 'dispositivo_aprovador', p_dispositivo))
  returning id into v_apr;
  update public.fin_aprovacao_pedidos set status = 'aprovado', aprovador_id = p_aprovador, aprovador_nome = p_aprovador_nome, aprovacao_id = v_apr, decidido_em = now()
   where id = p_pedido;
  perform public.fin_auditar(p_restaurante, p_aprovador, p_aprovador_nome, 'fin.aprovou', 'aprovacao', v_apr,
    jsonb_build_object('acao', ped.acao, 'solicitante', ped.solicitante_nome, 'valor_centavos', ped.valor_centavos, 'motivo', ped.motivo, 'remota', true, 'dispositivo', p_dispositivo));
  return v_apr;
end $$;
revoke execute on function public.fin_aprovacao_remota_decidir(uuid, uuid, text, uuid, text, text, text) from public, anon, authenticated;

-- ── auditoria: "senha" do balcão vira "codigo_retirada" ────────────────────────────────────────
-- A "senha" das comandas de balcão é o NÚMERO DE CHAMADA da retirada (mostrado e chamado em público), não uma
-- credencial. Para a trilha nunca guardar nada chamado "senha", os eventos novos gravam o campo como
-- "codigo_retirada" (normaliza antes do hash da cadeia; eventos antigos são imutáveis e ficam como estão).
create or replace function public.eventos_auditoria_sem_senha() returns trigger language plpgsql as $$
begin
  if new.dados ? 'senha' and jsonb_typeof(new.dados->'senha') = 'number' then
    new.dados := (new.dados - 'senha') || jsonb_build_object('codigo_retirada', new.dados->'senha');
  end if;
  return new;
end $$;
drop trigger if exists a_eventos_auditoria_sem_senha on public.eventos_auditoria;
create trigger a_eventos_auditoria_sem_senha before insert on public.eventos_auditoria
  for each row execute function public.eventos_auditoria_sem_senha();
