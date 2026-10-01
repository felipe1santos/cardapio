-- 0119 — Ficha de preparo do item (cozinha, 2026-09-30).
--
-- Ingredientes (nome + quantidade), passos (texto + foto opcional) e tempo estimado. Fica
-- em tabela PRÓPRIA e não em itens_cardapio: os itens são lidos pela vitrine pública, e a
-- receita da loja não pode sair para qualquer visitante. Quem edita: dono e gerente (pelo
-- Cardápio). Quem lê na cozinha: a tela da estação, pelo servidor (token da estação).
-- Rollback: docs/rollback/0119_fichas_preparo.down.sql
create table if not exists public.fichas_preparo (
  item_id uuid primary key references public.itens_cardapio (id) on delete cascade,
  restaurante_id uuid not null references public.restaurantes (id) on delete cascade,
  ingredientes jsonb not null default '[]'::jsonb check (jsonb_typeof(ingredientes) = 'array' and jsonb_array_length(ingredientes) <= 60),
  passos jsonb not null default '[]'::jsonb check (jsonb_typeof(passos) = 'array' and jsonb_array_length(passos) <= 40),
  tempo_min smallint check (tempo_min is null or tempo_min between 1 and 600),
  atualizado_em timestamptz not null default now()
);
create index if not exists fichas_preparo_restaurante_idx on public.fichas_preparo (restaurante_id);

alter table public.fichas_preparo enable row level security;
revoke all on public.fichas_preparo from anon;
grant select, insert, update, delete on public.fichas_preparo to authenticated;
drop policy if exists fichas_preparo_gestao on public.fichas_preparo;
create policy fichas_preparo_gestao on public.fichas_preparo
  for all to authenticated
  using (restaurante_id = public.auth_restaurante_id() and public.auth_papel() in ('dono', 'gerente'))
  with check (restaurante_id = public.auth_restaurante_id() and public.auth_papel() in ('dono', 'gerente'));

-- O item tem que ser da mesma loja da ficha.
create or replace function public.fichas_preparo_mesma_loja()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.itens_cardapio i where i.id = new.item_id and i.restaurante_id = new.restaurante_id) then
    raise exception 'item_de_outra_loja' using errcode = '42501';
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists fichas_preparo_mesma_loja on public.fichas_preparo;
create trigger fichas_preparo_mesma_loja before insert or update on public.fichas_preparo
  for each row execute function public.fichas_preparo_mesma_loja();
