-- 0111 — A instância do WhatsApp (Evolution) é escolhida só pelo servidor.
--
-- Antes: a 0080 dava UPDATE em todas as colunas de `restaurantes` (menos o token de
-- impressão) para `authenticated`, e a policy de UPDATE aceita dono, gerente e atendente.
-- Como o nome da instância era `menuzia-<id da loja>` e o id é público, qualquer um desses
-- papéis, de QUALQUER loja, gravava `evolution_instance = 'menuzia-<id de outra loja>'`
-- pelo PostgREST e passava a ver o número, desconectar e mandar mensagens pelo WhatsApp
-- da outra loja.
--
-- Agora:
--   1. `authenticated`/`anon` perdem o UPDATE da coluna (só o servidor, com service_role,
--      grava — em /api/admin/whatsapp/conectar).
--   2. Gatilho de defesa: mesmo que um GRANT futuro devolva a coluna, mudança vinda de
--      sessão de usuário é recusada.
--   3. Uma instância pertence a uma loja só (índice único parcial).
--
-- Nada muda para as lojas: nenhuma instância é renomeada nem desconectada. Instâncias
-- NOVAS passam a ter nome aleatório (código: lib/evolution.ts), sem relação com o id.
--
-- Rollback: docs/rollback/0111_whatsapp_instancia_so_servidor.down.sql

revoke update (evolution_instance) on public.restaurantes from authenticated;
revoke update (evolution_instance) on public.restaurantes from anon;

create or replace function public.restaurantes_protege_instancia()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.evolution_instance is distinct from old.evolution_instance
     and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'instancia_so_servidor' using errcode = '42501',
      hint = 'A instância do WhatsApp é definida pelo servidor.';
  end if;
  return new;
end $$;

drop trigger if exists restaurantes_protege_instancia on public.restaurantes;
create trigger restaurantes_protege_instancia
  before update of evolution_instance on public.restaurantes
  for each row execute function public.restaurantes_protege_instancia();

create unique index if not exists restaurantes_evolution_instance_uidx
  on public.restaurantes (evolution_instance) where evolution_instance is not null;
