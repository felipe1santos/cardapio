-- ============================================================================
-- Suporte ao Assistente de Impressão: o agente desktop (anon, sem login)
-- consulta pedidos novos via endpoints autenticados por token de pareamento
-- (não por RLS/sessão), então marca como impresso pra não imprimir 2x.
-- ============================================================================

alter table pedidos
  add column impresso boolean not null default false;
