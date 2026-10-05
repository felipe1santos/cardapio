# Item 55 — Origem das visitas e dos pedidos (2026-10-05)

## Diagnóstico (produção, só leitura)

O painel mostrava só "Direto" porque:
- **A vitrine já gravava a origem crua de cada visita** (`vitrine_eventos.origem`): o `utm_source` ou o domínio de quem mandou. Em 30 dias, na Ponto 400: 529 Direto, 165 "ig", 34 "fb", 12 "m.facebook.com", 8 "l.instagram.com", 6 "l.facebook.com", 1 "an" e outros. Na Estância: "ig", "l.wl.co" (que é o WhatsApp) etc.
- **Esse texto cru nunca virava canal**: a tela mostrava "ig" como uma origem e "l.wl.co" como outra.
- **Nenhum link do Menuzia se marcava:**
  - o redirecionamento das Campanhas (`/c/<token>`) mandava para o cardápio sem parâmetro e ainda apagava o referrer de propósito (`Referrer-Policy: no-referrer`);
  - o robô do WhatsApp e o QR Code do cardápio também mandavam o link puro.
- Quando a sessão voltava depois de 30 min, a visita era gravada como "Direto" fixo.
- `utm_medium`, `utm_campaign`, `gclid` e `fbclid` não eram lidos para a origem. O `fbclid` era lido só pelo Pixel, o que continua igual.
- **Nada chegava ao pedido.**
- A página da mesa (QR da mesa) não é rastreada: o cliente da mesa não faz pedido sozinho, a seleção vai para o garçom, e o pedido nasce no canal **Mesa**. No card, ele aparece como "Salão" ou "PDV", que é o canal presencial.

## O que mudou

- **Captura** (`lib/origem-visita.ts`, usada pelo rastreador da vitrine): `utm_source`, `utm_medium`, `utm_campaign`, `gclid` (e `gbraid`/`wbraid`), `fbclid` e o domínio do referrer.
- **Canais:**

  | Canal | Exemplos |
  |---|---|
  | Direto | sem nada |
  | Instagram | `ig`, `instagram`, `l.instagram.com` |
  | Facebook | `fb`, `m.facebook.com`, `l.facebook.com` |
  | Meta (anúncio) | `an`, `meta`, `fbclid`, `adsmanager.facebook.com` |
  | Google Anúncio | `gclid`, google + `utm_medium=cpc` |
  | Google Busca | `google.com`, `google.com.br` |
  | WhatsApp | `whatsapp`, `wa.me`, `l.wl.co`, as Campanhas e o robô |
  | QR Code | `utm_source=qrcode` |
  | Outros | qualquer outro site |

- **Links do Menuzia marcados:**
  - Campanhas: `/c/<token>` passa a levar para `?utm_source=whatsapp&utm_medium=campanha&utm_campaign=<nome>`.
  - Robô: `?utm_source=whatsapp&utm_medium=robo`.
  - QR Code do cardápio (Ajustes › QR Code): `?utm_source=qrcode&utm_medium=qr`. **Os QR já impressos continuam sem a marca.** Para contar como QR Code, é preciso imprimir de novo.
  - O QR impresso na **comanda** não mudou, porque o recibo é intocado.
- **Pedido:** colunas novas `pedidos.origem_canal` e `origem_detalhe` (fonte, meio, campanha, clique), na migration **0149**.
  - O navegador manda a origem crua.
  - O **servidor recalcula o canal**: o navegador não escolhe o canal, e texto sujo é limpo.
  - PDV, balcão e mesa ficam com a origem nula, e o card mostra o canal presencial.
- **Pixel / API de Conversões:** nada mudou. O `fbclid` continua indo para o `_fbc`, e a suíte do Pixel passou (48/48).

## Regra de atribuição

**A origem do pedido é a ÚLTIMA origem não-direta do aparelho nos últimos 7 dias. Sem nenhuma nesse prazo, é Direto.**
- Ela fica guardada no navegador, por loja (`localStorage` `mz-origem-<loja>`).
- Uma visita direta **não apaga** a origem anterior. Quem veio do Instagram ontem e hoje digitou o endereço conta como Instagram.
- Duas origens diferentes: vale a **última**.
- **A visita** conta a origem **dela própria**. É a origem daquela abertura, e não a atribuída.

## Dashboard

- **"Origem das visitas"** virou área própria, **acima de "Análises do período"**. Ela saiu da aba Cliques.
- Rosca no estilo do kit (`components/graficos/rosca.tsx`):
  - paleta da Meta e legenda com quadradinho;
  - a fatia **salta** no hover e mostra uma dica com origem, visitas, pedidos, conversão e %;
  - no celular, a dica abre com um toque e fica até tocar fora, aparecendo embaixo da rosca para não sair da tela;
  - no teclado, a seta mostra a dica e o Esc fecha.
- Ao lado (embaixo no celular) fica a tabela por origem, com ícone, visitas, pedidos, conversão e faturamento. Ela alterna entre **Visitas / Pedidos / Faturamento** e usa o mesmo período do Dashboard.
- Tem um estado vazio amigável.
- Pedidos do cardápio feitos **antes de 05/10** não têm origem: ficam fora da tabela, e a tela avisa quantos são.

## Testes
- Unitários:
  - `lib/origem-visita.test.ts`: 26, cobrindo cada origem, a atribuição e a limpeza;
  - `lib/dashboard-origem.test.ts`: 4;
  - `lib/pedido-origem-card.test.ts`: 4.
- `scripts/seguranca/e2e-origem-55.mjs`: **35/35**.
  - Cada origem (11 casos) cai no canal certo **na visita e no pedido**.
  - Atribuição: volta direta, 7 dias e "vale a última".
  - Antifraude: o canal mandado pelo navegador é ignorado.
  - Checkout de verdade pela vitrine (Instagram) e link da campanha marcado.
  - Dashboard: a área fica acima das análises, a tabela bate com o banco, a rosca bate com a tabela, e hover, teclado, toque no celular e alternância funcionam.
- Prints: `origem-desktop.png` e `origem-celular.png`.
