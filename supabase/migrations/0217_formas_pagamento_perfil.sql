-- 0217 — Formas de pagamento aceitas por canal, no Perfil (21/10/2026). Fonte única para vitrine, robô e Agente de IA.
--   · restaurantes.formas_pagamento jsonb {entrega: [...], retirada: [...], vale_bandeiras: [...]}; NULL = como sempre
--     foi (nenhuma loja muda nada até salvar). Opções: pix_online, pix, cartao_online, credito, debito, dinheiro, vale.
--     A Mesa continua em formas_pagamento_mesa (0067) — o Perfil edita a mesma coluna, sem duplicar.
--   · forma_pagamento ganha 'vale' (vale-refeição/alimentação) e pedidos.vale_bandeira guarda a bandeira (Alelo…).
--   · fin_entregue_no_caixa (0171): pedido em vale entra no livro como 'vale' (antes só pix/cartão/dinheiro).
-- Aditiva. Rollback: drop das colunas e a 0171 de volta (o valor do enum fica; não é usado sem a coluna).
alter type public.forma_pagamento add value if not exists 'vale';
alter table public.pedidos add column if not exists vale_bandeira text;
alter table public.pedidos drop constraint if exists pedidos_vale_bandeira_check;
alter table public.pedidos add constraint pedidos_vale_bandeira_check check (vale_bandeira is null or char_length(vale_bandeira) <= 40);
alter table public.restaurantes add column if not exists formas_pagamento jsonb;
grant select (formas_pagamento) on public.restaurantes to anon, authenticated;
grant update (formas_pagamento) on public.restaurantes to authenticated;

CREATE OR REPLACE FUNCTION public.fin_entregue_no_caixa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    when 'vale' then 'vale'
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
end $function$
;
