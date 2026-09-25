# Ordem do cardápio, favoritos e QR — publicação e rollback

Branch `feat/cardapio-ordem-qr` (a partir da main `bf8cbf8`). **Não publicada.** Depende da
migration **0101** (`supabase/migrations/0101_cardapio_ordem_itens.sql`).

## O que muda

| Área | Mudança |
|---|---|
| Banco (0101) | `itens_cardapio.posicao` (preenchida com a ordem de hoje: `criado_em`, `id`), gatilhos (item/categoria novos no fim; item que troca de categoria vai para o fim da nova), funções `cardapio_ordenar_itens` / `cardapio_ordenar_categorias` (lista completa e exata, transação, lock, auditoria; só `service_role`). |
| Servidor | `lib/ordem-cardapio.ts` — regra única de ordem para vitrine e QR; `PUT /api/admin/cardapio/ordem` (`cardapio.editar`). `listarItens` continua por criação: PDV e garçom não mudam. |
| Gestor | Arraste (mouse, toque, teclado) de itens e categorias; estrela de favorito clicável na lista. |
| Vitrine / QR | Montserrat compartilhada (`lib/fonte-vitrine.ts`) também no QR; preço do QR escuro e 600; selo “★ Favorito” na vitrine e nos dois QR. |
| QR (ficha) | Celular: foto em cima e conteúdo embaixo; ≥ 768 px e celular deitado: lado a lado. |

A ordem própria de categorias da mesa (Ajustes › Mesas, 0074) continua valendo onde já foi
configurada — hoje só a **Pizza do Rosa** tem (Bebidas primeiro no QR). Nas demais lojas o
QR segue exatamente a ordem do Gestor.

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

## Provas locais

- `node scripts/seguranca/e2e-cardapio-ordem-qr.mjs` — 106 verificações, loja isolada
  `ordem-qr-e2e` (semeada por `semear-cardapio-ordem.mjs`).
- `shots-cardapio-qr.mjs` — capturas antes/depois (`BASE` e `ROTULO`).
- Regressões: `e2e-garcom` 47/47 e `e2e-release-mesas` 254/254 em `cantina-e2e`.
