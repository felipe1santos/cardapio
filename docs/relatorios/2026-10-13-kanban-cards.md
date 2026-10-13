# Kanban: cards novos (13/10/2026) — só visual, só na Menuzia ("Novidades em teste")

Publicado em main (f80dbbc, 4db48cc, 0ea54f6). Aparece **só nas lojas com "Novidades em teste"** (hoje, a Menuzia); as
outras seguem com o card antigo, sem nenhuma mudança. Nenhuma função mudou. Não mexi em impressão/Assistente nem na Villa.
**Não liberado para as outras lojas**: espera a aprovação do Felipe.

Prints: `docs/kanban/cards-novos.png` (quadro), `painel-novo.png` (painel do pedido aberto), `cards-novos-hover.png`
(setinha), `cards-novos-celular.png` (390 px) e `cards-novos-tablet.png` (820 px).

## O que mudou

| Parte | Como ficou |
|---|---|
| Card | DM Sans (guardada no projeto, sem download no build), cinza `#F3F4F6`, borda `#D1D5DB`, cantos retos, sombra dupla, 14 px entre cards. |
| Linha 1 | `#nº` escuro · NOME EM MAIÚSCULAS · NOVO · 🛵 entrega / 🛍️ retirada / 🍽️ mesa / 🏪 balcão (+ ✍️ quando a IA do WhatsApp anotou) · ⏱ tempo (`0:12`; depois de 1 h, "2 horas"). |
| Linha 2 | Itens um embaixo do outro ("**2x** nome", até 3 e "+N itens") · valor em verde-escuro com a forma de pagamento embaixo · logo da origem na ponta direita (sem fundo). |
| Pagamento | Dinheiro (com "troco p/"), Dinheiro pago, Pix, Pix pago, Cartão na entrega/retirada, Cartão pago, Na conta (mesa). **Pago online** (Pix ou cartão pelo Mercado Pago): ícone do Mercado Pago + "Pago". |
| Pedido novo | Verde `#C9EFD7` **piscando** (até ser aceito), borda verde, etiqueta NOVO; volta ao cinza ao aceitar. Logo e etiqueta de pagamento ficam **sem fundo branco**. |
| Atraso | A mesma regra de hoje (10/20 min). Só o tempo muda de cor (vermelho `#C42B1C` no atraso), o fundo continua cinza. |
| Setinha | Aparece ao passar o mouse, no canto direito de dentro do card (no celular/tablet fica sempre visível). Faz o MESMO que o botão de etapa de antes: Aceitar, Pronto, Entregue, Saiu p/ entrega, e Despachar abre o **mesmo** menu de despacho. Clicar em qualquer outro lugar do card abre o pedido. |
| Painel do pedido | O mesmo painel à direita, no visual do card: `#nº` + NOME, ícones, tempo, logo da origem grande, blocos cinza de cantos retos, etiqueta de pagamento. Todas as funções iguais (alterar pagamento, reimprimir, cancelar, concluir sem entregador). Agora o "Cancelar pedido" fica acima do botão flutuante "Despachar" (antes ficava escondido atrás dele). |
| Coluna estreita | Com o painel aberto, as colunas encolhem: valor, pagamento e logo descem para baixo dos itens e a etiqueta quebra a linha (nada sai do card). |

## Logos da origem (`public/origens/`, detalhes em `LEIA-ME.md`)

| Origem | Arquivo | De onde |
|---|---|---|
| WhatsApp e WhatsApp (IA) | `whatsapp.svg` | Simple Icons (CC0), glifo oficial na cor da marca. O ícone de app (com anel branco) foi trocado: ficava com "fundo branco" no card verde. |
| Instagram, Facebook, Anúncio Meta, Google (perfil), Anúncio Google | `instagram.svg`, `facebook.svg`, `meta.svg`, `google.svg`, `google-ads.svg` | gilbarbara/logos (CC0), a mesma coleção das Integrações. |
| iFood | `ifood.svg` | Wikimedia Commons (logo vermelho). Pronto para quando houver pedidos do iFood: hoje o banco não aceita esse canal (falta incluir na lista de origens). |
| Pago online | `mercado-pago.svg` | O mesmo das Integrações (Simple Icons). |
| Cardápio / Notificação do app | `menuzia.png` | Ícone do Menuzia (na notificação, com um sininho roxo). |
| PDV / Salão / QR Code / Outros | ícones neutros | — |
| **99Food** | **faltou** | Não há arquivo oficial público para baixar. O card mostra o nome num quadro neutro: me mande o arquivo. |

## Testes

- Regras do card em `lib/kanban-card.ts`, com 11 testes: ícones, pagamento, logo, itens e a ação da setinha (as mesmas condições dos botões antigos).
- Ponta a ponta na Menuzia (`.medidas/e2e-kanban-cards.mjs`, Chrome do Playwright): **24/24 ok**. Cobriu entrega, retirada, balcão (PDV); origens WhatsApp IA, WhatsApp, Instagram, Facebook, Anúncio Meta, Anúncio Google, Google e Notificação do app; Mercado Pago "Pago", Pix pago, troco, atrasado e "+2 itens". Também conferiu:
  - pedido novo verde piscando → setinha Aceitar → cinza;
  - setinha Pronto;
  - Entregue (só a ação, sem entregar de verdade);
  - Despachar abrindo o mesmo menu (fechado sem confirmar);
  - clique no card abrindo o painel sem mudar o status;
  - tempo real (pedido novo aparece sozinho);
  - nenhum erro de JavaScript;
  - celular 390 px e tablet 820 px sem rolagem lateral.
- **Mesa:** a Menuzia exige comanda para pedido de mesa (trava no banco). Não abri comanda falsa; 🍽️ e "Na conta" estão cobertos pelo teste das regras.
- **Pedidos de teste:** todos fechados como "Não entregue" (#314–#366, várias rodadas). Durante o teste, a impressão e o aceite automáticos da Menuzia ficaram desligados e foram religados no fim (conferido).
- **Interferência no teste:** havia outra tela da Menuzia aberta com aceite automático. Ela aceitava os pedidos de teste em ~10 s e causou 2 rodadas com falso erro. A versão final testa o pedido novo logo que ele chega. Essa outra tela também gerou, uma vez, o aviso antigo "Não foi possível atualizar o pedido" (as duas telas aceitaram o mesmo pedido ao mesmo tempo, comportamento que já existia).

## Observações

- Regra dos 600 de peso: o modelo pede negrito. A exceção vale só para `components/pedidos/card-pedido-kanban.tsx` (anotada em `lib/peso-fonte.test.ts`); o resto do painel segue a regra.
- Para liberar para todas as lojas: trocar a condição `useEstadoSessao()?.novidades === true` em `app/admin/pedidos/page.tsx` (variável `cardsNovos`).

## Ajuste: altura fixa (pedido do dono, 13/10 madrugada — 934c65c, f6ab890)

- Todo card tem **100 px de altura**, igual em todas as colunas, com o painel aberto ou fechado.
- Itens: com **1 ou 2 itens** mostra todos; com **3 ou mais**, o 1º item e "+N itens" (ex.: 5 itens → "2x Item 4" e "+4 itens"). O resto só aparece abrindo o pedido (painel grande à direita).
- Nada quebra linha: o nome encurta com "…" e a etiqueta de pagamento também (texto inteiro ao passar o mouse).
- **Card estreito** (painel aberto): o card mede a própria largura e, quando fica estreito, o logo diminui e a etiqueta NOVO some (o verde piscando já mostra que é novo). Assim o nome e o tempo cabem.
- E2E de novo na Menuzia: **27/27 ok**. Inclui as checagens novas: mesma altura com o painel fechado e aberto; "+4 itens"; logo, tempo e nome dentro do card em coluna estreita. Pedidos de teste #367–#386 fechados como "Não entregue".
