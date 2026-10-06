-- 0151 — Tela de Impressão (2026-10-06): opção da loja "QR Code do cardápio" no rodapé da
-- comanda e da pré-conta do Assistente Beta.
--
-- Aditiva. LIGADA por padrão: o papel de hoje não muda para ninguém (o QR já sai). Desligada,
-- o servidor deixa de mandar o QR para o Beta (fila da cozinha, pré-conta e testes) — vale para
-- qualquer versão do Beta, sem atualizar. O Assistente antigo não imprime QR.
--
-- APLICAR ANTES do deploy do código que lê a coluna (lib/queries/impressao.ts).

alter table public.restaurantes add column if not exists impressao_qr boolean not null default true;

-- Mesmo acesso das outras opções da impressão (painel lê e o dono grava sob RLS).
grant select (impressao_qr) on public.restaurantes to authenticated;
grant update (impressao_qr) on public.restaurantes to authenticated;
