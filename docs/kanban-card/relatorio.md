# Kanban — card do pedido mais limpo (2026-10-03)

Só o visual do card nas colunas do Painel de Pedidos mudou. Ficaram como estavam:
- a lógica dos pedidos e o topo do painel;
- a tela **"Despacho de rotas"**: nenhum arquivo dela foi alterado, e o teste confere isso pelo git;
- a Cozinha e os Detalhes, que usam os componentes compartilhados no formato de sempre.

## O que mudou no card

| # | Pedido | Feito |
|---|---|---|
| 1 | Espaçamento | Espaço em cima do número 14 → 8 px; embaixo dos botões 14 → 10 px; cabeçalho mais junto. |
| 2 | Selos sem fundo | Origem (PDV, Delivery, Salão), atendimento (RETIRADA/ENTREGA/MESA) e tempo viram **ícone + texto**, na cor de sempre. Ícones: PDV = monitor, Delivery = celular, Salão = loja. O número (#146) e o "Novo" continuam com fundo. |
| 3 | Valor | Sem fundo, em negrito, no **mesmo verde do botão Pronto** (o teste compara a cor do valor com a do botão). |
| 4 | Forma de pagamento | Sai de baixo dos itens e vai para **logo abaixo do valor, alinhada à direita**: "Pix · Pago", "Dinheiro · A receber na entrega" e, se tiver troco, "Troco p/ R$ 200,00" embaixo. Mesa continua sem (paga no fechamento). |
| 5 | Itens | 12 → **13 px**. O telefone continua igual. |
| 6 | Tempo | **Um contador só**: "4 min" → "3 horas" → "2 dias". O selo "PARADO HÁ 2 DIAS" saiu; o aviso dele fica no tooltip do contador e no ícone de avisos do topo. As cores de atraso de antes continuam, sem fundo: verde até 10 min, âmbar até 20, vermelho depois. |
| 7 | Botões | Aceitar / Pronto / Entregue / Saiu p/ entrega com **→** depois do texto. "Detalhes" virou **"Ver"** com olho antes. Mesmo tamanho e altura de antes. |

Código:
- `app/admin/pedidos/page.tsx` (card);
- `lib/tempo-pedido.ts` (formato e cor do tempo, com testes);
- variantes opcionais `InfoPagamento card` e `EtiquetaAtendimento semFundo`.

## Prints (`prints/`)
- `antes-desktop.png` / `depois-desktop.png` (1600 px, as 3 colunas);
- `antes-tablet.png` / `depois-tablet.png`;
- `antes-celular.png` / `depois-celular.png`;
- cards de perto, antes e depois: `*-card-recebido.png` (entrega em dinheiro com troco), `*-card-preparando.png` (PDV),
  `*-card-pronto.png` (parado há 2 dias).

## Testes

`scripts/seguranca/e2e-kanban-card.mjs`: **59/59**.
- **Massa de teste** (`kanban-cards-semente.mjs`): 8 cards em todas as colunas — vitrine, entrega, retirada, PDV
  balcão, mesa com comanda; nome longo, 5 itens, valor alto; 4 min, 3 horas e 2 dias.
- **Desktop 1600, tablet 1024 e celular 390:**
  - selos sem fundo e com ícone; número ainda escuro; nenhum "Parado há…";
  - tempo sem fundo nos 3 formatos; 2 dias em vermelho, 4 min em outra cor;
  - valor sem fundo, negrito, no verde do Pronto;
  - pagamento abaixo do valor, alinhado à direita, antes dos itens, no formato "Forma · status"; mesa sem pagamento;
  - itens com 13 px;
  - "Ver" com olho antes; seta depois nos botões de avanço; botões na mesma altura;
  - espaço em cima ≤ 8 px e embaixo ≤ 10 px;
  - nada vaza do card; sem rolagem lateral.
- **Tela cheia** do Kanban: os cards aparecem e não há rolagem lateral.
- **Despacho de rotas:** `rota-panel`, `rota-map`, mapas, `Badge` e `Button` sem nenhuma diferença do main.

**Regressão:**

| Suíte | Resultado |
|---|---|
| kanban-topo / responsivo-kanban | 55/55 · 24/24 |
| cozinha-fase5 / agendamento | 26/26 · 25/25 |
| pdv-pagamento / balcao-entrega / estabilidade-operacional | 57/57 · 84/84 · 53/53 |
| financeiro-fase3 (Logística e motoboy) / regressao-release | 106/106 · 52/52 |
| Vitest | 1952 ok. Um teste de auditoria estourou o tempo com a máquina carregada e passa isolado (8/8). |

`responsivo-kanban` e `balcao-entrega` procuravam o relógio pelo tooltip exato "Tempo desde que o pedido chegou". Nos
pedidos parados o tooltip agora explica que o pedido está parado, então elas passaram a procurar pelo identificador do
contador.
