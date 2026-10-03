-- Rollback da 0136 (rodar como dono do banco). ATENÇÃO: apaga os registros de pagamento na entrega
-- (fin_entregas_pagamento); os lançamentos do livro-caixa ficam (imutáveis). Exporte antes se houver dados.
begin;
drop function if exists public.entrega_registrar(uuid, uuid, uuid, text, bigint, text, text, text, uuid, text, text);
-- pendência automática como na 0135
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
    -- Financeiro ligado: o caixa NÃO abre sozinho. Dinheiro não pago vira "a acertar" do motoboy.
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

  -- Sem financeiro: turno automático = dia operacional.
  perform public.caixa_turno_virar_dia(new.restaurante_id);
  insert into public.caixa_turnos (restaurante_id, aberto_em, aberto_por_nome)
  values (new.restaurante_id, now(), 'Automático (1ª entrega)')
  on conflict (restaurante_id) where fechado_em is null do nothing;
  return null;
end $$;
revoke execute on function public.caixa_turno_abre_na_entrega() from public, anon, authenticated;
drop table if exists public.fin_entregas_pagamento;
alter table public.fin_config drop constraint if exists fin_config_troco_modo_check, drop column if exists troco_modo, drop column if exists troco_modo_proximo, drop column if exists fundo_padrao_centavos;
alter table public.pedidos drop column if exists saiu_para_entrega_em;
drop index if exists public.entregadores_usuario_uidx;
alter table public.entregadores drop column if exists usuario_id, drop column if exists desativado_em;
do $$ begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where name = '0136_financeiro_motoboy.sql';
  end if;
end $$;
commit;
