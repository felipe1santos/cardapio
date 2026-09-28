-- 0106 — Taxa manual na conta + Instagram da loja (impressão do Assistente Beta).
--
-- Aditiva. Nenhum dado existente muda de formato.
--
-- 1. comandas.taxa_extra_nome / taxa_extra_valor: UMA taxa manual por conta ("Couvert",
--    "Taxa extra"...), em R$, só naquela conta. Não é item: não entra em pedido_itens, no
--    cardápio nem no catálogo. Default 0 = contas existentes ficam exatamente como estão.
-- 2. comanda_totais: total = subtotal + serviço + TAXA MANUAL + entrega − desconto. Mesma
--    assinatura; o desconto continua limitado a subtotal + serviço (não desconta a taxa).
--    Quem já usa comanda_totais (fechamento, pagamento, total_final, conferir pago,
--    simulação) passa a considerar a taxa sem mudar.
-- 3. comanda_taxa_extra_definir: grava/remove a taxa só com a conta ABERTA, trava a linha,
--    confere que o já pago não passa do novo total e audita (conta.taxa_extra /
--    conta.removeu_taxa_extra) com quem, quando, nome e valor.
-- 4. comanda_fechamento_simular devolve também taxa_extra (resumo do fechamento).
-- 5. impressao_snapshot_pre_conta: + taxa manual, taxa de entrega, atendente e o número
--    do primeiro pedido (modelo novo da pré-conta do Beta). Campos novos; os antigos
--    continuam iguais — o Beta 0.2.0-beta.1 ignora o que não conhece.
-- 6. restaurantes.instagram_url: link do Instagram da loja (QR no fim da comanda da
--    cozinha do Beta). Só URL https do instagram.com com usuário válido.
--
-- Rollback: docs/rollback/0106_taxa_manual_e_instagram.down.sql

-- ─── 1. colunas da taxa manual ────────────────────────────────────────────────
alter table public.comandas add column if not exists taxa_extra_nome text;
alter table public.comandas add column if not exists taxa_extra_valor numeric(10,2) not null default 0;
alter table public.comandas add column if not exists taxa_extra_por_nome text;
alter table public.comandas add column if not exists taxa_extra_em timestamptz;

alter table public.comandas drop constraint if exists comandas_taxa_extra_check;
alter table public.comandas add constraint comandas_taxa_extra_check check (
  taxa_extra_valor >= 0 and taxa_extra_valor <= 9999.99
  and (taxa_extra_valor = 0 or (taxa_extra_nome is not null and char_length(btrim(taxa_extra_nome)) between 2 and 40))
);

comment on column public.comandas.taxa_extra_valor is
  'Taxa manual desta conta em R$ (0106). Entra no total por comanda_totais; não é item nem catálogo. 0 = sem taxa.';

-- ─── 2. totais com a taxa manual ─────────────────────────────────────────────
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
           desconto_percentual as desc_pct, public.comanda_taxa_entrega_efetiva(p_comanda) as entrega,
           coalesce(taxa_extra_valor, 0) as extra
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
           c.extra,
           pg.pago
      from base, c, pg
  ),
  calc as (
    select sub, taxa, least(desc_pedido, sub + taxa) as desc_aplicado, entrega, extra, pago from bruto
  )
  select sub, taxa, desc_aplicado, round(sub + taxa + extra + entrega - desc_aplicado, 2), pago,
         greatest(round(sub + taxa + extra + entrega - desc_aplicado - pago, 2), 0)
    from calc
$$;

-- ─── 3. definir / remover a taxa manual ──────────────────────────────────────
create or replace function public.comanda_taxa_extra_definir(
  p_restaurante uuid, p_comanda uuid, p_nome text, p_valor numeric, p_ator uuid, p_ator_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes record;
  v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
  v_valor numeric := round(coalesce(p_valor, 0), 2);
begin
  select status, taxa_extra_nome, taxa_extra_valor into v_antes
    from public.comandas where id = p_comanda and restaurante_id = p_restaurante for update;
  if v_antes.status is null then raise exception 'comanda_inexistente'; end if;
  if v_antes.status <> 'aberta' then raise exception 'comanda_nao_aberta'; end if;
  if v_valor < 0 or v_valor > 9999.99 then raise exception 'taxa_extra_invalida'; end if;
  if v_valor > 0 and (v_nome is null or char_length(v_nome) < 2 or char_length(v_nome) > 40) then
    raise exception 'taxa_extra_nome_invalido';
  end if;

  update public.comandas
     set taxa_extra_valor = v_valor,
         taxa_extra_nome = case when v_valor > 0 then v_nome end,
         taxa_extra_por_nome = case when v_valor > 0 then p_ator_nome end,
         taxa_extra_em = case when v_valor > 0 then now() end
   where id = p_comanda;

  -- Diminuir a taxa não pode deixar o já recebido acima do total.
  perform public.comanda_conferir_pago(p_comanda);

  if v_valor is distinct from v_antes.taxa_extra_valor or (v_valor > 0 and v_nome is distinct from v_antes.taxa_extra_nome) then
    insert into public.eventos_auditoria (restaurante_id, ator, usuario_id, usuario_nome, acao, entidade, entidade_id, dados)
    values (p_restaurante, 'usuario', p_ator, p_ator_nome,
            case when v_valor = 0 then 'conta.removeu_taxa_extra' else 'conta.taxa_extra' end,
            'comanda', p_comanda,
            jsonb_build_object(
              'nome', case when v_valor > 0 then v_nome else v_antes.taxa_extra_nome end,
              'de', v_antes.taxa_extra_valor, 'para', v_valor,
              'nome_anterior', v_antes.taxa_extra_nome,
              'resumo', case when v_valor = 0 then 'Removeu ' || coalesce(v_antes.taxa_extra_nome, 'taxa')
                             else v_nome || ' R$ ' || replace(to_char(v_valor, 'FM999990.00'), '.', ',') end));
  end if;

  return (select to_jsonb(t) from public.comanda_totais(p_comanda) t)
         || jsonb_build_object('taxa_extra', v_valor, 'taxa_extra_nome', case when v_valor > 0 then v_nome end);
end $$;

revoke all on function public.comanda_taxa_extra_definir(uuid, uuid, text, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.comanda_taxa_extra_definir(uuid, uuid, text, numeric, uuid, text) to service_role;

-- ─── 4. simulação do fechamento com a taxa manual ────────────────────────────
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
      'taxa_entrega', public.comanda_taxa_entrega_efetiva(p_comanda),
      'taxa_extra', (select taxa_extra_valor from public.comandas where id = p_comanda),
      'taxa_extra_nome', (select taxa_extra_nome from public.comandas where id = p_comanda));
    raise exception 'simulacao_ok';
  exception when others then
    if sqlerrm <> 'simulacao_ok' then raise; end if;
  end;
  return v_resultado;
end $$;

-- ─── 5. snapshot da pré-conta com os campos do modelo novo ───────────────────
CREATE OR REPLACE FUNCTION public.impressao_snapshot_pre_conta(p_comanda uuid, p_via integer, p_operador text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c record;
  t record;
  v_itens jsonb;
  v_cancelados jsonb;
  v_pagamentos jsonb;
  v_pedido_numero int;
begin
  select co.id, co.tipo, co.numero, co.senha, co.cliente_nome, co.aberta_em, co.taxa_servico_percentual,
         co.taxa_extra_nome, co.taxa_extra_valor, co.responsavel_nome, co.aberta_por_nome,
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
           'observacao', nullif(btrim(coalesce(i.observacao, '')), ''),
           'complementos', coalesce((
              select jsonb_agg(jsonb_build_object('nome', x.e->>'nome', 'preco', round(coalesce((x.e->>'preco')::numeric, 0), 2))
                               order by o.grupo_pos nulls last, o.pos nulls last, o.id nulls last, x.ord)
                from jsonb_array_elements(coalesce(i.complementos, '[]'::jsonb)) with ordinality x(e, ord)
                left join lateral (
                  select g.posicao as grupo_pos, ic.posicao as pos, ic.id
                    from public.item_complementos ic
                    left join public.grupos_item_complementos g on g.id = ic.grupo_id
                   where ic.item_id = i.item_id and ic.nome = x.e->>'nome'
                   order by g.posicao nulls last, ic.posicao nulls last, ic.id
                   limit 1) o on true), '[]'::jsonb),
           'preco_unitario', round(i.preco_unitario, 2),
           'subtotal', round(i.preco_unitario * i.quantidade, 2))
           order by p.criado_em, p.numero, i.lancamento_seq nulls last, i.id), '[]'::jsonb)
    into v_itens
    from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
   where p.comanda_id = p_comanda and p.status <> 'cancelado' and i.cancelado_em is null;

  select coalesce(jsonb_agg(jsonb_build_object('quantidade', i.quantidade, 'nome', i.nome)
           order by p.criado_em, p.numero, i.lancamento_seq nulls last, i.id), '[]'::jsonb)
    into v_cancelados
    from public.pedidos p join public.pedido_itens i on i.pedido_id = p.id
   where p.comanda_id = p_comanda and (p.status = 'cancelado' or i.cancelado_em is not null);

  select coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'valor', round(valor, 2)) order by criado_em, id), '[]'::jsonb)
    into v_pagamentos
    from public.pagamentos_comanda
   where comanda_id = p_comanda and estornado_em is null;

  select p.numero into v_pedido_numero
    from public.pedidos p where p.comanda_id = p_comanda order by p.criado_em, p.numero limit 1;

  return jsonb_build_object(
    'versao', 1,
    'loja', c.loja_nome,
    'tipo', c.tipo,
    'mesa', c.mesa_nome,
    'comanda_numero', c.numero,
    'pedido_numero', v_pedido_numero,
    'senha', c.senha,
    'cliente_nome', case when c.tipo = 'balcao' then c.cliente_nome end,
    'atendente', coalesce(nullif(btrim(c.responsavel_nome), ''), nullif(btrim(c.aberta_por_nome), '')),
    'aberta_em', c.aberta_em,
    'impresso_em', now(),
    'operador', p_operador,
    'via', p_via,
    'itens', v_itens,
    'cancelados', v_cancelados,
    'subtotal', t.subtotal,
    'taxa_percentual', c.taxa_servico_percentual,
    'taxa', t.taxa_servico,
    'taxa_extra_nome', case when coalesce(c.taxa_extra_valor, 0) > 0 then c.taxa_extra_nome end,
    'taxa_extra', coalesce(c.taxa_extra_valor, 0),
    'taxa_entrega', public.comanda_taxa_entrega_efetiva(p_comanda),
    'desconto', t.desconto,
    'total', t.total,
    'pago', t.pago,
    'restante', t.restante,
    'pagamentos', v_pagamentos);
end $function$;

revoke execute on function public.impressao_snapshot_pre_conta(uuid, int, text) from public, anon, authenticated;
grant execute on function public.impressao_snapshot_pre_conta(uuid, int, text) to service_role;

-- ─── 6. Instagram da loja ─────────────────────────────────────────────────────
alter table public.restaurantes add column if not exists instagram_url text;
alter table public.restaurantes drop constraint if exists restaurantes_instagram_url_check;
alter table public.restaurantes add constraint restaurantes_instagram_url_check check (
  instagram_url is null
  or instagram_url ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._]{1,30}/?$'
);
comment on column public.restaurantes.instagram_url is
  'Instagram da loja (0106), sempre https://instagram.com/<usuario>. Vira o QR no fim da comanda da cozinha do Beta.';

-- 0080: authenticated só enxerga/edita coluna liberada uma a uma.
grant select (instagram_url) on public.restaurantes to authenticated;
grant update (instagram_url) on public.restaurantes to authenticated;
