-- 0114 — Turno de caixa e fechamento do entregador por turno.
--
-- O fechamento de caixa do entregador somava TODO o histórico (nunca zerava depois de
-- registrar) e contava a nota do cliente como troco levado. Agora o período é o TURNO DE
-- CAIXA: da abertura até o fechamento, mesmo passando da meia-noite. Cada entrega em
-- dinheiro e cada pagamento pertence ao turno que estava aberto quando aconteceu
-- (calculado pelos horários: pedidos.entregue_em, pagamentos_comanda.criado_em — nada é
-- regravado nos pedidos). Regras: lib/caixa-turno.ts.
--
--   caixa_turnos                    um turno aberto por loja por vez (índice parcial).
--   fechamentos_caixa + turno_id, registrado_por_nome, pedidos
--
-- Aditiva: fechamentos antigos ficam com turno_id nulo. Escrita só pelo servidor
-- (/api/admin/caixa, papel com logistica.operar); o navegador só lê.
-- Rollback: docs/rollback/0114_caixa_turnos.down.sql

create table if not exists public.caixa_turnos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  aberto_em timestamptz not null default now(),
  aberto_por uuid,
  aberto_por_nome text,
  fechado_em timestamptz,
  fechado_por uuid,
  fechado_por_nome text,
  observacao text,
  check (fechado_em is null or fechado_em >= aberto_em)
);

create unique index if not exists caixa_turnos_um_aberto_uidx on public.caixa_turnos (restaurante_id) where fechado_em is null;
create index if not exists caixa_turnos_loja_abertura_idx on public.caixa_turnos (restaurante_id, aberto_em desc);

alter table public.caixa_turnos enable row level security;
revoke all on public.caixa_turnos from anon, authenticated;
grant select on public.caixa_turnos to authenticated;
drop policy if exists caixa_turnos_select on public.caixa_turnos;
create policy caixa_turnos_select on public.caixa_turnos
  for select to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_papel() in ('dono', 'gerente', 'logistica'));

alter table public.fechamentos_caixa
  add column if not exists turno_id uuid references public.caixa_turnos (id) on delete set null,
  add column if not exists registrado_por_nome text,
  add column if not exists pedidos integer not null default 0;

create index if not exists fechamentos_caixa_turno_idx on public.fechamentos_caixa (turno_id, entregador_id);

-- Entregas em dinheiro por horário de entrega (leitura do turno).
create index if not exists pedidos_loja_entregue_em_idx on public.pedidos (restaurante_id, entregue_em) where entregue_em is not null;
