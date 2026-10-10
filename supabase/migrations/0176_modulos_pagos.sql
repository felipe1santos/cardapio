-- 0176 — Módulos pagos com cadeado, liberados por loja no Super Admin (10/10/2026, ordem do dono).
--
-- Pagos (bloqueados por padrão): 'financeiro', 'agente_ia' (atendente com ChatGPT, ainda a construir), 'disparos'
-- (Campanhas de mensagem). Todo o resto é livre (robô simples do WhatsApp, gráfico de faturamento e lucro...).
--   · loja_modulos: uma linha por loja × módulo (liberado, quem, quando). Sem linha = bloqueado.
--   · modulo_liberado(loja, módulo): a ÚNICA checagem — servidor (service_role) e, pela sessão, auth_modulo_liberado().
-- Bloquear o Financeiro NÃO apaga dado nem desliga restaurantes.financeiro_ativo: o caixa automático continua
-- registrando as vendas por baixo (nível 1), só a tela e as APIs dele ficam fechadas.

create table if not exists public.loja_modulos (
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  modulo text not null check (modulo in ('financeiro', 'agente_ia', 'disparos')),
  liberado boolean not null default false,
  alterado_por text,
  alterado_em timestamptz not null default now(),
  primary key (restaurante_id, modulo)
);
alter table public.loja_modulos enable row level security;
revoke all on public.loja_modulos from anon, authenticated;

create or replace function public.modulo_liberado(p_restaurante uuid, p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select m.liberado from public.loja_modulos m where m.restaurante_id = p_restaurante and m.modulo = p_modulo), false)
$$;
revoke execute on function public.modulo_liberado(uuid, text) from public, anon, authenticated;

-- Pela sessão (middleware): só da própria loja.
create or replace function public.auth_modulo_liberado(p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.modulo_liberado(public.auth_restaurante_id(), p_modulo)
$$;
revoke execute on function public.auth_modulo_liberado(text) from public, anon;
grant execute on function public.auth_modulo_liberado(text) to authenticated;

-- Estado inicial: Financeiro e Disparos liberados só na Menuzia; Agente de IA em nenhuma (há dois "Guilherme").
insert into public.loja_modulos (restaurante_id, modulo, liberado, alterado_por)
select r.id, m.modulo, (r.slug = 'menuzia' and m.modulo in ('financeiro', 'disparos')), 'Migração 0176'
  from public.restaurantes r cross join (values ('financeiro'), ('agente_ia'), ('disparos')) m(modulo)
on conflict (restaurante_id, modulo) do nothing;
