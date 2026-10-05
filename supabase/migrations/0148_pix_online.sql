-- 0148 — Pix online (Mercado Pago), 2026-10-04. Plano: docs/pix-online/plano.md (aprovado).
--
-- Aditiva. Nada muda para loja sem a flag `pix_online_ativo` (padrão FALSO; liga-se só na Menuzia):
--   · restaurantes: flag + validade da cobrança (padrão 15 min);
--   · pedidos: `pagamento_online` (pedido pago pelo Pix online) — padrão falso;
--   · pagamentos_contas (conta do MP da loja, tokens CIFRADOS), pagamentos_oauth_estados (state + PKCE),
--     pagamentos_online (a cobrança de cada pedido), pagamentos_eventos (webhooks recebidos):
--     todas só do servidor (RLS sem policy);
--   · livro-caixa: carteira `online` (saldo no Mercado Pago) e forma `pix_online` (grupo Pix no fluxo);
--   · fluxo de caixa: Pix online confirmado com o caixa fechado é adotado pelo próximo turno;
--   · gatilho de transição: `aguardando_pagamento` só vai para `recebido` (pelo servidor, já pago) ou
--     `cancelado`; nada volta para `aguardando_pagamento`.

-- ─── 1. flag e validade ────────────────────────────────────────────────────────────────────────
alter table public.restaurantes add column if not exists pix_online_ativo boolean not null default false;
alter table public.restaurantes add column if not exists pix_online_validade_min integer not null default 15;
alter table public.restaurantes drop constraint if exists restaurantes_pix_online_validade_check;
alter table public.restaurantes add constraint restaurantes_pix_online_validade_check check (pix_online_validade_min between 5 and 60);

alter table public.pedidos add column if not exists pagamento_online boolean not null default false;

-- ─── 2. conta do Mercado Pago da loja ─────────────────────────────────────────────────────────
create table if not exists public.pagamentos_contas (
  restaurante_id uuid primary key references public.restaurantes(id) on delete cascade,
  provedor text not null default 'mercadopago' check (provedor = 'mercadopago'),
  mp_user_id text not null,
  apelido text,
  email_mascarado text,
  access_token_cifrado text not null,
  refresh_token_cifrado text not null,
  expira_em timestamptz not null,
  ambiente text not null default 'producao' check (ambiente in ('producao', 'teste')),
  status text not null default 'conectada' check (status in ('conectada', 'desconectada', 'erro')),
  erro text check (erro is null or length(erro) <= 300),
  conectado_por uuid,
  conectado_por_nome text,
  conectado_em timestamptz not null default now(),
  renovado_em timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.pagamentos_contas enable row level security;
revoke all on public.pagamentos_contas from anon, authenticated;

create table if not exists public.pagamentos_oauth_estados (
  state text primary key check (length(state) between 20 and 200),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  usuario_id uuid not null,
  usuario_nome text,
  verificador_cifrado text not null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '10 minutes'
);
alter table public.pagamentos_oauth_estados enable row level security;
revoke all on public.pagamentos_oauth_estados from anon, authenticated;

-- ─── 3. cobranças Pix ──────────────────────────────────────────────────────────────────────────
create table if not exists public.pagamentos_online (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete restrict,
  pedido_id uuid not null references public.pedidos(id) on delete restrict,
  provedor text not null default 'mercadopago',
  mp_payment_id text unique,
  mp_user_id text,
  valor numeric(12,2) not null check (valor > 0),
  status text not null default 'pendente'
    check (status in ('pendente', 'pago', 'expirado', 'cancelado', 'a_devolver', 'devolvido', 'verificacao_pendente', 'erro')),
  status_mp text,
  qr_code text,
  qr_code_base64 text,
  expira_em timestamptz not null,
  pago_em timestamptz,
  taxa numeric(12,2),
  liquido numeric(12,2),
  lancado_em timestamptz,
  devolucao_id text,
  devolucao_pedida_por text,
  devolvido_em timestamptz,
  devolvido_por_nome text,
  aprovado_por_nome text,
  motivo_devolucao text check (motivo_devolucao is null or length(motivo_devolucao) <= 300),
  -- Dados da compra para o Meta (IP, navegador, fbp/fbc, URL), guardados até a confirmação. Sem dado pessoal novo.
  contexto jsonb,
  verificacoes integer not null default 0,
  ultima_verificacao_em timestamptz,
  erro text check (erro is null or length(erro) <= 300),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- No máximo UMA cobrança ativa por pedido (clique duplo não gera duas).
create unique index if not exists pagamentos_online_pedido_ativa on public.pagamentos_online (pedido_id) where status = 'pendente';
create index if not exists pagamentos_online_pendentes on public.pagamentos_online (status, expira_em) where status in ('pendente', 'verificacao_pendente');
create index if not exists pagamentos_online_loja on public.pagamentos_online (restaurante_id, criado_em desc);
alter table public.pagamentos_online enable row level security;
revoke all on public.pagamentos_online from anon, authenticated;

create table if not exists public.pagamentos_eventos (
  id bigint generated always as identity primary key,
  provedor text not null default 'mercadopago',
  tipo text,
  acao text,
  mp_id text,
  request_id text,
  assinatura_valida boolean not null,
  resultado text check (resultado is null or length(resultado) <= 300),
  recebido_em timestamptz not null default now()
);
create unique index if not exists pagamentos_eventos_req on public.pagamentos_eventos (provedor, request_id) where request_id is not null and assinatura_valida;
alter table public.pagamentos_eventos enable row level security;
revoke all on public.pagamentos_eventos from anon, authenticated;

-- ─── 4. livro-caixa: carteira "online" e forma "pix_online" ────────────────────────────────────
alter table public.fin_lancamentos drop constraint if exists fin_lancamentos_carteira_check;
alter table public.fin_lancamentos add constraint fin_lancamentos_carteira_check
  check (carteira in ('gaveta', 'motoboy', 'pix_conferir', 'cartao', 'empresa', 'a_receber', 'resultado', 'online'));
alter table public.fin_lancamentos drop constraint if exists fin_lancamentos_forma_check;
alter table public.fin_lancamentos add constraint fin_lancamentos_forma_check
  check (forma in ('dinheiro', 'pix', 'credito', 'debito', 'cartao', 'vale', 'fiado', 'transferencia', 'boleto', 'outro', 'pix_online'));

create or replace function public.fin_grupo_forma(f text) returns text language sql immutable as $$
  select case f when 'dinheiro' then 'dinheiro' when 'pix' then 'pix' when 'pix_online' then 'pix' when 'credito' then 'cartao'
                when 'debito' then 'cartao' when 'cartao' then 'cartao' else 'outros' end
$$;

-- ─── 5. fluxo de caixa: o próximo turno adota o Pix online recebido com o caixa fechado ─────────
create or replace function public.fin_fluxo_turnos(
  p_restaurante uuid,
  p_de date,
  p_ate date,
  p_origens text[] default null,
  p_formas text[] default null,
  p_operador uuid default null,
  p_entregador uuid default null,
  p_produto uuid default null
)
returns table (
  turno_id uuid, data_abertura date, aberto_em timestamptz, aberto_por_nome text, fechado_em timestamptz, fechado_por_nome text,
  status_turno text, situacao text, reaberto_em timestamptz, reaberto_por_nome text, reaberto_motivo text,
  valor_inicial bigint, vendido bigint, recebido bigint, a_receber bigint, dinheiro bigint, pix bigint, pix_confirmado bigint,
  pix_a_conferir bigint, cartao bigint, outros bigint, origem_balcao bigint, origem_mesa bigint, origem_delivery bigint,
  origem_online bigint, origem_manual bigint, taxas bigint, descontos bigint, cancelamentos bigint, cancelamentos_qtd int,
  estornos bigint, sangrias bigint, reforcos bigint, despesas bigint, motoboy bigint, esperado bigint, informado bigint,
  diferenca bigint, diferenca_cartao bigint, contado_cartao bigint, esperado_cartao bigint, observacoes text, lancamentos int,
  produto_qtd numeric, produto_valor bigint
)
language sql
stable
security definer
set search_path = public
as $$
with
tz as (select 'America/Sao_Paulo'::text as z),
-- Turnos do período: o turno pertence à DATA DE ABERTURA (horário de São Paulo), mesmo que feche depois da meia-noite.
t as (
  select ct.* from public.caixa_turnos ct, tz
   where ct.restaurante_id = p_restaurante
     and (ct.aberto_em at time zone tz.z)::date between p_de and p_ate
),
-- Janela de lançamentos: do primeiro turno do período até o fim do último (ou agora), e o período civil inteiro
-- (linhas fora de turno). Linhas sem turno (entrega, Pix conferido sem caixa) caem no turno cuja janela as contém.
lim as (
  select least(coalesce((select min(aberto_em) from t), 'infinity'), (p_de::timestamp at time zone (select z from tz))) as ini,
         greatest(coalesce((select max(coalesce(fechado_em, now())) from t), '-infinity'), ((p_ate + 1)::timestamp at time zone (select z from tz))) as fim
),
l0 as (
  select l.*, coalesce(l.turno_id, w.id, prox.id) as turno_atrib
    from public.fin_lancamentos l
    cross join lim
    left join lateral (
      select ct.id from public.caixa_turnos ct
       where ct.restaurante_id = p_restaurante and l.turno_id is null and ct.aberto_em <= l.criado_em
         and l.criado_em < coalesce(ct.fechado_em, 'infinity')
       order by ct.aberto_em desc limit 1
    ) w on true
    -- Pix online (0148) confirmado com o caixa fechado: o PRÓXIMO turno que abrir adota.
    left join lateral (
      select ct.id from public.caixa_turnos ct
       where ct.restaurante_id = p_restaurante and l.turno_id is null and w.id is null and l.carteira = 'online'
         and ct.aberto_em > l.criado_em
       order by ct.aberto_em asc limit 1
    ) prox on true
   where l.restaurante_id = p_restaurante
     and (l.turno_id in (select id from t) or (l.criado_em >= lim.ini and l.criado_em < lim.fim)
          or (l.turno_id is null and l.carteira = 'online' and l.criado_em >= lim.ini - interval '7 days' and l.criado_em < lim.fim))
),
-- Linhas dos turnos do período + "fora de turno" (sem turno e fora de toda janela) com data no período.
lt as (
  select l0.* from l0 where l0.turno_atrib in (select id from t)
  union all
  select l0.* from l0, tz where l0.turno_atrib is null and (l0.criado_em at time zone tz.z)::date between p_de and p_ate
),
-- Filtros de LINHA (origem, forma, operador, motoboy): os valores mostrados passam a ser só dessas linhas.
lf as (
  select lt.* from lt
    left join public.pedidos pe on pe.id = lt.pedido_id
   where (p_origens is null or public.fin_grupo_origem(lt.origem) = any(p_origens))
     and (p_formas is null or public.fin_grupo_forma(lt.forma) = any(p_formas))
     and (p_operador is null or lt.usuario_id = p_operador)
     and (p_entregador is null or lt.entregador_id = p_entregador or pe.entregador_id = p_entregador)
),
-- "Vendas" = recebimentos (+ troco devolvido pelo motoboy, + estornos negativos) fora das contrapartidas.
v as (select * from lf where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado')),
-- Cada comanda/pedido conta taxas, descontos e produto UMA vez: no turno do primeiro recebimento dele.
cm as (
  select distinct on (comanda_id) comanda_id, turno_atrib from v where comanda_id is not null order by comanda_id, seq
),
pd as (
  select distinct on (pedido_id) pedido_id, turno_atrib from v where pedido_id is not null and comanda_id is null order by pedido_id, seq
),
tx as (
  select x.turno_atrib, sum(x.taxas) taxas, sum(x.descontos) descontos from (
    select cm.turno_atrib, round((ct.total - ct.subtotal + ct.desconto) * 100)::bigint taxas, round(ct.desconto * 100)::bigint descontos
      from cm cross join lateral public.comanda_totais(cm.comanda_id) ct
    union all
    select pd.turno_atrib, round(coalesce(p.taxa_entrega, 0) * 100)::bigint, round(coalesce(p.desconto, 0) * 100)::bigint
      from pd join public.pedidos p on p.id = pd.pedido_id
  ) x group by x.turno_atrib
),
prod as (
  select x.turno_atrib, sum(i.quantidade)::numeric qtd, round(sum(i.preco_unitario * i.quantidade) * 100)::bigint valor
    from (
      select cm.turno_atrib, p.id pedido_id from cm join public.pedidos p on p.comanda_id = cm.comanda_id and p.status <> 'cancelado'
      union
      select pd.turno_atrib, pd.pedido_id from pd join public.pedidos p on p.id = pd.pedido_id and p.status <> 'cancelado'
    ) x
    join public.pedido_itens i on i.pedido_id = x.pedido_id and i.cancelado_em is null and i.item_id = p_produto
   where p_produto is not null
   group by x.turno_atrib
),
-- Pix ainda a conferir: entrada em pix_conferir que nenhuma outra linha resolveu (confirmou ou mandou para a receber).
pixpend as (
  select lf.turno_atrib, sum(lf.valor_centavos) s from lf
   where lf.carteira = 'pix_conferir' and lf.valor_centavos > 0
     and not exists (select 1 from public.fin_lancamentos r where r.restaurante_id = p_restaurante and r.referencia_id = lf.id and r.carteira = 'pix_conferir')
   group by lf.turno_atrib
),
agg as (
  select turno_atrib,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado')), 0) vendido,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira = 'a_receber'), 0) a_receber,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and public.fin_grupo_forma(forma) = 'dinheiro'), 0) dinheiro,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and public.fin_grupo_forma(forma) = 'pix'), 0) pix,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and public.fin_grupo_forma(forma) = 'cartao'), 0) cartao,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and public.fin_grupo_forma(forma) = 'outros'), 0) outros,
    coalesce(-sum(valor_centavos) filter (where tipo = 'pix_confirmado' and carteira = 'pix_conferir'), 0) pix_confirmado,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and public.fin_grupo_origem(origem) = 'balcao'), 0) o_balcao,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and public.fin_grupo_origem(origem) = 'mesa'), 0) o_mesa,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and public.fin_grupo_origem(origem) = 'delivery'), 0) o_delivery,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and public.fin_grupo_origem(origem) = 'online'), 0) o_online,
    coalesce(sum(valor_centavos) filter (where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and public.fin_grupo_origem(origem) = 'manual'), 0) o_manual,
    coalesce(-sum(valor_centavos) filter (where tipo = 'estorno'), 0) estornos,
    coalesce(-sum(valor_centavos) filter (where carteira = 'gaveta' and tipo in ('sangria', 'retirada')), 0) sangrias,
    coalesce(sum(valor_centavos) filter (where carteira = 'gaveta' and tipo = 'reforco'), 0) reforcos,
    coalesce(-sum(valor_centavos) filter (where carteira = 'gaveta' and tipo in ('despesa', 'perda', 'compra')), 0) despesas,
    coalesce(sum(valor_centavos) filter (where carteira = 'motoboy'), 0) motoboy,
    count(*)::int n
  from lf group by turno_atrib
),
-- Gaveta SEM filtro (o esperado do turno não muda com o filtro).
gav as (select turno_atrib, sum(valor_centavos) filter (where carteira = 'gaveta') gaveta from lt group by turno_atrib),
canc as (
  select t.id turno_atrib, round(sum(p.total) * 100)::bigint valor, count(*)::int qtd
    from t join public.pedidos p on p.restaurante_id = p_restaurante and p.status = 'cancelado'
     and p.cancelado_em >= t.aberto_em and p.cancelado_em < coalesce(t.fechado_em, 'infinity')
   group by t.id
),
linhas as (
  select t.id turno_atrib, t.aberto_em, t.aberto_por_nome, t.fechado_em, t.fechado_por_nome, t.status,
         t.reaberto_em, t.reaberto_por_nome, t.reaberto_motivo, t.valor_inicial_centavos, t.esperado_dinheiro_centavos,
         t.contado_dinheiro_centavos, t.diferenca_centavos, t.diferenca_cartao_centavos, t.contado_cartao_centavos,
         t.esperado_cartao_centavos, nullif(concat_ws(' · ', nullif(btrim(t.observacao), ''), nullif(btrim(t.justificativa), '')), '') obs
    from t
  union all
  -- "Fora de turno": só aparece se houver linha sem turno no período.
  select null, null, null, null, null, 'sem_turno', null, null, null, null, null, null, null, null, null, null, null
   where exists (select 1 from lt where turno_atrib is null)
)
select
  li.turno_atrib,
  case when li.aberto_em is null then null else (li.aberto_em at time zone (select z from tz))::date end,
  li.aberto_em, li.aberto_por_nome, li.fechado_em, li.fechado_por_nome, li.status,
  case
    when li.status = 'sem_turno' then 'sem_turno'
    when li.fechado_em is null then case when li.status = 'reaberto' then 'reaberto' else 'aberto' end
    when coalesce(li.diferenca_centavos, 0) <> 0 or coalesce(li.diferenca_cartao_centavos, 0) <> 0 then 'divergente'
    else 'fechado'
  end,
  li.reaberto_em, li.reaberto_por_nome, li.reaberto_motivo,
  coalesce(li.valor_inicial_centavos, 0),
  coalesce(a.vendido, 0), coalesce(a.vendido, 0) - coalesce(a.a_receber, 0), coalesce(a.a_receber, 0),
  coalesce(a.dinheiro, 0), coalesce(a.pix, 0), coalesce(a.pix_confirmado, 0), coalesce(pp.s, 0), coalesce(a.cartao, 0), coalesce(a.outros, 0),
  coalesce(a.o_balcao, 0), coalesce(a.o_mesa, 0), coalesce(a.o_delivery, 0), coalesce(a.o_online, 0), coalesce(a.o_manual, 0),
  coalesce(tx.taxas, 0), coalesce(tx.descontos, 0), coalesce(cc.valor, 0), coalesce(cc.qtd, 0),
  coalesce(a.estornos, 0), coalesce(a.sangrias, 0), coalesce(a.reforcos, 0), coalesce(a.despesas, 0), coalesce(a.motoboy, 0),
  -- Esperado: o que o fechamento GRAVOU; turno aberto = saldo da gaveta agora.
  case when li.fechado_em is not null then li.esperado_dinheiro_centavos when li.aberto_em is not null then coalesce(g.gaveta, 0) end,
  li.contado_dinheiro_centavos, li.diferenca_centavos, li.diferenca_cartao_centavos, li.contado_cartao_centavos, li.esperado_cartao_centavos,
  li.obs, coalesce(a.n, 0), pr.qtd, pr.valor
from linhas li
left join agg a on a.turno_atrib is not distinct from li.turno_atrib
left join gav g on g.turno_atrib is not distinct from li.turno_atrib
left join pixpend pp on pp.turno_atrib is not distinct from li.turno_atrib
left join tx on tx.turno_atrib is not distinct from li.turno_atrib
left join canc cc on cc.turno_atrib = li.turno_atrib
left join prod pr on pr.turno_atrib is not distinct from li.turno_atrib
where ((p_origens is null and p_formas is null and p_operador is null and p_entregador is null) or a.n > 0)
  and (p_produto is null or pr.qtd > 0)
order by (li.fechado_em is null and li.aberto_em is not null) desc, li.aberto_em desc nulls last
$$;
revoke execute on function public.fin_fluxo_turnos(uuid, date, date, text[], text[], uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fin_fluxo_turnos(uuid, date, date, text[], text[], uuid, uuid, uuid) to service_role;

-- ─── 6. transições com o estado novo ───────────────────────────────────────────────────────────
-- Igual à 0094, mais: aguardando_pagamento só sai para recebido (pelo servidor e já pago) ou cancelado;
-- nada entra em aguardando_pagamento depois de criado.
create or replace function public.pedidos_transicao_valida()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_presencial boolean := new.canal in ('mesa', 'balcao');
  v_servidor boolean := coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres', 'supabase_admin', 'service_role');
begin
  if new.status is not distinct from old.status then
    -- Pago de pedido que espera Pix online: só o servidor (confirmação pela API) marca.
    if old.status = 'aguardando_pagamento' and new.pago is distinct from old.pago and not v_servidor then
      raise exception 'pagamento_online_so_servidor' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status = 'aguardando_pagamento' then
    raise exception 'transicao_invalida:%>%', old.status, new.status using errcode = 'P0001';
  end if;
  if old.status = 'aguardando_pagamento' then
    if new.status = 'cancelado' then
      null;
    elsif new.status = 'recebido' and v_servidor and new.pago then
      null;
    else
      raise exception 'transicao_invalida:%>%', old.status, new.status using errcode = 'P0001';
    end if;
  end if;

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
