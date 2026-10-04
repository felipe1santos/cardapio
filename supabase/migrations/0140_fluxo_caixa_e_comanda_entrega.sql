-- 0140 — Financeiro Fase 4: Fluxo de Caixa (agregação no banco) + entrega paga fecha a comanda do PDV.
--
-- PARTE 0 (bug): a 0137 fechava a comanda do PDV (balcão → entrega) só quando o pagamento era registrado NA
-- entrega. Quando a conta já tinha sido paga no PDV (antes de sair, ou depois de entregue), a comanda ficava
-- "aberta" com restante R$ 0,00 — o registro da entrega via "já pago" e pulava a quitação, e nada fechava a
-- conta quando o pedido virava "entregue" por outro caminho (Logística/Kanban). Agora, ao fim da transação
-- (gatilhos ADIADOS, para não atropelar "Receber e fechar", que paga e fecha na mesma transação):
--   - pedido de entrega virou "entregue", ou
--   - entrou pagamento na comanda (que não seja o da própria entrega, já tratado pela 0137),
-- e a comanda é de balcão, todos os pedidos não cancelados são de ENTREGA e estão ENTREGUES e não sobra saldo,
-- ela é fechada com `comanda_fechar_presencial`. Nenhum lançamento novo no livro-caixa (fechar não lança).
-- Só em loja com o financeiro ligado. Sem backfill: em produção só a loja de teste (Menuzia) tinha conta presa.
--
-- PARTE 1: `fin_fluxo_turnos` — uma linha por turno (e uma "fora de turno"), calculada do livro-caixa
-- (fin_lancamentos) e de caixa_turnos. Só leitura, service_role. Detalhes das regras em
-- docs/financeiro/fase4-fluxo.md.
-- Rollback: docs/rollback/0140_fluxo_caixa_e_comanda_entrega.down.sql

-- ── Parte 0 ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fin_fechar_comanda_entrega_quitada(p_restaurante uuid, p_comanda uuid, p_ator uuid, p_ator_nome text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_comanda is null then return false; end if;
  if not exists (select 1 from public.restaurantes where id = p_restaurante and financeiro_ativo) then return false; end if;
  if not exists (select 1 from public.comandas where id = p_comanda and restaurante_id = p_restaurante and status = 'aberta' and tipo = 'balcao') then
    return false;
  end if;
  -- Conta de ENTREGA: todo pedido não cancelado é de entrega e já foi entregue (outro na cozinha = espera).
  if exists (select 1 from public.pedidos where comanda_id = p_comanda and status <> 'cancelado' and (tipo <> 'entrega' or status <> 'entregue')) then
    return false;
  end if;
  if not exists (select 1 from public.pedidos where comanda_id = p_comanda and status = 'entregue') then return false; end if;
  if (select restante from public.comanda_totais(p_comanda)) > 0.004 then return false; end if;
  begin
    perform public.comanda_fechar_presencial(p_restaurante, p_comanda, p_ator, coalesce(nullif(btrim(p_ator_nome), ''), 'Sistema'), 'entrega');
    return true;
  exception when others then
    return false; -- cancelamento pendente etc.: fica aberta, como antes
  end;
end $$;
revoke execute on function public.fin_fechar_comanda_entrega_quitada(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fin_fechar_comanda_entrega_quitada(uuid, uuid, uuid, text) to service_role;

create or replace function public.fin_pedido_entregue_fecha_comanda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_fechar_comanda_entrega_quitada(new.restaurante_id, new.comanda_id, null, 'Sistema (entrega)');
  return null;
end $$;

create or replace function public.fin_pagamento_fecha_comanda_entrega() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.fin_fechar_comanda_entrega_quitada(new.restaurante_id, new.comanda_id, new.criado_por, new.criado_por_nome);
  return null;
end $$;

drop trigger if exists fin_pedido_entregue_fecha_comanda on public.pedidos;
create constraint trigger fin_pedido_entregue_fecha_comanda
  after update of status on public.pedidos
  deferrable initially deferred
  for each row
  when (new.status = 'entregue' and old.status is distinct from 'entregue' and new.comanda_id is not null and new.tipo = 'entrega')
  execute function public.fin_pedido_entregue_fecha_comanda();

drop trigger if exists fin_pagamento_fecha_comanda_entrega on public.pagamentos_comanda;
create constraint trigger fin_pagamento_fecha_comanda_entrega
  after insert on public.pagamentos_comanda
  deferrable initially deferred
  for each row
  when (new.origem is distinct from 'entrega')
  execute function public.fin_pagamento_fecha_comanda_entrega();

-- ── Parte 1: índices ───────────────────────────────────────────────────────────────────────────
create index if not exists fin_lancamentos_referencia_idx on public.fin_lancamentos (restaurante_id, referencia_id) where referencia_id is not null;
create index if not exists pedidos_cancelado_em_idx on public.pedidos (restaurante_id, cancelado_em) where cancelado_em is not null;

-- ── Parte 1: agregação do fluxo ──────────────────────────────────────────────────────────────
-- Grupos (filtros e colunas):
--   origem: balcao (pdv, balcao) · mesa · delivery (delivery, motoboy) · online · manual (manual, sistema)
--   forma : dinheiro · pix · cartao (credito, debito, cartao) · outros (vale, fiado, …, sem forma)
create or replace function public.fin_grupo_origem(o text) returns text language sql immutable as $$
  select case o when 'pdv' then 'balcao' when 'balcao' then 'balcao' when 'mesa' then 'mesa'
                when 'delivery' then 'delivery' when 'motoboy' then 'delivery' when 'online' then 'online' else 'manual' end
$$;
create or replace function public.fin_grupo_forma(f text) returns text language sql immutable as $$
  select case f when 'dinheiro' then 'dinheiro' when 'pix' then 'pix' when 'credito' then 'cartao' when 'debito' then 'cartao'
                when 'cartao' then 'cartao' else 'outros' end
$$;

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
  select l.*, coalesce(l.turno_id, w.id) as turno_atrib
    from public.fin_lancamentos l
    cross join lim
    left join lateral (
      select ct.id from public.caixa_turnos ct
       where ct.restaurante_id = p_restaurante and l.turno_id is null and ct.aberto_em <= l.criado_em
         and l.criado_em < coalesce(ct.fechado_em, 'infinity')
       order by ct.aberto_em desc limit 1
    ) w on true
   where l.restaurante_id = p_restaurante
     and (l.turno_id in (select id from t) or (l.criado_em >= lim.ini and l.criado_em < lim.fim))
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

-- ── Parte 1: permissão "Exportar relatórios financeiros" (financeiro_exportar) ──────────────────
-- Padrão do papel: dono e gerente. Gerente com acessos PERSONALIZADOS que já vê os valores do financeiro
-- e cargo de gerente ganha a exportação (mesmo critério da 0128 com "taxa"). Só lojas com o financeiro ligado.
update public.usuarios u
   set acessos = jsonb_set(u.acessos, '{sensiveis}', coalesce(u.acessos->'sensiveis', '[]'::jsonb) || '["financeiro_exportar"]'::jsonb)
  from public.restaurantes r
 where r.id = u.restaurante_id and r.financeiro_ativo
   and u.papel = 'gerente' and u.acessos is not null
   and coalesce(nullif(btrim(u.cargo), ''), 'gerente') = 'gerente'   -- garçom/caixa com papel gerente não ganha
   and coalesce(u.acessos->'sensiveis', '[]'::jsonb) ? 'financeiro'
   and not coalesce(u.acessos->'sensiveis', '[]'::jsonb) ? 'financeiro_exportar';
