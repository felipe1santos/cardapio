# Item 56 — Novo visual do Kanban (2026-10-05)

O modelo é `modelo.jpeg` (a imagem que o dono mandou). O topo continua como era, pelas regras 1 e 2.

## O que mudou

- **Colunas:**
  - cabeçalho sólido nas cores EXATAS do modelo: laranja #FE4B11, azul #015BB1, verde #00946E;
  - ícone, título e contador em pílula;
  - corpo #F7FCFF com borda suave e cantos de 12 px.
- **Card**, sempre com 3 linhas, branco e faixa à esquerda na cor da coluna:
  1. `#número` em pílula escura (#243549) · ícone e nome da **origem** (item 55) … à direita, ícone e ENTREGA / RETIRADA / BALCÃO / MESA | ⏱ tempo.
     - Pedido da vitrine **Direto** não mostra ícone nem nome.
     - PDV, balcão e mesa mostram o canal ("PDV", "Salão").
     - A dica diz, por exemplo: "Origem: Instagram (campanha X)".
  2. **Nome** em negrito · 📞 telefone · ícone e forma de pagamento ("Pix online" quando for o caso) · valor em selo verde-claro (#E3FAED, texto verde).
  3. **Botão só com a seta, à direita**, 88 × 30 px, cantos de 8 px, como no modelo:
     - **amarelo-claro** #FFE6A6 com seta âmbar para aceitar;
     - **verde-claro** #D3F6E0 com seta verde para a próxima etapa.
     - "Na logística" continua igual quando a loja usa o despacho de rotas.
- **Cores = o modelo, exatamente** (decisão do dono, 2026-10-05): a regra de "fundo sempre escuro" saiu. Os botões e o selo do valor ficam nos tons claros da imagem.
- **Card estreito** (menu aberto + 4ª coluna, tablet, celular): o card encolhe pela **largura dele** (container query). Primeiro some o telefone, depois os nomes (origem, pagamento, atendimento), e fica o ícone com a dica. Nada se sobrepõe.
- **Mantido:**
  - o clique no card abre o painel lateral (sem bloquear a tela);
  - cancelar só pelo painel;
  - o pedido novo pisca, e pisca em vermelho com o som bloqueado;
  - as dicas e o aceite automático.
- **Painel lateral do pedido:** nova linha "Origem: (ícone) Instagram (campanha …)", "Direto" ou o posto. Os preços do painel passaram para o mesmo verde do botão (#047857, antes #10B981, que tinha 2,5:1 sobre branco).

## Prints

| Arquivo | O quê |
|---|---|
| `lado-a-lado.png` | modelo × Menuzia (1600 px, 3 colunas) |
| `kanban-desktop-1600.png` | desktop largo |
| `kanban-desktop-como-modelo.png` | 1280 px, 3 colunas, sem a barra de métricas |
| `kanban-desktop-4-colunas.png` | 1280 px com menu, métricas e 4ª coluna (card encolhido, sem sobreposição) |
| `kanban-desktop.png` | 1280 px no estado padrão da loja |
| `kanban-desktop-painel.png` | painel lateral com a origem |
| `kanban-tablet.png`, `kanban-celular.png` | tablet (820 px) e celular (412 px) |

## Testes
- `scripts/kanban/e2e-kanban-56.mjs`: **33/33**.
  - Origem certa em cada um dos 6 pedidos do modelo, sem ícone para Direto, e PDV no balcão.
  - Dica da origem, 3 linhas, seta à direita sem ocupar a largura, cantos de 8 px.
  - Cores do modelo nos botões (amarelo-claro e verde-claro), no valor (verde-claro) e nos 3 cabeçalhos; faixa na cor da coluna.
  - O pedido novo pisca e o em preparo não.
  - Painel com a origem; a seta aceita.
  - Linha 2 sem sobreposição com 3 e com 4 colunas.
  - Tablet e celular: sem rolagem lateral e card mínimo.
- `e2e-kanban-card`: 72/72. Foi atualizada para o desenho novo: o valor virou selo verde-claro e o botão virou só a seta, à direita, nas cores do modelo.
- Também passaram: `kanban-topo-v2` 121/121, `kanban-topo` (som e aviso) 48/48 e `alarme-global` 27/27.
