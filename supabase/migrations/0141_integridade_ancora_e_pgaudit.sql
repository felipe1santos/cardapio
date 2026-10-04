-- 0141 — Integridade do financeiro: âncora externa diária + pgaudit (decisão do dono, 2026-10-04).
--
-- Contexto (Fase 4): o papel `postgres` é dono das tabelas e passa pela imutabilidade (manutenção). Com ele
-- dá para alterar um lançamento e RECALCULAR a cadeia de hashes inteira — a verificação interna não acusaria.
--
-- 1. Âncora: `fin_ancora_integridade()` devolve, por loja, o último (seq, hash) do livro-caixa e da auditoria.
--    Um cron diário (/api/cron/ancora-integridade) grava isso num ARQUIVO no servidor do app (fora do banco e
--    fora do alcance da senha do postgres). A verificação de integridade compara as âncoras com o banco: cadeia
--    reescrita depois de uma âncora é acusada.
-- 2. pgaudit (já pré-carregado na Supabase): registra no log do Postgres (painel da Supabase → Logs) toda
--    escrita/remoção nas tabelas imutáveis feita pelo `postgres` ou pela API, e todo DDL/mudança de papel do
--    `postgres` (ex.: ALTER TABLE … DISABLE TRIGGER). Configuração por PAPEL (o `postgres` não pode mudar a do banco).
-- Rollback: docs/rollback/0141_integridade_ancora_e_pgaudit.down.sql

-- ── 1. âncora ────────────────────────────────────────────────────────────────────────────────
create or replace function public.fin_ancora_integridade()
returns table (restaurante_id uuid, ledger_seq bigint, ledger_hash text, auditoria_seq bigint, auditoria_hash text)
language sql
stable
security definer
set search_path = public
as $$
  with l as (
    select distinct on (restaurante_id) restaurante_id, seq, hash from public.fin_lancamentos order by restaurante_id, seq desc
  ), a as (
    select distinct on (restaurante_id) restaurante_id, seq, hash from public.eventos_auditoria order by restaurante_id, seq desc
  )
  select coalesce(l.restaurante_id, a.restaurante_id), l.seq, l.hash, a.seq, a.hash
    from l full join a on a.restaurante_id = l.restaurante_id
$$;
revoke execute on function public.fin_ancora_integridade() from public, anon, authenticated;
grant execute on function public.fin_ancora_integridade() to service_role;

-- ── 2. pgaudit ───────────────────────────────────────────────────────────────────────────────
create extension if not exists pgaudit;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'menuzia_auditoria') then
    create role menuzia_auditoria nologin;
  end if;
end $$;
-- Auditoria por OBJETO: qualquer UPDATE/DELETE/TRUNCATE nestas tabelas (que nunca acontece no uso normal)
-- vira linha "AUDIT: OBJECT" no log — inclusive tentativas recusadas pela trava.
grant update, delete, truncate on public.fin_lancamentos, public.eventos_auditoria, public.fin_entregas_pagamento to menuzia_auditoria;
alter role postgres set pgaudit.role = 'menuzia_auditoria';
alter role authenticator set pgaudit.role = 'menuzia_auditoria';
-- Auditoria por SESSÃO do postgres: DDL (desligar gatilho, trocar função) e papéis (inclusive desligar este log).
alter role postgres set pgaudit.log = 'ddl, role';
