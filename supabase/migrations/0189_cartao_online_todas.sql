-- 0189 — Cartão online (Mercado Pago) liberado para todas as lojas (decisão do Felipe, 12/10/2026).
-- Na vitrine só aparece onde a conta do Mercado Pago está conectada (lib/pagamentos/cartao-online.ts › cartaoOnlineDaLoja);
-- loja sem conta: nada muda. Parcelas seguem à vista (cartao_online_parcelas_max = 1) até a loja mudar.
alter table public.restaurantes alter column cartao_online_ativo set default true;
update public.restaurantes set cartao_online_ativo = true where cartao_online_ativo is distinct from true;
