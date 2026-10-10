-- 0171 — Nível 1 do Financeiro (0167): pedido ENTREGUE entra sozinho no livro-caixa (09/10).
-- Sem isto, no nível 1 o delivery pago na entrega e os pedidos do cardápio online nunca chegavam ao livro (só o
-- Pix online e o "Receber" da conta) — e as vendas do Financeiro (DRE, Fluxo, gráfico de lucro) vêm do livro.
--   · pedido do cardápio (sem conta): recebimento de pedido.total na forma do pedido, no caixa automático do dia;
--   · delivery do PDV (conta de balcão com entrega): "Receber na entrega" — registra o que falta na conta na forma
--     escolhida (comanda_pagamento_registrar), e o 0137 fecha a conta quitada;
--   · mesa e balcão com retirada: NÃO (a mesa paga no fechamento; no balcão o operador recebe na hora).
-- Só no nível 1 (financeiro ligado e controle de caixa desligado): no nível 2 o motoboy registra a entrega (0136).
-- Idempotente (chave 'entregue:<pedido>'); pedido que já tem recebimento no livro (Pix online) é ignorado.
-- NUNCA impede a entrega: qualquer erro vira aviso no log e o status muda do mesmo jeito.
-- Rollback: docs/rollback/0171_entregue_no_caixa_nivel1.down.sql
create or replace function public.fin_entregue_no_caixa()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_turno uuid;
  v_forma text;
  v_restante numeric;
begin
  if not exists (select 1 from public.restaurantes r where r.id = new.restaurante_id and r.financeiro_ativo) then return null; end if;
  if public.fin_caixa_estrito(new.restaurante_id) then return null; end if;
  if exists (select 1 from public.fin_lancamentos l where l.restaurante_id = new.restaurante_id and l.pedido_id = new.id and l.tipo = 'recebimento') then return null; end if;

  v_forma := case new.forma_pagamento::text
    when 'dinheiro' then 'dinheiro' when 'pix' then 'pix'
    when 'cartao' then case when new.cartao_tipo = 'debito' then 'debito' else 'credito' end
    else null end;

  begin
    if new.comanda_id is null then
      -- Cardápio online (entrega ou retirada).
      if v_forma is null or coalesce(new.total, 0) <= 0 then return null; end if;
      perform public.caixa_turno_virar_dia(new.restaurante_id);
      select id into v_turno from public.caixa_turnos where restaurante_id = new.restaurante_id and fechado_em is null limit 1;
      if v_turno is null then v_turno := public.fin_turno_automatico(new.restaurante_id); end if;
      insert into public.fin_lancamentos (restaurante_id, grupo_id, linha, turno_id, carteira, tipo, valor_centavos, forma, origem,
        pedido_id, usuario_nome, chave_idempotencia, dados)
      values (new.restaurante_id, gen_random_uuid(), 1, v_turno, public.fin_carteira_da_forma(v_forma), 'recebimento',
        round(new.total * 100)::bigint, v_forma, 'delivery', new.id, 'Sistema (entregue)', 'entregue:' || new.id,
        jsonb_build_object('numero', new.numero, 'tipo', new.tipo, 'troco_para_centavos', round(coalesce(new.troco_para, 0) * 100)::bigint))
      on conflict do nothing;
    elsif new.canal = 'balcao' and new.tipo = 'entrega' and v_forma is not null then
      -- Delivery do PDV com "Receber na entrega": o que falta na conta, na forma escolhida no lançamento.
      select restante into v_restante from public.comanda_totais(new.comanda_id);
      if coalesce(v_restante, 0) > 0.004 and exists (select 1 from public.comandas k where k.id = new.comanda_id and k.status = 'aberta') then
        perform public.comanda_pagamento_registrar(new.restaurante_id, new.comanda_id, v_forma, v_restante, null,
          'entregue:' || new.id, null, 'Sistema (recebido na entrega)', 'Recebido na entrega', 'pdv');
      end if;
    end if;
  exception when others then
    raise warning 'fin_entregue_no_caixa pedido %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.fin_entregue_no_caixa() from public, anon, authenticated;

drop trigger if exists fin_entregue_no_caixa on public.pedidos;
create trigger fin_entregue_no_caixa after update of status on public.pedidos
  for each row when (new.status = 'entregue' and old.status is distinct from 'entregue')
  execute function public.fin_entregue_no_caixa();
