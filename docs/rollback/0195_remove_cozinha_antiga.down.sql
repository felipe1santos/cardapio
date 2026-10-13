-- Desfaz a 0195: recria public.estacoes como na 0029 (+ RLS por papel da 0066) e devolve as estações guardadas em
-- backup.estacoes_0195, DESATIVADAS e com tokens NOVOS (os antigos não existem mais). O código da Cozinha antiga também
-- precisa voltar (git revert do commit que a removeu).
create table public.estacoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  nome text not null,
  modo text not null check (modo in ('producao','expedicao','completa')),
  token uuid not null unique default gen_random_uuid(),
  ativo boolean not null default true,
  ultimo_visto_em timestamptz,
  criado_em timestamptz not null default now()
);
alter table public.estacoes enable row level security;
create policy "Tenant manages own stations" on public.estacoes for all
  using ((restaurante_id = auth_restaurante_id()) and (auth_papel() = any (array['dono'::text, 'gerente'::text])))
  with check ((restaurante_id = auth_restaurante_id()) and (auth_papel() = any (array['dono'::text, 'gerente'::text])));
insert into public.estacoes (id, restaurante_id, nome, modo, ativo, ultimo_visto_em, criado_em)
  select id, restaurante_id, nome, modo, false, ultimo_visto_em, criado_em from backup.estacoes_0195;
