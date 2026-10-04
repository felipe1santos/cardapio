# Pendência 8 — Vitrine: ajustes visuais e "Mais Pedidos" manual (2026-10-04)

Vale para a vitrine de **todas** as lojas. Sem migration.

## 1. Fim do cardápio sem lacuna

**Causa:** três coisas somadas embaixo do último item.
- o bloco `<footer>` "Você chegou ao fim do cardápio / Bom apetite! / Cardápio digital feito por Menuzia"
  (`mt-6 py-7`, ~110 px);
- o contêiner da vitrine com `pb-[136px]` **fixo** — escolhido para a sacola + o menu, mas maior que o
  menu sozinho (≈ 106 px com a faixa do WhatsApp);
- no desktop, `lg:pb-20` fixo.
Medido no "antes": **173 px** entre o último item e a faixa do WhatsApp (390 px).

**Correção (na origem, sem remendo por loja):** o bloco saiu. Sacola, WhatsApp e menu viraram **um
bloco fixo só** (`rodape-fixo`), e a altura dele é **medida** (ResizeObserver) e vira o espaço abaixo do
cardápio (`pb-[var(--rodape-vitrine)]`). Já inclui a área segura do celular (o `padding-bottom` com
`env(safe-area-inset-bottom)` do menu no iPhone e no app instalado), então nunca sobra nem falta.
Desktop: 64 px só quando há o botão do WhatsApp (senão 21 px). "Depois": folga de 0–5 px.

## 2. Menu de baixo sempre visível

Saiu o "esconder ao rolar" (`useEsconderAoRolar`, de 2026-10-01): o menu fica fixo e visível em
qualquer rolagem. O hook e o teste dele foram removidos.

## 3. Botão do WhatsApp sempre visível

- Celular: a faixa "Tirar dúvidas no WhatsApp" fica no topo do menu em **todas as abas** e **também com a
  sacola** (antes sumia com a sacola e fora da Home). Ordem de baixo para cima: botões do menu → WhatsApp
  → "Ver sacola" — nada se cobre, e o último item termina acima do bloco.
- Desktop: botão flutuante embaixo, no centro, também com a sacola.
- Some só no checkout, na ficha do produto e na **loja sem WhatsApp** (telefone vazio) — aí não aparece.
- Bug corrigido de passagem: `numeroWaLojaDe` usava `/D/g` em vez de `/\D/g`; telefone gravado com
  máscara, como "(27) 99999-0001", gerava link wa.me com parênteses e traço.

## 4. "Mais Pedidos" escolhido pela loja

**Como era:** já era **manual** (coluna `mais_vendido`, a estrela ★ da lista do Cardápio; ou a `tag`
antiga `mais_pedido`/`favorito` de quem não salvou o item desde a 0117), mas com **três nomes**:
"Mais vendido" (pílula vermelha na linha do nome, na vitrine), "★ Favorito" (QR da mesa) e a seção
"Mais Pedidos". O cadastro do produto dizia "Mais vendido — automático".

**Agora — um conceito, um nome: "Mais Pedidos"** (`ROTULO_MAIS_PEDIDOS`, regra única `ehMaisPedidos`):
- Cadastro do produto: opção **"Mostrar como Mais Pedidos"** com **prévia do cartão** (texto + foto de
  120 px com o selo). É a mesma estrela da lista do Cardápio (dica e rótulo trocados para "Mais Pedidos").
- Selo sobre a foto: **canto superior esquerdo, colado no topo**, vermelho `#E80002` com texto branco
  (4,7:1), canto acompanhando o da foto. O desconto fica no preço, fora da foto — os dois nunca se cobrem.
  Vale na lista e na grade; nos cartões da própria seção "Mais Pedidos" não há selo (o título já diz).
- Seção "Mais Pedidos": só os itens marcados (até 12, como antes); sem item marcado, a seção não aparece.
- QR da mesa: o selo "★ Favorito" virou "Mais Pedidos" (mesmas cores); a tag antiga não vira etiqueta à parte.
- A pílula "Mais vendido" saiu da linha do nome (as tags de topo agora são Combo especial > Oferta
  limitada > Novidade, no máximo 2).

### Transição — lojas que já mostram a seção/selo (produção, só leitura, 2026-10-04)

Nenhuma loja muda de **quais** itens aparecem (já era manual). Muda o **visual**: a pílula "Mais vendido"
na linha do nome vira o selo "Mais Pedidos" sobre a foto. Nada foi marcado em loja nenhuma.

| Loja | Itens marcados | Marcados à venda (aparecem) |
|---|---|---|
| Villalanches Gourmet (`villa-lanches`) | 5 | 5 |
| PONTO 400 HAMBURGUERIA (`ponto-400-hamburgueria`) | 4 | 4 |
| Angus Burguer (`menuzia`, teste) | 3 | 3 |
| Estância Burger (`estancia-burger`) | 2 | 1 |
| Nossa Cozinha - IFS (`nossa-cozinha`) | 2 | 0 (itens fora de venda: seção não aparece) |
| DB Doces (`db-doces`) | 1 | 1 |
| W Lanches Reviver (`w-lanches-reviver`) | 1 | 1 |
| Mama Pizza, Pizza do Rosa e demais | 0 | 0 (sem seção, sem selo — como hoje) |

## 5. Selo de desconto cortado no card de destaque

**Causa:** no cartão de destaque (carrossel "Mais Pedidos", 120 px), preço e pílula do desconto ficavam
numa linha que **não quebrava** (`inline-flex` sem wrap). "R$ 24,90" + "-17%" ≈ 126 px > 120 px, e o
cartão tinha `overflow-hidden` — a pílula era cortada na borda (medido: pílula até 146 px, cartão até 136).

**Correção:** a linha do preço quebra (`flex-wrap`): sem espaço, a pílula desce para baixo do preço; e o
cartão não corta mais (`overflow-hidden` só na foto). Conferido em todos os tamanhos e tipos de cartão
(destaque, grade e lista).

## Testes

| Suíte | Resultado |
|---|---|
| **e2e-vitrine-p8** (novo: 4 lojas locais × 360/390/430/tablet/desktop, área segura simulada, sacola) | **142/142** (antes: 43/138) |
| e2e-vitrine-tags (ajustada: selo na foto, menu sempre visível) | 27/27 |
| e2e-tela-cheia-navegadores (6 navegadores; menu sempre visível) | 30/30 |
| e2e-vitrine-fase3 (WhatsApp com a sacola, tags de topo) | 51/51 |
| e2e-retoque-visual | 46/46 |
| e2e-admin-etiquetas (opção + prévia + gravação + vitrine) | 17/17 |
| e2e-cardapio-ordem-qr | 111/111 |
| e2e-vitrine-celular-sem-codigo | 11/11 |
| e2e-checkout-larguras | 72/72 |
| e2e-pedido-idempotente | 12/12 |
| e2e-kanban-card (pedido entrando no Kanban) | 72/72 |
| e2e-pixel-conversao (Pixel / API de Conversões) | 48/48 |
| verificar-vitrine-nome-zoom | ok |
| vitest (lib + components) | 1725/1725 |
| tsc, eslint, build | ok |

Ressalvas:
- `e2e-produto-repaginado`: 63/64 — a falha é de **data**: o teste cria o item disponível só de segunda a
  sexta (`{1,2,3,4,5}`) e hoje é domingo ("não está disponível hoje"). Nada a ver com a P8.
- iPhone real / app instalado (PWA): o Playwright desta máquina não tem WebKit e o Chromium não emula
  `env(safe-area-inset-bottom)` nem `display-mode: standalone`. Coberto por simulação (menu com 34 px de
  área segura: o rodapé cresce 28 px e a folga continua 4–5 px) e pela conferência em produção.
- Um teste antigo achava o botão "Pedidos" do menu por nome parcial e passou a pegar o cartão com o selo
  "Mais Pedidos"; corrigido para nome exato (para o cliente nada muda).

## Prints

`antes-*` (código de antes) e `depois-*` (com a P8), mesmos cenários: `*-fim` (fim do cardápio em 360,
390 e desktop), `*-mais-pedidos-*`, `*-desconto-p8-grade-*`, `*-sacola-390`, `depois-area-segura-*`,
`admin-previa-mais-pedidos.png`. Produção: `producao-*` (Menuzia).

## Publicação e conferência em produção (2026-10-04)

- Main **cb33332**, deploy Coolify `krccfr8dys3qsna3l8pfcvl7` — finished 15h46. Sem migration.
- **Menuzia (Angus Burguer):** a vitrine abre sem itens às 15h46 — e isso NÃO é da P8: a única categoria
  com itens é "Gourmet" (ativa só das 11h40 às 14h); os outros 17 itens estão **sem categoria** (nunca
  aparecem) e Bebidas/Sobremesa/TESTE Tags estão vazias. Conferido: rodapé fixo, WhatsApp e menu no ar,
  sem o bloco do fim (`producao-menuzia-*`). Nada foi alterado na loja.
- **Lojas reais, só olhando** (navegador sem clicar em item, sem sacola, com os eventos da vitrine, o Pixel
  e a Meta bloqueados no próprio teste para não contar visita): Ponto 400 e Villa Lanches, celular e desktop —
  seção "Mais Pedidos" com 4 e 5 itens, selo colado no canto da foto (0/0 px), nenhuma pílula "Mais vendido",
  nenhum desconto cortado, WhatsApp visível, menu visível ao rolar, folga no fim de 4–5 px (celular) e 12 px
  (desktop) (`producao-ponto-400-*`, `producao-villa-lanches-*`). Demais vitrines respondendo 200 (HTTP).
