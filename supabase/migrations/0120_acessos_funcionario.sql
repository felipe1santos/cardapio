-- 0120 — Acessos por funcionário (Fase 6, 2026-09-30).
--
-- usuarios.acessos (jsonb, opcional): {"areas": [...], "sensiveis": [...]}. Nulo = tudo
-- como antes (o papel decide). Preenchido = só as áreas/ações marcadas, por cima do papel
-- (ver lib/acessos.ts). Quem barra é o servidor (middleware e rotas) e, para preço, o
-- banco (gatilho abaixo — o Gestor de Cardápio grava direto pelo navegador).
--
-- Aditiva. Rollback: docs/rollback/0120_acessos_funcionario.down.sql
alter table public.usuarios add column if not exists acessos jsonb;
alter table public.usuarios drop constraint if exists usuarios_acessos_check;
alter table public.usuarios add constraint usuarios_acessos_check
  check (acessos is null or (jsonb_typeof(acessos) = 'object' and jsonb_typeof(acessos->'areas') = 'array'));
comment on column public.usuarios.acessos is 'Acessos do funcionário (0120). Nulo = padrão do papel.';
-- usuarios tem grant por coluna (0062): o painel e o middleware leem os próprios acessos.
grant select (acessos) on public.usuarios to authenticated;

-- Ninguém muda os próprios acessos (nem os de outro) pelo navegador: só o servidor
-- (rota da Equipe, que confere quem pode gerenciar) ou o dono.
create or replace function public.usuarios_acessos_so_servidor()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and new.acessos is distinct from old.acessos
     and coalesce(public.auth_papel(), '') <> 'dono' then
    raise exception 'acessos_so_servidor' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists usuarios_acessos_so_servidor on public.usuarios;
create trigger usuarios_acessos_so_servidor before update on public.usuarios
  for each row execute function public.usuarios_acessos_so_servidor();

-- Ação sensível liberada para quem está logado? Dono e acessos nulos: sim (vale o papel).
create or replace function public.auth_pode_sensivel(p_chave text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select u.papel = 'dono' or u.acessos is null or coalesce(u.acessos->'sensiveis', '[]'::jsonb) ? p_chave
      from public.usuarios u where u.id = auth.uid()
  ), true)
$$;
revoke all on function public.auth_pode_sensivel(text) from public, anon;
grant execute on function public.auth_pode_sensivel(text) to authenticated;

-- "Editar preços": o Gestor de Cardápio grava pelo navegador; o banco barra mudar preço
-- de quem não tem a permissão.
create or replace function public.itens_cardapio_preco_sensivel()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and (new.preco is distinct from old.preco or new.promocao_preco is distinct from old.promocao_preco)
     and not public.auth_pode_sensivel('editar_precos') then
    raise exception 'sem_permissao_editar_precos' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists itens_cardapio_preco_sensivel on public.itens_cardapio;
create trigger itens_cardapio_preco_sensivel before update on public.itens_cardapio
  for each row execute function public.itens_cardapio_preco_sensivel();
