-- 0146 — Alarme de pedido novo em todo o painel (2026-10-04)
--
-- 1) Contagem (só contagem) de quantas vezes o som de pedido novo ficou BLOQUEADO pelo navegador,
--    por loja e por dia (fuso de São Paulo). Cada vez = um pedido que precisava tocar e o navegador
--    não deixou (o painel manda no máximo 1 por aba a cada 5 min).
-- 2) Assinaturas de push do PAINEL (celular/tablet com a tela apagada ou o Chrome em segundo plano):
--    uma por aparelho de cada usuário. Só o servidor lê e grava (sem policy).
--
-- Nada muda em tabela existente.

create table if not exists public.alarme_som_bloqueios (
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  dia date not null,
  contagem integer not null default 0 check (contagem >= 0),
  ultimo_em timestamptz not null default now(),
  primary key (restaurante_id, dia)
);
alter table public.alarme_som_bloqueios enable row level security;
revoke all on public.alarme_som_bloqueios from anon, authenticated;

create or replace function public.alarme_som_bloqueio_registrar(p_restaurante uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.alarme_som_bloqueios as b (restaurante_id, dia, contagem, ultimo_em)
  values (p_restaurante, (now() at time zone 'America/Sao_Paulo')::date, 1, now())
  on conflict (restaurante_id, dia) do update set contagem = b.contagem + 1, ultimo_em = now()
  returning contagem;
$$;
revoke all on function public.alarme_som_bloqueio_registrar(uuid) from public, anon, authenticated;
grant execute on function public.alarme_som_bloqueio_registrar(uuid) to service_role;

create table if not exists public.push_painel_assinaturas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  usuario_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  navegador text not null default '',
  falhas integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  ultimo_envio_em timestamptz
);
create index if not exists push_painel_assinaturas_loja on public.push_painel_assinaturas (restaurante_id);
alter table public.push_painel_assinaturas enable row level security;
revoke all on public.push_painel_assinaturas from anon, authenticated;
