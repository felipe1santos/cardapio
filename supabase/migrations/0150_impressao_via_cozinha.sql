-- 0150 — Impressão v3 (2026-10-05): opção da loja "Via da cozinha" (Assistente Beta).
--
-- Aditiva. Desligada por padrão: nenhuma loja passa a imprimir uma via a mais. Ligada, o
-- Assistente Beta (modelo v3) imprime, depois da comanda, a via da cozinha (sem valores e sem
-- pagamento, itens e observações maiores) na mesma impressora. O Assistente antigo ignora.
--
-- APLICAR ANTES do deploy do código que lê a coluna (lib/queries/impressao.ts).

alter table public.restaurantes add column if not exists impressao_via_cozinha boolean not null default false;

-- Mesmo acesso das outras opções da impressão (painel lê e o dono grava sob RLS).
grant select (impressao_via_cozinha) on public.restaurantes to authenticated;
grant update (impressao_via_cozinha) on public.restaurantes to authenticated;
