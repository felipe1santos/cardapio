-- ============================================================================
-- 0083 — PDV v2: estados separados do pedido presencial e transições seguras
--
-- Quatro dimensões, cada uma no seu lugar:
--   · cozinha      → pedidos.status (enum de sempre, inalterado)
--   · atendimento  → pedidos.atendimento_status (NOVO; NULL no delivery)
--   · financeiro   → derivado da comanda (comanda_totais), nunca por pedido
--   · comanda      → comandas.status
--
-- E três travas que valem para TODO caminho que grava status — Kanban no
-- navegador, cozinha por token, entregador, Nexta, rotas de servidor:
--   1. pedido cancelado ou entregue não volta a andar (aba velha do Kanban não
--      ressuscita pedido). Exceção única: presencial entregue → cancelado, que é
--      o cancelamento de item/lançamento já servido feito pela gestão com motivo;
--   2. mesa e balcão nunca vão para "em rota";
--   3. cancelou → `reimprimir = false` (nenhum caminho imprime cancelado).
--
-- E duas garantias de concorrência:
--   · número do pedido sob trava por loja (antes: max()+1 sem trava) + índice único;
--   · lançamento em comanda espera o fechamento terminar e é recusado se ela fechou.
--
-- Compatibilidade: pedidos antigos ficam com atendimento_status NULL e são lidos
-- por regra (entregue ⇒ atendimento realizado; demais ⇒ pendência pelo status).
-- Nenhum backfill, nenhum dado convertido.
--
-- Rollback: docs/rollback/0083_pdv_pedidos_estados.down.sql.
-- ============================================================================

-- 1. número do pedido -----------------------------------------------------------
create or replace function public.set_pedido_numero()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null or new.numero = 0 then
    -- Trava transacional por loja: dois pedidos simultâneos (balcão + mesa +
    -- vitrine) não leem o mesmo max(). Solta sozinha no fim da transação.
    perform pg_advisory_xact_lock(hashtextextended('pedidos.numero:' || new.restaurante_id::text, 0));
    select coalesce(max(numero), 0) + 1 into new.numero
      from public.pedidos where restaurante_id = new.restaurante_id;
  end if;
  return new;
end;
$$;

-- Índice único só se não houver duplicado (verificado em produção em 2026-09-23:
-- 0 duplicados em 620 pedidos). Se houver, a migration NÃO falha: avisa e segue —
-- corrigir duplicado é decisão de dados, fora desta migration.
do $$
begin
  if exists (select 1 from public.pedidos group by restaurante_id, numero having count(*) > 1) then
    raise warning 'pedidos.numero tem duplicados; índice único pedidos_numero_unq NÃO criado';
  else
    create unique index if not exists pedidos_numero_unq on public.pedidos (restaurante_id, numero);
  end if;
end $$;

-- 2. dimensão de atendimento ------------------------------------------------------
alter table public.pedidos add column if not exists atendimento_status text;
alter table public.pedidos add column if not exists atendido_em timestamptz;
alter table public.pedidos add column if not exists atendido_por uuid references public.usuarios(id) on delete set null;
alter table public.pedidos add column if not exists atendido_por_nome text;
alter table public.pedidos add column if not exists concluido_em timestamptz;
alter table public.pedidos add column if not exists resolvido_forcado boolean not null default false;

alter table public.pedidos drop constraint if exists pedidos_atendimento_status_check;
alter table public.pedidos add constraint pedidos_atendimento_status_check
  check (atendimento_status is null or atendimento_status in
    ('aguardando_servico', 'servido', 'aguardando_retirada', 'entregue_balcao', 'nao_entregue', 'concluido'));

-- Valor inicial: mesa aguarda serviço; balcão COM comanda aguarda retirada. Balcão
-- antigo (sem comanda) fica NULL — é o fluxo legado, que o Kanban já conclui.
create or replace function public.pedido_atendimento_inicial()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.atendimento_status is null and new.comanda_id is not null then
    if new.canal = 'mesa' then
      new.atendimento_status := case when new.status = 'entregue' then 'servido' else 'aguardando_servico' end;
    elsif new.canal = 'balcao' then
      new.atendimento_status := case when new.status = 'entregue' then 'entregue_balcao' else 'aguardando_retirada' end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists pedido_atendimento_inicial on public.pedidos;
create trigger pedido_atendimento_inicial
  before insert on public.pedidos
  for each row execute function public.pedido_atendimento_inicial();

-- 3. lançamento só em comanda aberta, da mesma loja ------------------------------
-- FOR UPDATE: um lançamento que chega enquanto a conta fecha espera o fechamento
-- terminar e, se ela fechou, é recusado — o pedido não cai numa conta encerrada.
create or replace function public.pedidos_exige_comanda_aberta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_loja uuid;
begin
  if new.comanda_id is null then return new; end if;
  select status, restaurante_id into v_status, v_loja
    from public.comandas where id = new.comanda_id for update;
  if v_loja is null or v_loja <> new.restaurante_id then
    raise exception 'comanda_inexistente' using errcode = 'P0001';
  end if;
  if v_status <> 'aberta' then
    raise exception 'comanda_nao_aberta' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists pedidos_exige_comanda_aberta on public.pedidos;
create trigger pedidos_exige_comanda_aberta
  before insert on public.pedidos
  for each row execute function public.pedidos_exige_comanda_aberta();

-- 4. transições de status ---------------------------------------------------------
create or replace function public.pedidos_transicao_valida()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_presencial boolean := new.canal in ('mesa', 'balcao');
begin
  if new.status is not distinct from old.status then return new; end if;

  if old.status = 'cancelado'
     or (old.status = 'entregue' and not (v_presencial and new.status = 'cancelado')) then
    raise exception 'transicao_invalida:%>%', old.status, new.status using errcode = 'P0001';
  end if;
  if v_presencial and new.status = 'em_rota' then
    raise exception 'transicao_invalida:%>%', old.status, new.status using errcode = 'P0001';
  end if;

  if new.status = 'cancelado' then
    new.reimprimir := false;
  end if;

  -- "Entregue" dado pelo Kanban (ou pela expedição) num pedido presencial pronto É o
  -- atendimento: o card sai da coluna como sempre e o atendimento fica registrado.
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

drop trigger if exists pedidos_transicao_valida on public.pedidos;
create trigger pedidos_transicao_valida
  before update of status on public.pedidos
  for each row execute function public.pedidos_transicao_valida();

-- 5. reserva de impressão ---------------------------------------------------------
-- Tabela própria, e não colunas em `pedidos`: reservar não pode disparar Realtime,
-- `atualizado_em` nem as triggers de pedido a cada varredura do Assistente.
create table if not exists public.impressao_reservas (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  reservado_ate timestamptz not null,
  reservado_por text
);
alter table public.impressao_reservas enable row level security;
-- Sem policy: só service_role (rota do agente) lê e escreve.
revoke all on public.impressao_reservas from anon, authenticated;
create index if not exists idx_impressao_reservas_loja on public.impressao_reservas (restaurante_id);
