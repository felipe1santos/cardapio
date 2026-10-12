-- 0185 — Troca de pagamento de pedido já criado, pelo WhatsApp (Agente de IA, 12/10/2026; teste real #290).
-- A 0148 só deixava "aguardando_pagamento → recebido" com o Pix PAGO e nada voltava para "aguardando_pagamento".
-- Duas exceções, só para o SERVIDOR (service_role):
--   · aguardando_pagamento → recebido sem pagar, quando a forma vira cartão/dinheiro (a cobrança já foi cancelada no MP);
--   · recebido → aguardando_pagamento quando a forma vira Pix online, só se o papel ainda não foi impresso.
-- O resto da função é idêntico à 0148. Rollback: docs/rollback/0185_pix_troca_pagamento_whatsapp.down.sql (= função da 0148).

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

  -- 0185: cartão/dinheiro → Pix online pelo WhatsApp (servidor), só antes de aceito e sem papel impresso.
  if new.status = 'aguardando_pagamento'
     and not (old.status = 'recebido' and v_servidor and new.pagamento_online and not coalesce(old.impresso, false)) then
    raise exception 'transicao_invalida:%>%', old.status, new.status using errcode = 'P0001';
  end if;
  if old.status = 'aguardando_pagamento' then
    if new.status = 'cancelado' then
      null;
    elsif new.status = 'recebido' and v_servidor and new.pago then
      null;
    -- 0185: Pix ainda não pago → cartão/dinheiro na entrega (servidor, cobrança já cancelada no MP).
    elsif new.status = 'recebido' and v_servidor and not new.pagamento_online and not new.pago and new.forma_pagamento <> 'pix' then
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
