-- Funções de sessão que TODA policy do sistema passa a usar.
--
-- Três coisas nascem aqui:
--
-- 1. `auth_papel()` — o papel do usuário logado, para as policies decidirem por
--    allowlist de papéis (nunca por negação).
-- 2. `auth_loja_valida()` — a loja tem pelo menos um dono válido? Regra de EXISTÊNCIA,
--    sem `.single()`, então zero donos, vários donos ou donos divergentes têm resposta
--    determinística.
-- 3. `auth_restaurante_id()` reescrita — passa a devolver NULL para usuário desativado,
--    não autorizado ou de loja vencida. Como toda policy deriva dela, desativar um
--    funcionário corta o acesso dele a TUDO na requisição seguinte: PostgREST, mutation
--    e Realtime, mesmo com o JWT já emitido no bolso.
--
-- Recursão: as três são SECURITY DEFINER, então o SELECT interno em `usuarios` roda como
-- dono da função e NÃO reavalia as policies de `usuarios`. É o mesmo mecanismo que a
-- auth_restaurante_id() já usava desde a 0001.
--
-- Preservação de comportamento: linhas existentes têm desativado_em nulo e autorizado
-- true, e toda loja de produção tem dono válido — ninguém perde acesso na aplicação.

create or replace function public.auth_papel()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.papel::text
    from public.usuarios u
   where u.id = auth.uid()
     and u.desativado_em is null
     and u.autorizado
$$;

create or replace function public.auth_e_gestor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.auth_papel() in ('dono', 'gerente'), false)
$$;

create or replace function public.auth_loja_valida(p_restaurante uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.usuarios d
     where d.restaurante_id = p_restaurante
       and d.papel = 'dono'
       and d.autorizado
       and d.desativado_em is null
       and (d.acesso_expira_em is null or d.acesso_expira_em > now())
  )
$$;

create or replace function public.auth_restaurante_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.restaurante_id
    from public.usuarios u
   where u.id = auth.uid()
     and u.desativado_em is null
     and u.autorizado
     and public.auth_loja_valida(u.restaurante_id)
$$;

-- Nenhuma delas é RPC pública: `anon` não executa, e nem PUBLIC.
revoke execute on function public.auth_papel() from public;
revoke execute on function public.auth_e_gestor() from public;
revoke execute on function public.auth_loja_valida(uuid) from public;
revoke execute on function public.auth_restaurante_id() from public;

grant execute on function public.auth_papel() to authenticated;
grant execute on function public.auth_e_gestor() to authenticated;
grant execute on function public.auth_loja_valida(uuid) to authenticated;
grant execute on function public.auth_restaurante_id() to authenticated;
