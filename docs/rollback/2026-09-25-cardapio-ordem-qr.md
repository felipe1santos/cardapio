# Ordem do cardápio, favoritos e QR — publicação e rollback

Branch `feat/cardapio-ordem-qr` (a partir da main `bf8cbf8`). **Não publicada.** Depende da
migration **0101** (`supabase/migrations/0101_cardapio_ordem_itens.sql`).

## O que muda

| Área | Mudança |
|---|---|
| Banco (0101) | `itens_cardapio.posicao` (preenchida com a ordem de hoje: `criado_em`, `id`), gatilhos (item/categoria novos no fim; item que troca de categoria vai para o fim da nova), funções `cardapio_ordenar_itens` / `cardapio_ordenar_categorias` (lista completa e exata, transação, lock, auditoria; só `service_role`). |
| Servidor | `lib/ordem-cardapio.ts` — regra única de ordem para vitrine, QR, PDV e garçom; `PUT /api/admin/cardapio/ordem` (`cardapio.editar`). |
| Gestor | Arraste (mouse, toque, teclado) de itens e categorias; estrela de favorito clicável na lista. |
| Vitrine / QR | Montserrat compartilhada (`lib/fonte-vitrine.ts`) também no QR; preço do QR escuro e 600; selo “★ Favorito” na vitrine e nos dois QR. |
| QR (ficha) | Celular: foto em cima e conteúdo embaixo; ≥ 768 px e celular deitado: lado a lado. |

**Ordem única (decisão do dono, 2026-09-25):** o Gestor manda em todos os canais — vitrine, QR
ativo, QR de visualização, PDV e garçom — inclusive na Pizza do Rosa. A antiga ordem própria da
mesa (`grupos_cardapio.posicao_mesa`, 0074) não é mais lida nem gravada; o dado continua no banco.
Ajustes › Mesas mostra só o aviso “A ordem das categorias e dos itens é definida em Cardápio”.

## Ordem de publicação

1. **Preflight (só leitura):** `node scripts/seguranca/aplicar-0101-producao.mjs`
   (esperado: última = 0100, 0101 ausente, 0 empates de `criado_em`).
2. **Migration primeiro:** `node scripts/seguranca/aplicar-0101-producao.mjs --aplicar --confirmar-producao`.
   É aditiva: o código atual (`bf8cbf8`) ignora a coluna e continua funcionando; itens
   criados por ele recebem posição pelo gatilho.
3. **Depois o código:** merge `feat/cardapio-ordem-qr` → main, push, Redeploy no Coolify.
   ⚠ Nunca o inverso: o código novo lê `posicao` no select do cardápio.
4. **Conferência em produção (Menuzia):** Gestor › arrastar um item e voltar; vitrine e QR
   na mesma ordem; favorito aparece e some; nenhuma outra loja muda de ordem.

## Rollback

- **Só o código:** Redeploy da main anterior (`bf8cbf8`). A 0101 pode ficar — o código
  antigo não a usa.
- **Código e banco:** primeiro o código (acima), depois
  `docs/rollback/0101_cardapio_ordem_itens.down.sql`. Perde-se só a ordem manual de itens
  gravada depois da 0101; nenhum outro dado muda. Testado localmente: desfazer, reaplicar
  duas vezes (idempotente) e o e2e passa de novo.

## Flags (PDV v2 e Assistente Beta em todas as lojas)

`scripts/seguranca/flags-pdv-beta-todas.mjs`: `retrato` (só leitura, grava o JSON), `aplicar`
(liga `pdv_v2` e `impressao_beta_liberado` numa transação, só se toda loja estiver em
“Somente teste”, sem cozinha por função, sem transferência, sem função atribuída e sem
computador Beta ativo; audita cada loja) e `reverter` (volta exatamente ao retrato).
O modo do Beta não muda; nada é pareado ou atribuído.

## Provas locais

- `node scripts/seguranca/e2e-cardapio-ordem-qr.mjs` — 111 verificações, loja isolada
  `ordem-qr-e2e` (semeada por `semear-cardapio-ordem.mjs`).
- `shots-cardapio-qr.mjs` — capturas antes/depois (`BASE` e `ROTULO`).
- Regressões (loja isolada `cantina-e2e`, com trava `exigirLojaIsolada`): garçom 47/47, mesas 254/254,
  PDV v2 69/69, PDV atendimento 96/96 (inclui pedido pela vitrine), balcão/entrega 84/84.
  `cantina-demo` e `vizinha-demo` conferidas idênticas antes/depois.

## Publicado em 2026-09-25

- 0101 aplicada em produção às 20:48:04Z (todas as conferências do aplicador ✔; 0 empates,
  0 itens sem posição, 0 posições duplicadas, ordem por posição = ordem de antes).
- main `19c13da` (merge), push sem force; Redeploy no Coolify 20:51:39–20:56:07Z (Success);
  bundle novo servido às 20:56:57Z.
- Flags às ~21:00Z (`flags-pdv-beta-todas.mjs aplicar`): as 8 lojas com `pdv_v2 = true` e
  Assistente Beta liberado em “Somente teste”; nenhuma outra coluna mudou. Menuzia já estava
  assim. Retrato: `docs/rollback/2026-09-25-flags-retrato.json`.

## Rollback exato

1. Flags (volta as 7 lojas a `pdv_v2 = false` e Beta não liberado; Menuzia fica como estava):
   `node scripts/seguranca/flags-pdv-beta-todas.mjs reverter docs/rollback/2026-09-25-flags-retrato.json --confirmar-producao`
2. Código: `git revert -m 1 19c13da` + push e Redeploy (ou Redeploy de `bf8cbf8` no Coolify).
3. Banco (só depois do código): `docs/rollback/0101_cardapio_ordem_itens.down.sql`.
