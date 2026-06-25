-- ============================================================================
-- Robustez do token do Assistente de Impressão.
--   #6: a versão antiga recebia uuid; um token malformado quebrava no cast
--       (HTTP 500). Agora recebe text e valida o formato antes do cast,
--       devolvendo "sem restaurante" (→ 401 na rota) em vez de erro 500.
--   #8: garante unicidade do token entre lojas.
-- ============================================================================

drop function if exists restaurante_id_por_agente_token(uuid);

create or replace function restaurante_id_por_agente_token(token text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from restaurantes
  where token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and impressao_agente_token = token::uuid;
$$;

grant execute on function restaurante_id_por_agente_token(text) to anon, authenticated;

create unique index if not exists restaurantes_agente_token_uniq
  on restaurantes (impressao_agente_token)
  where impressao_agente_token is not null;
