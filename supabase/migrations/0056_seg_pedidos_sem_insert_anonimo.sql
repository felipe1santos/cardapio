-- SEGURANÇA (checkpoint S2) — ninguém insere pedido direto no banco.
--
-- O problema: `pedidos` e `pedido_itens` tinham policy de INSERT para
-- {anon, authenticated} com WITH CHECK (true) — sem nenhuma restrição. Com a anon
-- key dava para inserir pedido em qualquer loja, com qualquer total, `pago=true`,
-- `origem='pdv'` e `comanda_id` arbitrário, sem passar por `criarPedido`: sem
-- recálculo de preço, sem checagem de loja aberta, sem validação de item. O
-- pedido forjado aparece no Kanban em tempo real e sai na impressora térmica.
--
-- As policies são resquício da época em que a vitrine inseria o pedido direto do
-- navegador. Hoje `criarPedido` (lib/queries/pedidos.ts) é o ÚNICO ponto que
-- insere nas duas tabelas, chamado por /api/loja/[slug]/pedido e
-- /api/admin/pdv/pedido, ambos com service_role — que ignora RLS. Ou seja: as
-- policies estão mortas e derrubá-las não muda nenhum fluxo legítimo.

drop policy if exists "Anyone can create pedidos" on public.pedidos;
drop policy if exists "Anyone can create pedido_itens" on public.pedido_itens;

-- Defesa em profundidade: a vitrine lê pedido pela rota /api/loja/[slug]/pedido/[id]
-- (service_role), nunca pelo PostgREST com a chave anônima. anon não precisa de
-- nada nessas duas tabelas.
revoke all on public.pedidos from anon;
revoke all on public.pedido_itens from anon;

-- O painel (authenticated) LÊ e ATUALIZA status/impressão — isso continua.
-- Criar e apagar pedido é exclusividade do servidor.
revoke insert, delete, truncate on public.pedidos from authenticated;
revoke insert, delete, truncate, update on public.pedido_itens from authenticated;
