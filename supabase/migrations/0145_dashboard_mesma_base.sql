-- 0145 — Dashboard financeiro e DRE na mesma base (pedido do dono em 2026-10-04, depois da conferência da Fase 6).
--
-- 1) Diferenças de caixa (sobras − faltas do fechamento) saem de "Despesas" e viram uma linha própria, com o
--    detalhe por turno. Antes, uma sobra virava "despesa negativa" e o lucro líquido passava do faturamento.
-- 2) Produtos, CMV e a conciliação contam SÓ as vendas que estão no livro-caixa do período (a mesma base do
--    faturamento, das origens e das formas de pagamento). Pedido sem lançamento (antigo, de antes do financeiro)
--    não entra. Uma venda pertence ao período do seu PRIMEIRO recebimento.
--
-- Só funções (create or replace / create): nenhuma tabela, nenhum dado muda. Rollback: recriar fin_dashboard da
-- 0144 e apagar fin_vendas_base / fin_diferencas_caixa.

-- ── 1. dashboard: despesas sem as diferenças de caixa; diferenças numa chave própria ──────────────────────────
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
  ), vb as (
    -- Venda = pedido/comanda com saldo positivo no período (pago e estornado inteiro não é venda).
    select bucket, count(*) n from (
      select bucket, coalesce(comanda_id, pedido_id) k from b
       where tipo in ('recebimento', 'troco', 'estorno') and carteira not in ('empresa', 'resultado') and coalesce(comanda_id, pedido_id) is not null
       group by 1, 2 having sum(valor_centavos) > 0) q
     group by bucket
  ), serie as (
    select g.bucket,
      coalesce(sum(b.valor_centavos) filter (where b.tipo in ('recebimento', 'troco', 'estorno') and b.carteira not in ('empresa', 'resultado')), 0) faturamento,
      coalesce(-sum(b.valor_centavos) filter (where b.carteira = 'resultado' and b.tipo not in ('conta_receber', 'compra', 'ajuste')
               and coalesce(b.dados->>'categoria_grupo', '') not in ('insumo', 'fora')), 0) despesas,
      coalesce(sum(b.valor_centavos) filter (where b.carteira = 'resultado' and b.tipo = 'ajuste'), 0) diferencas,
      coalesce(max(vb.n), 0) vendas
    from (select distinct case p_grupo when 'mes' then date_trunc('month', d)::date when 'semana' then date_trunc('week', d)::date else d::date end bucket
            from generate_series(p_de::timestamp, p_ate::timestamp, interval '1 day') d) g
    left join b on b.bucket = g.bucket
    left join vb on vb.bucket = g.bucket
    group by g.bucket order by g.bucket
  )
  select jsonb_build_object(
    'faturamento', (select coalesce(sum(valor_centavos), 0) from v),
    'vendas', (select count(*) from (select coalesce(comanda_id, pedido_id) k from v where coalesce(comanda_id, pedido_id) is not null
                group by 1 having sum(valor_centavos) > 0) q),
    'por_origem', (select coalesce(jsonb_object_agg(o, s), '{}'::jsonb) from (select public.fin_grupo_origem(origem) o, sum(valor_centavos) s from v group by 1) q),
    'por_forma', (select coalesce(jsonb_object_agg(f, s), '{}'::jsonb) from (select public.fin_grupo_forma(forma) f, sum(valor_centavos) s from v group by 1) q),
    'a_receber', (select coalesce(sum(valor_centavos), 0) from v where carteira = 'a_receber'),
    'a_conferir', (select s from pixpend),
    'sangrias', (select coalesce(-sum(valor_centavos), 0) from l where carteira = 'gaveta' and tipo in ('sangria', 'retirada')),
    'despesas', (select coalesce(-sum(valor_centavos), 0) from l where carteira = 'resultado' and tipo not in ('conta_receber', 'compra', 'ajuste')
                  and coalesce(dados->>'categoria_grupo', '') not in ('insumo', 'fora')),
    -- Diferenças de caixa: sobras (+) − faltas (−), como estão no resultado.
    'diferencas_caixa', (select coalesce(sum(valor_centavos), 0) from l where carteira = 'resultado' and tipo = 'ajuste'),
    'sobras', (select coalesce(sum(valor_centavos), 0) from l where carteira = 'resultado' and tipo = 'ajuste' and valor_centavos > 0),
    'faltas', (select coalesce(-sum(valor_centavos), 0) from l where carteira = 'resultado' and tipo = 'ajuste' and valor_centavos < 0),
    'divergencias_centavos', (select coalesce(sum(abs(valor_centavos)), 0) from l where carteira = 'gaveta' and tipo = 'ajuste'),
    'turnos_divergentes', (select count(*) from public.caixa_turnos t, lim where t.restaurante_id = p_restaurante and t.fechado_em >= lim.ini and t.fechado_em < lim.fim
                             and (coalesce(t.diferenca_centavos, 0) <> 0 or coalesce(t.diferenca_cartao_centavos, 0) <> 0)),
    'motoboy_agora', (select coalesce(sum(valor_centavos), 0) from public.fin_lancamentos m where m.restaurante_id = p_restaurante and m.carteira = 'motoboy'),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'faturamento', faturamento, 'despesas', despesas, 'diferencas', diferencas, 'vendas', vendas)
              order by bucket), '[]'::jsonb) from serie)
  )
$$;
revoke execute on function public.fin_dashboard(uuid, date, date, text) from public, anon, authenticated;

-- ── 2. diferenças de caixa por turno ────────────────────────────────────────────────────────────────────────
-- O ajuste da gaveta (que leva o turno) tem o mesmo valor do ajuste do resultado. Um turno reaberto e fechado de
-- novo soma os ajustes (líquido). Cartão é só informativo: a diferença do cartão não entra no livro-caixa.
create or replace function public.fin_diferencas_caixa(p_restaurante uuid, p_de date, p_ate date)
  returns table (turno_id uuid, aberto_em timestamptz, fechado_em timestamptz, aberto_por_nome text, fechado_por_nome text,
                 diferenca_centavos bigint, diferenca_cartao_centavos bigint, justificativa text)
  language sql stable security definer set search_path = public as $$
  with lim as (
    select (p_de::timestamp at time zone 'America/Sao_Paulo') ini, ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo') fim
  ), a as (
    select x.turno_id, sum(x.valor_centavos)::bigint dif from public.fin_lancamentos x, lim
     where x.restaurante_id = p_restaurante and x.carteira = 'gaveta' and x.tipo = 'ajuste' and x.criado_em >= lim.ini and x.criado_em < lim.fim
     group by x.turno_id
  )
  select a.turno_id, t.aberto_em, t.fechado_em, t.aberto_por_nome, t.fechado_por_nome, a.dif, coalesce(t.diferenca_cartao_centavos, 0)::bigint, t.justificativa
    from a left join public.caixa_turnos t on t.id = a.turno_id and t.restaurante_id = p_restaurante
   where a.dif <> 0
   order by t.fechado_em nulls last
$$;
revoke execute on function public.fin_diferencas_caixa(uuid, date, date) from public, anon, authenticated;

-- ── 3. vendas do período na base do livro-caixa: produtos, CMV e conciliação ────────────────────────────────
-- Venda = comanda (se houver) ou pedido com recebimento no livro-caixa. Entra no período do PRIMEIRO recebimento;
-- o que ela receber depois, em outro período, aparece na conciliação como "de vendas de outro período".
-- Conciliação: itens + taxas − descontos + outros + outro período + sem pedido = faturamento (sempre fecha).
create or replace function public.fin_vendas_base(p_restaurante uuid, p_de date, p_ate date, p_grupo text)
  returns jsonb language sql stable security definer set search_path = public as $$
  with lim as (
    select (p_de::timestamp at time zone 'America/Sao_Paulo') ini, ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo') fim
  ), v as (
    select x.* from public.fin_lancamentos x, lim
     where x.restaurante_id = p_restaurante and x.criado_em >= lim.ini and x.criado_em < lim.fim
       and x.tipo in ('recebimento', 'troco', 'estorno') and x.carteira not in ('empresa', 'resultado')
  ), chaves as (
    select coalesce(comanda_id, pedido_id) chave, bool_or(comanda_id is not null) e_comanda, sum(valor_centavos)::bigint recebido
      from v where coalesce(comanda_id, pedido_id) is not null group by 1
  ), primeira as (
    select c.*, (select min(y.criado_em) from public.fin_lancamentos y
                  where y.restaurante_id = p_restaurante and y.tipo = 'recebimento' and y.carteira not in ('empresa', 'resultado')
                    and coalesce(y.comanda_id, y.pedido_id) = c.chave) primeiro
      from chaves c
  ), vendas as (
    select p.chave, p.e_comanda, p.recebido,
           case p_grupo when 'mes' then date_trunc('month', (p.primeiro at time zone 'America/Sao_Paulo'))::date
                        when 'semana' then date_trunc('week', (p.primeiro at time zone 'America/Sao_Paulo'))::date
                        else (p.primeiro at time zone 'America/Sao_Paulo')::date end bucket
      from primeira p, lim where p.primeiro >= lim.ini and p.primeiro < lim.fim and p.recebido <> 0
  ), ped as (
    select vd.chave, vd.bucket, pe.id pedido_id, pe.total, pe.subtotal, coalesce(pe.desconto, 0) desconto
      from vendas vd join public.pedidos pe on pe.restaurante_id = p_restaurante
       and ((vd.e_comanda and pe.comanda_id = vd.chave and pe.status <> 'cancelado') or (not vd.e_comanda and pe.id = vd.chave))
  ), it as (
    select pd.bucket, pi.item_id, pi.nome, pi.quantidade::bigint qtd, (pi.preco_unitario * 100 * pi.quantidade) receita,
           c.situacao, c.custo_unitario
      from ped pd join public.pedido_itens pi on pi.pedido_id = pd.pedido_id and pi.cancelado_em is null
      left join public.pedido_itens_custo c on c.pedido_item_id = pi.id
  ), tot as (
    -- taxas = total − subtotal + desconto de cada pedido (entrega, embalagem, taxas da 0119...).
    select coalesce(sum(desconto), 0) * 100 desconto, coalesce(sum(total - coalesce(subtotal, total) + desconto), 0) * 100 taxas from ped
  )
  select jsonb_build_object(
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'nome', nome, 'qtd', qtd, 'receita', receita, 'custo', custo,
                                                           'qtd_com_custo', qtd_com_custo, 'receita_com_custo', receita_com_custo)), '[]'::jsonb)
                from (select item_id, max(nome) nome, sum(qtd) qtd, sum(receita) receita,
                             sum(custo_unitario * qtd) filter (where custo_unitario is not null and situacao <> 'sem_ficha') custo,
                             sum(qtd) filter (where custo_unitario is not null and situacao <> 'sem_ficha') qtd_com_custo,
                             sum(receita) filter (where custo_unitario is not null and situacao <> 'sem_ficha') receita_com_custo
                        from it group by item_id, case when item_id is null then nome end) q),
    'cmv_por_bucket', (select coalesce(jsonb_object_agg(bucket, custo), '{}'::jsonb)
                         from (select bucket, sum(custo_unitario * qtd) custo from it where custo_unitario is not null and situacao <> 'sem_ficha' group by bucket) q),
    'cmv', (select coalesce(sum(custo_unitario * qtd), 0) from it where custo_unitario is not null and situacao <> 'sem_ficha'),
    'linhas', (select count(*) from it),
    'sem_custo', (select count(*) from it where custo_unitario is null or situacao = 'sem_ficha'),
    'com_erro', (select count(*) from it where situacao = 'erro'),
    'conciliacao', jsonb_build_object(
      'faturamento', (select coalesce(sum(valor_centavos), 0) from v),
      'vendas', (select count(*) from vendas),
      'itens', (select coalesce(round(sum(receita)), 0) from it),
      'descontos', (select round(desconto) from tot),
      'taxas', (select round(taxas) from tot),
      -- o que sobra: taxa de serviço da comanda, gorjeta, pagamento parcial ou a mais, item cancelado ainda no subtotal.
      'outros', (select coalesce(sum(recebido), 0) from vendas) - coalesce((select round(sum(receita)) from it), 0) - (select round(taxas) from tot) + (select round(desconto) from tot),
      'outro_periodo', (select coalesce(sum(c.recebido), 0) from primeira c, lim where not (c.primeiro >= lim.ini and c.primeiro < lim.fim) or c.primeiro is null),
      'sem_pedido', (select coalesce(sum(valor_centavos), 0) from v where coalesce(comanda_id, pedido_id) is null)
    )
  )
$$;
revoke execute on function public.fin_vendas_base(uuid, date, date, text) from public, anon, authenticated;
