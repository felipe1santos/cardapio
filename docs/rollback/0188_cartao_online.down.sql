-- Rollback da 0188 (cartão online). Linhas de cartão saem antes de voltar as restrições do Pix.
delete from public.pagamentos_online where metodo = 'cartao';
alter table public.pagamentos_online drop constraint if exists pagamentos_online_cartao_check;
alter table public.pagamentos_online drop constraint if exists pagamentos_online_metodo_check;
alter table public.pagamentos_online drop column if exists metodo, drop column if exists parcelas, drop column if exists cartao_bandeira,
  drop column if exists cartao_final, drop column if exists cartao_tipo, drop column if exists tentativas;
alter table public.pagamentos_online alter column mp_payment_id set not null;
update public.fin_lancamentos set forma = 'outro' where forma = 'cartao_online';
alter table public.fin_lancamentos drop constraint if exists fin_lancamentos_forma_check;
alter table public.fin_lancamentos add constraint fin_lancamentos_forma_check check (forma in
  ('dinheiro', 'pix', 'credito', 'debito', 'cartao', 'vale', 'fiado', 'transferencia', 'boleto', 'outro', 'pix_online'));
alter table public.pagamentos_contas drop constraint if exists pagamentos_contas_public_key_check;
alter table public.pagamentos_contas drop column if exists public_key;
alter table public.restaurantes drop constraint if exists restaurantes_cartao_online_parcelas_check;
alter table public.restaurantes drop column if exists cartao_online_ativo, drop column if exists cartao_online_parcelas_max;
