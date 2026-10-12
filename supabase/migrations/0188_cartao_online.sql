-- 0188 — Cartão de crédito/débito ONLINE na vitrine pelo Mercado Pago (Card Payment Brick; 12/10/2026).
--  Os dados do cartão NUNCA passam pelo nosso servidor: o navegador gera um token no Mercado Pago e o servidor cria o
--  pagamento com o token da loja. Guardamos só bandeira, últimos 4 dígitos, tipo (crédito/débito) e parcelas.
--  (1) restaurantes.cartao_online_ativo (desligado em todas por padrão) e cartao_online_parcelas_max (1 = só à vista).
--  (2) pagamentos_contas.public_key: chave PÚBLICA da conta MP da loja (o Brick precisa dela no navegador).
--  (3) pagamentos_online: metodo (pix|cartao), dados não sensíveis do cartão, tentativas; mp_payment_id pode ficar vazio
--      até o cliente tentar o primeiro cartão (o pedido já espera o pagamento com prazo).
--  (4) livro-caixa aceita a forma 'cartao_online'.
-- Rollback: docs/rollback/0188_cartao_online.down.sql.
alter table public.restaurantes
  add column if not exists cartao_online_ativo boolean not null default false,
  add column if not exists cartao_online_parcelas_max smallint not null default 1;
alter table public.restaurantes drop constraint if exists restaurantes_cartao_online_parcelas_check;
alter table public.restaurantes add constraint restaurantes_cartao_online_parcelas_check check (cartao_online_parcelas_max between 1 and 12);

alter table public.pagamentos_contas add column if not exists public_key text;
alter table public.pagamentos_contas drop constraint if exists pagamentos_contas_public_key_check;
alter table public.pagamentos_contas add constraint pagamentos_contas_public_key_check check (public_key is null or length(public_key) <= 200);

alter table public.pagamentos_online alter column mp_payment_id drop not null;
alter table public.pagamentos_online
  add column if not exists metodo text not null default 'pix',
  add column if not exists parcelas smallint,
  add column if not exists cartao_bandeira text,
  add column if not exists cartao_final text,
  add column if not exists cartao_tipo text,
  add column if not exists tentativas integer not null default 0;
alter table public.pagamentos_online drop constraint if exists pagamentos_online_metodo_check;
alter table public.pagamentos_online add constraint pagamentos_online_metodo_check check (metodo in ('pix', 'cartao'));
alter table public.pagamentos_online drop constraint if exists pagamentos_online_cartao_check;
alter table public.pagamentos_online add constraint pagamentos_online_cartao_check check (
  (cartao_final is null or cartao_final ~ '^[0-9]{4}$') and (cartao_bandeira is null or length(cartao_bandeira) <= 40)
  and (cartao_tipo is null or cartao_tipo in ('credito', 'debito')) and (parcelas is null or parcelas between 1 and 24));

alter table public.fin_lancamentos drop constraint if exists fin_lancamentos_forma_check;
alter table public.fin_lancamentos add constraint fin_lancamentos_forma_check check (forma in
  ('dinheiro', 'pix', 'credito', 'debito', 'cartao', 'vale', 'fiado', 'transferencia', 'boleto', 'outro', 'pix_online', 'cartao_online'));
