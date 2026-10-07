-- 0155 — Pix online liberado para todas as lojas (2026-10-07, noite 5).
-- A flag só libera o card "Mercado Pago" em Integrações. Para o cliente NADA muda até a loja
-- conectar a PRÓPRIA conta do Mercado Pago com chave Pix ativa (lib/pagamentos/pix-online.ts ›
-- pixOnlineDaLoja: flag + servidor configurado + conta conectada + sem a marca 'sem_chave_pix').
-- Lojas novas já nascem liberadas. Antes desta migration só a Menuzia estava ligada.
-- Rollback: docs/rollback/0155_pix_online_todas_as_lojas.down.sql
update public.restaurantes set pix_online_ativo = true where pix_online_ativo is distinct from true;
alter table public.restaurantes alter column pix_online_ativo set default true;
