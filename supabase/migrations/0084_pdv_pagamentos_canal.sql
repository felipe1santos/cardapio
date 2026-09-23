-- ============================================================================
-- 0084 — PDV v2: pagamento sabe de onde veio
--
-- Cada pagamento presencial passa a registrar o canal (mesa | balcao, snapshot do
-- tipo da comanda) e a origem (pdv | salao, a tela que registrou). Com forma,
-- valor, recebido, troco, operador, data, comanda, estorno e chave de idempotência
-- que já existiam, é o que o futuro módulo Receitas precisa — sem criar caixa,
-- sangria ou livro agora.
--
-- Backfill aditivo e exato: antes desta migration só a mesa existia e só o salão
-- gravava pagamento. Nenhum valor é tocado.
-- ============================================================================

alter table public.pagamentos_comanda add column if not exists canal text;
alter table public.pagamentos_comanda add column if not exists origem text;

update public.pagamentos_comanda set canal = 'mesa' where canal is null;
update public.pagamentos_comanda set origem = 'salao' where origem is null;

alter table public.pagamentos_comanda alter column canal set default 'mesa';
alter table public.pagamentos_comanda alter column canal set not null;
alter table public.pagamentos_comanda alter column origem set default 'salao';
alter table public.pagamentos_comanda alter column origem set not null;

alter table public.pagamentos_comanda drop constraint if exists pagamentos_canal_check;
alter table public.pagamentos_comanda add constraint pagamentos_canal_check check (canal in ('mesa', 'balcao'));
alter table public.pagamentos_comanda drop constraint if exists pagamentos_origem_check;
alter table public.pagamentos_comanda add constraint pagamentos_origem_check check (origem in ('pdv', 'salao'));
