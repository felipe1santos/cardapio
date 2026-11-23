-- 0250 — Encomendas (bolo, pudim, torta) — 23/11/2026.
--
-- Item marcado "por encomenda" no cadastro: o cliente só escolhe data a partir de agora + prazo do item, e a
-- encomenda nunca vai na mesma sacola de itens de pronta entrega (a vitrine bloqueia e o servidor recusa).
-- O pedido de encomenda é um pedido agendado comum (0121: agendado_para = quando o cliente retira/recebe) com
-- encomenda = true e liberar_em = quando entra no Kanban/cozinha/impressão (horário − maior "entra na cozinha"
-- entre os itens). liberar_em só ADIANTA a entrada: vale o que vier primeiro entre ele e a regra da loja.
--
-- Impressão: só a LÓGICA DE DISPARO muda (encomenda entra na fila quando liberada); o recibo não.
-- Lembrete da véspera (WhatsApp da loja): encomenda_lembrete_em é reservado com UPDATE … WHERE … IS NULL antes de
-- enviar — 1 lembrete por pedido, mesmo com duas rodadas do cron juntas.
-- Aditiva, sem conversão de dado existente (todo item/pedido atual fica encomenda = false).
-- Rollback: docs/rollback/0250_encomendas.down.sql

-- ── Itens ────────────────────────────────────────────────────────────────────
-- itens_cardapio tem grant de tabela (0003): as colunas já valem para a vitrine (select) e o painel.
alter table public.itens_cardapio
  add column if not exists encomenda boolean not null default false,
  add column if not exists encomenda_prazo_horas smallint not null default 24,
  add column if not exists encomenda_cozinha_horas smallint not null default 24,
  add column if not exists encomenda_pagamento_antecipado boolean not null default false;
alter table public.itens_cardapio drop constraint if exists itens_cardapio_encomenda_check;
alter table public.itens_cardapio add constraint itens_cardapio_encomenda_check check (
  encomenda_prazo_horas between 1 and 720
  and encomenda_cozinha_horas between 0 and 720
);
comment on column public.itens_cardapio.encomenda is 'Item por encomenda (0250): pedido separado, com data a partir de agora + encomenda_prazo_horas.';
comment on column public.itens_cardapio.encomenda_prazo_horas is 'Encomenda (0250): antecedência mínima entre o pedido e a retirada/entrega.';
comment on column public.itens_cardapio.encomenda_cozinha_horas is 'Encomenda (0250): horas antes do horário em que o pedido entra no Kanban/cozinha/impressão.';
comment on column public.itens_cardapio.encomenda_pagamento_antecipado is 'Encomenda (0250): só aceita pagamento online (Pix/cartão pelo Mercado Pago).';

-- ── Pedidos ──────────────────────────────────────────────────────────────────
-- pedidos: select de tabela para o painel (RLS por loja, 0061); UPDATE só por coluna e estas ficam de fora
-- (quem grava é o servidor).
alter table public.pedidos
  add column if not exists encomenda boolean not null default false,
  add column if not exists liberar_em timestamptz,
  add column if not exists encomenda_lembrete_em timestamptz;
comment on column public.pedidos.encomenda is 'Pedido de encomenda (0250). Card roxo no Kanban.';
comment on column public.pedidos.liberar_em is 'Encomenda (0250): entra no fluxo a partir daqui (antes da regra agendamento_libera_min da loja).';
comment on column public.pedidos.encomenda_lembrete_em is 'Encomenda (0250): lembrete da véspera reservado/enviado (1 por pedido).';
create index if not exists pedidos_encomenda_lembrete_idx on public.pedidos (agendado_para)
  where encomenda and encomenda_lembrete_em is null;

-- Liberado para o fluxo: sem agendamento, OU liberar_em já passou, OU a regra da loja (0121).
create or replace function public.pedido_liberado(p_agendado timestamptz, p_restaurante uuid, p_liberar_em timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_liberar_em is not null and p_liberar_em <= now()) or public.pedido_liberado(p_agendado, p_restaurante)
$$;
revoke all on function public.pedido_liberado(timestamptz, uuid, timestamptz) from public, anon;
grant execute on function public.pedido_liberado(timestamptz, uuid, timestamptz) to authenticated, service_role;

-- Fila de impressão: mesmas funções da 0121, só trocando a checagem de liberação.
create or replace function public.impressao_elegiveis(p_restaurante uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.pedidos p
    left join public.impressao_reservas r on r.pedido_id = p.id
   where p.restaurante_id = p_restaurante
     and p.status <> 'cancelado'
     and exists (select 1 from public.pedido_itens i where i.pedido_id = p.id)
     -- 0121/0250: agendado/encomenda só entra na fila quando é liberado (a reimpressão pedida sempre sai).
     and (public.pedido_liberado(p.agendado_para, p.restaurante_id, p.liberar_em) or p.reimprimir = true)
     and (
           (p.impresso = false and p.status = 'recebido')
        or (p.impresso = false and p.status in ('preparando', 'pronto') and p.criado_em >= now() - interval '6 hours')
        or p.reimprimir = true
     )
     and (r.pedido_id is null or r.reservado_ate < now())
   order by p.criado_em
   limit 50
$$;

create or replace function public.impressao_reservar(p_restaurante uuid, p_instancia text, p_segundos int)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ate timestamptz := now() + make_interval(secs => greatest(coalesce(p_segundos, 90), 15));
  v_instancia text := nullif(btrim(coalesce(p_instancia, '')), '');
begin
  -- Uma varredura por loja de cada vez: a segunda espera a primeira gravar a reserva.
  perform pg_advisory_xact_lock(hashtextextended('impressao.fila:' || p_restaurante::text, 0));

  delete from public.impressao_reservas where restaurante_id = p_restaurante and reservado_ate < now() - interval '1 day';

  return query
  with alvo as (
    select p.id
      from public.pedidos p
      left join public.impressao_reservas r on r.pedido_id = p.id
     where p.restaurante_id = p_restaurante
       and p.status <> 'cancelado'
       and exists (select 1 from public.pedido_itens i where i.pedido_id = p.id)
       -- 0121/0250: agendado/encomenda só entra na fila quando é liberado (a reimpressão pedida sempre sai).
       and (public.pedido_liberado(p.agendado_para, p.restaurante_id, p.liberar_em) or p.reimprimir = true)
       and (
             (p.impresso = false and p.status = 'recebido')
          or (p.impresso = false and p.status in ('preparando', 'pronto') and p.criado_em >= now() - interval '6 hours')
          or p.reimprimir = true
       )
       and (r.pedido_id is null or r.reservado_ate < now()
            or (v_instancia is not null and r.reservado_por = v_instancia))
     order by p.criado_em
     limit 50
  ),
  gravado as (
    insert into public.impressao_reservas (pedido_id, restaurante_id, reservado_ate, reservado_por)
    select id, p_restaurante, v_ate, v_instancia from alvo
    on conflict (pedido_id) do update set reservado_ate = excluded.reservado_ate, reservado_por = excluded.reservado_por
    returning pedido_id
  )
  select pedido_id from gravado;
end $$;

-- Quem executa (B7): as mesmas permissões da 0086/0087 — só o servidor (rota do Assistente de Impressão).
revoke all on function public.impressao_elegiveis(uuid) from public, anon, authenticated;
grant execute on function public.impressao_elegiveis(uuid) to service_role;
revoke all on function public.impressao_reservar(uuid, text, int) from public, anon, authenticated;
grant execute on function public.impressao_reservar(uuid, text, int) to service_role;
