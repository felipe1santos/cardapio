-- 0167 — Dois níveis do Financeiro (09/10):
--   nível 1 "Financeiro ligado" (financeiro_ativo) — menu, relatórios, contas, compras, CMV, DRE; o PDV, a mesa e o
--     delivery vendem IGUAL a sem financeiro: pagamento sem caixa aberto abre o caixa automático do dia (vira às
--     05:00), a entrega segue o fluxo de sempre (acerto do motoboy na Logística), sem PIN nem trava.
--   nível 2 "Controle de caixa ativo" (financeiro_ativo E controle_caixa_ativo) — o comportamento validado na Menuzia:
--     abrir/fechar caixa obrigatório, contagem cega, travas da gaveta, PIN nas diferenças e estornos.
-- Lojas sem financeiro: nada muda (fin_caixa_estrito = false, mesmo caminho de antes). A Menuzia fica no nível 2.
-- Rollback: docs/rollback/0167_dois_niveis_financeiro.down.sql
alter table public.restaurantes add column if not exists controle_caixa_ativo boolean not null default false;
alter table public.restaurantes add column if not exists controle_caixa_ativado_em timestamptz;
alter table public.restaurantes add column if not exists controle_caixa_ativado_por_nome text;
update public.restaurantes set controle_caixa_ativo = true, controle_caixa_ativado_em = coalesce(controle_caixa_ativado_em, now()), controle_caixa_ativado_por_nome = coalesce(controle_caixa_ativado_por_nome, 'Suporte Menuzia (0167)')
 where slug = 'menuzia' and financeiro_ativo;

create or replace function public.fin_caixa_estrito(p_restaurante uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select financeiro_ativo and controle_caixa_ativo from public.restaurantes where id = p_restaurante), false)
$$;
revoke execute on function public.fin_caixa_estrito(uuid) from public, anon, authenticated;

-- Caixa automático do nível 1 (mesmo nome do caixa automático de sem financeiro, para a Logística reconhecer).
create or replace function public.fin_turno_automatico(p_restaurante uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  insert into public.caixa_turnos (restaurante_id, aberto_em, aberto_por_nome)
  values (p_restaurante, now(), 'Automático (1ª venda)')
  on conflict (restaurante_id) where fechado_em is null do nothing
  returning id into v;
  if v is null then select id into v from public.caixa_turnos where restaurante_id = p_restaurante and fechado_em is null limit 1; end if;
  return v;
end $$;
revoke execute on function public.fin_turno_automatico(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fin_pagamento_no_caixa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_turno uuid;
  v_orig public.fin_lancamentos%rowtype;
  v_centavos bigint;
  v_estrito boolean;
begin
  if not exists (select 1 from public.restaurantes r where r.id = new.restaurante_id and r.financeiro_ativo) then
    return new;
  end if;
  -- 0137: pagamento gravado pelo registro da entrega — o livro-caixa já recebeu (motoboy, cartão, Pix).
  if new.origem = 'entrega' then return new; end if;
  -- Nível 1 (controle de caixa desligado, 0167): o caixa é o automático do dia operacional — vira às 05:00.
  v_estrito := public.fin_caixa_estrito(new.restaurante_id);
  if not v_estrito then perform public.caixa_turno_virar_dia(new.restaurante_id); end if;
  select id into v_turno from public.caixa_turnos
   where restaurante_id = new.restaurante_id and fechado_em is null limit 1;
  -- Nível 1: sem caixa aberto, abre o automático em vez de recusar (o PDV vende igual a sem financeiro).
  if v_turno is null and not v_estrito then v_turno := public.fin_turno_automatico(new.restaurante_id); end if;

  if tg_op = 'INSERT' then
    if v_turno is null then raise exception 'caixa_fechado' using errcode = 'P0001'; end if;
    v_centavos := round(new.valor * 100)::bigint;
    if v_centavos <= 0 then return new; end if;
    insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
      comanda_id, pagamento_id, usuario_id, usuario_nome, chave_idempotencia, dados)
    values (new.restaurante_id, gen_random_uuid(), 1, v_turno, public.fin_carteira_da_forma(new.forma), 'recebimento', v_centavos, new.forma,
      case when new.canal = 'balcao' then 'balcao' else 'mesa' end,
      new.comanda_id, new.id, new.criado_por, coalesce(nullif(trim(new.criado_por_nome), ''), 'Sistema'), 'pag:' || new.id,
      jsonb_build_object('recebido_centavos', round(coalesce(new.valor_recebido, new.valor) * 100)::bigint,
                         'troco_centavos', round(coalesce(new.troco, 0) * 100)::bigint, 'origem_tela', new.origem));
    return new;
  end if;

  -- UPDATE: estorno (estornado_em passou a ter valor).
  if old.estornado_em is null and new.estornado_em is not null then
    select * into v_orig from public.fin_lancamentos
     where restaurante_id = new.restaurante_id and pagamento_id = new.id and tipo = 'recebimento' order by id limit 1;
    if v_orig.id is null then return new; end if;   -- pagamento anterior ao financeiro: nada a estornar no livro
    if v_turno is null then raise exception 'caixa_fechado' using errcode = 'P0001'; end if;
    insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
      comanda_id, pagamento_id, referencia_id, motivo, usuario_id, usuario_nome, chave_idempotencia)
    values (new.restaurante_id, gen_random_uuid(), 1, v_turno, v_orig.carteira, 'estorno', -v_orig.valor_centavos, v_orig.forma, v_orig.origem,
      new.comanda_id, new.id, v_orig.id, left(new.estorno_motivo, 500), null,
      coalesce(nullif(trim(new.estornado_por_nome), ''), 'Sistema'), 'estorno:' || new.id);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.caixa_turno_virar_dia(p_restaurante uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record; v_fim timestamptz; v_n int := 0;
begin
  -- Só o controle de caixa ATIVO (nível 2, 0167) exige fechar à mão; sem financeiro ou no nível 1 vira sozinho.
  if public.fin_caixa_estrito(p_restaurante) then return 0; end if;
  for t in select * from public.caixa_turnos
            where restaurante_id = p_restaurante and fechado_em is null
              and aberto_em < public.caixa_inicio_dia_operacional(now()) for update loop
    v_fim := public.caixa_inicio_dia_operacional(t.aberto_em) + interval '1 day';
    update public.caixa_turnos
       set fechado_em = v_fim, fechado_por_nome = 'Automático (fim do dia)',
           observacao = coalesce(observacao || ' · ', '') || 'Fechado sozinho no fim do dia operacional (05:00).'
     where id = t.id;
    perform public.auditoria_registrar(p_restaurante, null, 'Sistema', 'caixa.fechou_turno', 'caixa', t.id,
      jsonb_build_object('automatico', true, 'motivo', 'fim do dia operacional', 'aberto_em', t.aberto_em, 'fechado_em', v_fim));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.cancelamento_sem_autoaprovacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'aprovada' and old.status = 'pendente' and new.decidido_por is not null
     and new.decidido_por = old.solicitado_por
     and public.fin_caixa_estrito(new.restaurante_id) then -- só com o controle de caixa ativo (0167)
    raise exception 'autoaprovacao';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.caixa_turno_abre_na_entrega()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fin boolean;
  v_turno uuid;
  v_pago boolean;
begin
  if not (new.status = 'entregue' and old.status is distinct from 'entregue' and new.entregador_id is not null) then
    return null;
  end if;
  -- Nível 1 (0167): a entrega segue como sem financeiro (caixa automático; acerto do motoboy na Logística).
  v_fin := public.fin_caixa_estrito(new.restaurante_id);

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
end $function$;
