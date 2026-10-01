-- 0130 — Cadastro de produto repaginado (2026-10-01).
--
-- 1. itens_cardapio.imagens_extras: fotos extras do produto (até 4), [{url, thumb}].
-- 2. Agenda da promoção: promocao_dias (dias da semana, 0=dom), promocao_hora_inicio/fim.
--    Junto com promocao_inicio/fim (que já existiam e ninguém preenchia — 0 linhas em
--    produção em 2026-10-01), decidem quando o preço promocional vale (lib/promocao-agenda.ts).
--    Tudo nulo = promoção sempre valendo, como hoje.
-- 3. itens_cardapio_gestao: preço de custo e códigos (PDV e interno). Tabela própria porque
--    itens_cardapio é lida por qualquer visitante (vitrine) — custo não pode vazar.
--
-- Aditiva. Rollback: docs/rollback/0130_produto_repaginado.down.sql

alter table public.itens_cardapio add column if not exists imagens_extras jsonb not null default '[]'::jsonb;
alter table public.itens_cardapio drop constraint if exists itens_cardapio_imagens_extras_check;
alter table public.itens_cardapio add constraint itens_cardapio_imagens_extras_check
  check (jsonb_typeof(imagens_extras) = 'array' and jsonb_array_length(imagens_extras) <= 4);

alter table public.itens_cardapio add column if not exists promocao_dias smallint[];
alter table public.itens_cardapio add column if not exists promocao_hora_inicio time;
alter table public.itens_cardapio add column if not exists promocao_hora_fim time;
alter table public.itens_cardapio drop constraint if exists itens_cardapio_promocao_dias_check;
alter table public.itens_cardapio add constraint itens_cardapio_promocao_dias_check
  check (promocao_dias is null or (promocao_dias <@ array[0,1,2,3,4,5,6]::smallint[] and cardinality(promocao_dias) between 1 and 7));
alter table public.itens_cardapio drop constraint if exists itens_cardapio_promocao_horas_check;
alter table public.itens_cardapio add constraint itens_cardapio_promocao_horas_check
  check ((promocao_hora_inicio is null) = (promocao_hora_fim is null) and (promocao_hora_inicio is null or promocao_hora_inicio <> promocao_hora_fim));
alter table public.itens_cardapio drop constraint if exists itens_cardapio_promocao_datas_check;
alter table public.itens_cardapio add constraint itens_cardapio_promocao_datas_check
  check (promocao_inicio is null or promocao_fim is null or promocao_inicio <= promocao_fim);

create table if not exists public.itens_cardapio_gestao (
  item_id uuid primary key references public.itens_cardapio(id) on delete cascade,
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  preco_custo numeric(10, 2) check (preco_custo is null or preco_custo >= 0),
  codigo_pdv text check (codigo_pdv is null or length(codigo_pdv) <= 40),
  codigo_interno text check (codigo_interno is null or length(codigo_interno) <= 40),
  atualizado_em timestamptz not null default now()
);
create index if not exists itens_cardapio_gestao_loja on public.itens_cardapio_gestao (restaurante_id);
alter table public.itens_cardapio_gestao enable row level security;
-- Mesma regra de quem edita o cardápio (dono/gerente da loja). Visitante não lê.
drop policy if exists "Gestores leem e gravam custo e códigos" on public.itens_cardapio_gestao;
create policy "Gestores leem e gravam custo e códigos" on public.itens_cardapio_gestao
  for all to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor())
  with check (
    restaurante_id = public.auth_restaurante_id() and public.auth_e_gestor()
    and exists (select 1 from public.itens_cardapio i where i.id = item_id and i.restaurante_id = public.auth_restaurante_id())
  );
revoke all on public.itens_cardapio_gestao from anon;
grant select, insert, update, delete on public.itens_cardapio_gestao to authenticated;

-- "Editar preços" (0120) passa a cobrir também a agenda da promoção: mudar quando o preço
-- promocional vale é mexer no preço.
create or replace function public.itens_cardapio_preco_sensivel()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and (new.preco is distinct from old.preco or new.promocao_preco is distinct from old.promocao_preco
          or new.promocao_inicio is distinct from old.promocao_inicio or new.promocao_fim is distinct from old.promocao_fim
          or new.promocao_dias is distinct from old.promocao_dias
          or new.promocao_hora_inicio is distinct from old.promocao_hora_inicio or new.promocao_hora_fim is distinct from old.promocao_hora_fim)
     and not public.auth_pode_sensivel('editar_precos') then
    raise exception 'sem_permissao_editar_precos' using errcode = '42501';
  end if;
  return new;
end $$;
