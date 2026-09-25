-- ============================================================================
-- 0099 — Taxa de entrega da conta só é cobrada enquanto houver item ativo
--
-- Antes: comanda_totais somava comandas.taxa_entrega sempre. Uma entrega do balcão
-- cujo único pedido era cancelado ainda cobrava a taxa (visto em produção: comanda #8
-- da loja menuzia, 2026-09-25), e o Dashboard — que soma os pedidos não cancelados —
-- deixava de bater com o caixa.
--
-- Regra nova (só para conta ABERTA):
--   · taxa cobrada ⇔ existe pelo menos um item ativo (pedido não cancelado e item não
--     cancelado). Cancelamento parcial que mantém item ativo não mexe na taxa; ela vale
--     uma vez por conta, como sempre;
--   · pagamento maior que o novo total NÃO é ajustado: o fechamento já recusa com
--     `ajuste_financeiro_necessario` (0096) e exige estorno autorizado.
--
-- Histórico preservado: conta fechada/cancelada usa o valor gravado no fechamento
-- (`taxa_entrega_cobrada`, coluna nova). Contas fechadas antes desta migration têm a
-- coluna nula e continuam mostrando a taxa como foi cobrada — nada é recalculado.
--
-- Pedidos: o primeiro pedido carrega a cópia da taxa (ficha, logística, Dashboard).
-- Cancelado esse pedido com outro ainda ativo, a cópia passa ao próximo pedido ativo;
-- lançamento novo numa conta cuja cópia está num pedido cancelado a recebe. Assim o
-- Dashboard continua igual ao caixa. Cada mudança é auditada uma única vez.
--
-- Só adiciona uma coluna, uma função e gatilhos, e substitui comanda_totais e
-- comanda_fechamento_simular (mesmas assinaturas). Nenhum dado existente é alterado.
-- Rollback: docs/rollback/0099_taxa_entrega_so_com_item_ativo.down.sql
-- ============================================================================

alter table public.comandas add column if not exists taxa_entrega_cobrada numeric(10,2);

comment on column public.comandas.taxa_entrega_cobrada is
  'Taxa de entrega efetivamente cobrada, gravada no fechamento (0099). Nula em conta aberta e em conta fechada antes da 0099.';

-- ─── taxa efetiva ──────────────────────────────────────────────────────────────
create or replace function public.comanda_taxa_entrega_efetiva(p_comanda uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when c.status <> 'aberta' then coalesce(c.taxa_entrega_cobrada, c.taxa_entrega, 0)
      when coalesce(c.taxa_entrega, 0) = 0 then 0
      when exists (select 1 from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
                    where p.comanda_id = c.id and p.status <> 'cancelado' and i.cancelado_em is null)
        then c.taxa_entrega
      else 0
    end
    from public.comandas c where c.id = p_comanda), 0)::numeric
$$;

revoke all on function public.comanda_taxa_entrega_efetiva(uuid) from public, anon, authenticated;

-- ─── totais da conta (0094) com a taxa efetiva ─────────────────────────────────
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
           desconto_percentual as desc_pct, public.comanda_taxa_entrega_efetiva(p_comanda) as entrega
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

-- ─── simulação do fechamento (0096) devolvendo a taxa efetiva ─────────────────
create or replace function public.comanda_fechamento_simular(
  p_restaurante uuid, p_comanda uuid, p_acoes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_cancelados jsonb;
  v_resultado jsonb;
begin
  perform 1 from public.comandas where id = p_comanda and restaurante_id = p_restaurante and status = 'aberta';
  if not found then raise exception 'comanda_nao_aberta'; end if;
  begin
    perform public.comanda_aplicar_decisoes(p_restaurante, p_comanda, p_acoes, null, 'simulação', null, 'simulacao');
    select * into t from public.comanda_totais(p_comanda);
    select coalesce(sum(i.preco_unitario * i.quantidade), 0) into v_cancelados
      from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
     where p.comanda_id = p_comanda and (p.status = 'cancelado' or i.cancelado_em is not null);
    v_resultado := jsonb_build_object('subtotal', t.subtotal, 'taxa', t.taxa_servico, 'desconto', t.desconto,
      'total', t.total, 'pago', t.pago, 'restante', t.restante, 'cancelados', round(v_cancelados::numeric, 2),
      'excedente', greatest(round(t.pago - t.total, 2), 0),
      'taxa_entrega', public.comanda_taxa_entrega_efetiva(p_comanda));
    raise exception 'simulacao_ok';
  exception when others then
    if sqlerrm <> 'simulacao_ok' then raise; end if;
  end;
  return v_resultado;
end $$;

-- ─── fechamento grava a taxa cobrada; reabrir limpa ────────────────────────────
create or replace function public.comanda_taxa_entrega_no_fechamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'aberta' and new.status <> 'aberta' then
    -- Lê a conta ainda aberta (a linha nova só vale depois do UPDATE).
    new.taxa_entrega_cobrada := public.comanda_taxa_entrega_efetiva(new.id);
  elsif old.status <> 'aberta' and new.status = 'aberta' then
    new.taxa_entrega_cobrada := null;
  end if;
  return new;
end $$;

revoke all on function public.comanda_taxa_entrega_no_fechamento() from public, anon, authenticated;

drop trigger if exists comandas_taxa_entrega_no_fechamento on public.comandas;
create trigger comandas_taxa_entrega_no_fechamento
  before update of status on public.comandas
  for each row execute function public.comanda_taxa_entrega_no_fechamento();

-- ─── utilitário: conta de entrega aberta com taxa, por pedido ─────────────────
create or replace function public.comanda_entrega_ativa_do_pedido(p_comanda uuid)
returns table(id uuid, restaurante_id uuid, taxa numeric)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.restaurante_id, c.taxa_entrega
    from public.comandas c
   where c.id = p_comanda and c.status = 'aberta' and c.entrega and coalesce(c.taxa_entrega, 0) > 0
$$;

revoke all on function public.comanda_entrega_ativa_do_pedido(uuid) from public, anon, authenticated;

create or replace function public.comanda_tem_item_ativo(p_comanda uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
                  where p.comanda_id = p_comanda and p.status <> 'cancelado' and i.cancelado_em is null)
$$;

revoke all on function public.comanda_tem_item_ativo(uuid) from public, anon, authenticated;

-- ─── pedido cancelado: audita a taxa que deixou de ser cobrada / move a cópia ──
create or replace function public.pedido_cancelado_taxa_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_tinha_item boolean;
  v_destino record;
  v_ator uuid := auth.uid();
  v_ator_nome text;
begin
  if new.status is not distinct from old.status or new.status <> 'cancelado' or new.comanda_id is null then return new; end if;
  select * into c from public.comanda_entrega_ativa_do_pedido(new.comanda_id);
  if c.id is null then return new; end if;
  if v_ator is not null then select u.nome into v_ator_nome from public.usuarios u where u.id = v_ator; end if;

  -- A cópia da taxa estava neste pedido e ainda há outro ativo: ela passa para ele.
  if coalesce(new.taxa_entrega, 0) > 0 then
    select p.id, p.numero into v_destino from public.pedidos p
     where p.comanda_id = c.id and p.id <> new.id and p.status <> 'cancelado'
     order by p.criado_em, p.numero limit 1;
    if v_destino.id is not null then
      update public.pedidos set taxa_entrega = taxa_entrega + new.taxa_entrega, total = round(total + new.taxa_entrega, 2)
       where id = v_destino.id;
      perform public.auditoria_registrar(c.restaurante_id, v_ator, v_ator_nome, 'conta.taxa_entrega_transferida', 'comanda', c.id,
        jsonb_build_object('de_pedido', new.numero, 'para_pedido', v_destino.numero, 'valor', new.taxa_entrega));
    end if;
  end if;

  -- Este pedido era o último com item ativo: a conta deixa de cobrar a taxa. Pedido
  -- cujos itens já tinham sido cancelados um a um já foi auditado pelo gatilho do item.
  select exists (select 1 from public.pedido_itens i where i.pedido_id = new.id and i.cancelado_em is null) into v_tinha_item;
  if v_tinha_item and not public.comanda_tem_item_ativo(c.id) then
    perform public.auditoria_registrar(c.restaurante_id, v_ator, v_ator_nome, 'conta.taxa_entrega_nao_cobrada', 'comanda', c.id,
      jsonb_build_object('valor', c.taxa, 'motivo', 'pedido_cancelado', 'pedido', new.numero));
  end if;
  return new;
end $$;

revoke all on function public.pedido_cancelado_taxa_entrega() from public, anon, authenticated;

drop trigger if exists pedidos_cancelado_taxa_entrega on public.pedidos;
create trigger pedidos_cancelado_taxa_entrega
  after update of status on public.pedidos
  for each row execute function public.pedido_cancelado_taxa_entrega();

-- ─── item cancelado: se era o último item ativo da conta, audita ──────────────
create or replace function public.item_cancelado_taxa_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  p record;
  v_ator uuid := auth.uid();
  v_ator_nome text;
begin
  if old.cancelado_em is not null or new.cancelado_em is null then return new; end if;
  select id, comanda_id, status, numero into p from public.pedidos where id = new.pedido_id;
  if p.comanda_id is null or p.status = 'cancelado' then return new; end if;
  select * into c from public.comanda_entrega_ativa_do_pedido(p.comanda_id);
  if c.id is null then return new; end if;
  if not public.comanda_tem_item_ativo(c.id) then
    if v_ator is not null then select u.nome into v_ator_nome from public.usuarios u where u.id = v_ator; end if;
    perform public.auditoria_registrar(c.restaurante_id, v_ator, v_ator_nome, 'conta.taxa_entrega_nao_cobrada', 'comanda', c.id,
      jsonb_build_object('valor', c.taxa, 'motivo', 'itens_cancelados', 'pedido', p.numero));
  end if;
  return new;
end $$;

revoke all on function public.item_cancelado_taxa_entrega() from public, anon, authenticated;

drop trigger if exists pedido_itens_cancelado_taxa_entrega on public.pedido_itens;
create trigger pedido_itens_cancelado_taxa_entrega
  after update of cancelado_em on public.pedido_itens
  for each row execute function public.item_cancelado_taxa_entrega();

-- ─── lançamento novo depois de tudo cancelado: a cópia volta para ele ─────────
create or replace function public.pedido_novo_taxa_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_ator uuid := auth.uid();
  v_ator_nome text;
begin
  if new.comanda_id is null or coalesce(new.taxa_entrega, 0) > 0 then return new; end if;
  select * into c from public.comanda_entrega_ativa_do_pedido(new.comanda_id);
  if c.id is null then return new; end if;
  -- Primeiro pedido da conta já nasce com a taxa (comanda_lancar); aqui só o caso em que
  -- a cópia ficou num pedido cancelado e nenhum pedido ativo a carrega.
  if not exists (select 1 from public.pedidos where comanda_id = c.id)
     or exists (select 1 from public.pedidos where comanda_id = c.id and status <> 'cancelado' and coalesce(taxa_entrega, 0) > 0) then
    return new;
  end if;
  new.taxa_entrega := c.taxa;
  new.total := round(coalesce(new.total, 0) + c.taxa, 2);
  if v_ator is not null then select u.nome into v_ator_nome from public.usuarios u where u.id = v_ator; end if;
  perform public.auditoria_registrar(c.restaurante_id, v_ator, v_ator_nome, 'conta.taxa_entrega_cobrada', 'comanda', c.id,
    jsonb_build_object('valor', c.taxa, 'motivo', 'novo_lancamento'));
  return new;
end $$;

revoke all on function public.pedido_novo_taxa_entrega() from public, anon, authenticated;

drop trigger if exists pedidos_novo_taxa_entrega on public.pedidos;
create trigger pedidos_novo_taxa_entrega
  before insert on public.pedidos
  for each row execute function public.pedido_novo_taxa_entrega();
