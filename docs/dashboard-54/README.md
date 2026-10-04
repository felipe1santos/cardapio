# Item 54 — Dashboard geral: análises no visual do financeiro (2026-10-04)

Vale para o Dashboard de **todas** as lojas. Sem migration e sem API nova. Só visual: os números são os
mesmos de antes, com uma exceção pedida: os **pedidos de TESTE** saem das análises das lojas reais.

## 0. Os 3 erros "Connection Closed" do WhatsApp

Os erros eram da instância da **Menuzia** (estado `close`), nos avisos dos pedidos de teste #150/#151
(16h07–16h12). As lojas reais **Estância** e **Ponto 400** estavam `open`, e o robô da Ponto 400 respondeu
normalmente até 18h20. A Villa Lanches segue desconectada, o que já era sabido. Nada foi reconectado.

## 1. O que mudou

Tudo de "Análise de pedidos" para baixo virou **um bloco só, em abas**, no visual do financeiro (kit Meta):

| Aba | Conteúdo |
|---|---|
| Pedidos | KPIs (total, novos, recorrentes, faturamento); gráfico de pedidos (barras: total; linhas: novos × recorrentes); gráfico de faturamento |
| Entrega | Medidor entrega × retirada, formas de pagamento (`% · R$`), tempos |
| Bairros | Mapa + ranking "Bairros que mais pedem" (barras do kit) + tabela por bairro |
| Produtos e categorias | Categorias em barras + tabela de produtos |
| Cliques da vitrine | "Cliques que importam" (até 10), grupos Navegação/Escolha, "Ver todos" (tabela com coluna Tipo), Origem das visitas |

- **Filtro de período único:** é o mesmo controle (mesmo estado) no topo da página e no cabeçalho do bloco.
- **A aba fica na URL** (`?aba=bairros`); voltar e avançar do navegador trocam de aba, e recarregar a
  página abre na aba certa.
- **Teclado:** as setas ← → trocam de aba (o foco acompanha). No gráfico, Tab chega a ele, as setas
  percorrem os períodos com o tooltip, Home/End vão às pontas e Esc fecha.
- **Toque:** o tooltip do gráfico e a dica do pino ficam abertos depois de soltar o dedo e fecham ao
  tocar fora.
- **Celular:** abas roláveis na horizontal, o mapa encosta nas bordas do card (323×360 em 390 px) e o
  ranking fica embaixo do mapa.
- Saíram `heatmap-card.tsx`, `grafico-linhas.tsx` e `grafico-area.tsx` (o bloco usa o gráfico do kit),
  além da rosca e das cores antigas da página.

### Mapa

- Fundo em cinzas claros, com as ruas visíveis (brancas com contorno) e os rótulos discretos; sem POI e
  sem transporte.
- **Pinos** pequenos (9–16 px, conforme o número de pedidos no endereço), no azul da paleta (#1877F2),
  com borda branca. Hover, foco ou toque mostram a dica no estilo do kit.
- **Áreas sutis** só nos 6 bairros que mais pedem: a mancha em volta dos pedidos do bairro (folga de ~150 m),
  mais forte quanto mais pedidos. Pedidos a menos de 600 m uns dos outros formam uma mancha só; um pedido
  solto, a mais de 1,2 km do centro do bairro, fica fora da área. Assim, a área não vira um triângulo
  atravessando outro bairro.
- **Enquadramento:** o zoom pega os pedidos e a loja (zoom máximo 16). Um endereço geocodificado a
  **mais de 30 km da loja** (homônimo em outra cidade) sai do mapa; antes, um só erro desses afastava o
  zoom até o estado inteiro. O mapa fica invisível até enquadrar, sem o Brasil piscando na tela.
- **Loja sem pedidos:** o mapa mostra o ponto da loja com o aviso "sem pedidos". **Loja sem bairro nos
  pedidos:** aparecem os pinos, sem áreas, e o ranking diz "Sem pedidos com bairro".
- Os pinos fogem da camada de toque do painel (`data-toque-livre`). Sem isso, a altura mínima de 44 px
  dos `[role=button]` no celular esticava os pinos em ovais.
- O Google Maps só desenha os pinos (OverlayView) quando o mapa entra na tela. Abrindo direto em
  `?aba=bairros`, eles aparecem ao rolar até o mapa, que é o comportamento normal da API.

### Fonte dos contornos e custo

**Área calculada em volta dos próprios pedidos**, sem limite oficial de bairro e **sem custo novo**: usa o
mesmo Geocoder que o mapa antigo já usava.
- Os limites oficiais do Google (data-driven styling de bairro) exigiriam um Map ID novo e esse recurso
  ligado, e **não foram ativados**.
- IBGE e OSM só têm bairros de parte das cidades.

### Pedidos de TESTE

`lib/dashboard-limpeza.ts → ehPedidoDeTeste`. Um pedido é de teste quando:
- o cliente, a observação ou o bairro têm a palavra "teste/testes/test";
- ou o pedido foi feito com o telefone de teste (…27992534407).

Esses pedidos saem das análises de toda loja que **não** for de teste. Na `menuzia` eles continuam.

**O que sai em produção (leitura feita em 2026-10-04):** só o pedido **#29 da Villa Lanches** (cliente
"teste", R$ 2,50, 26/09). Nas outras lojas reais nada muda. Os bairros "fora da lista" da Ponto 400
(Valparaíso, Santa Mônica…) são reais e continuam.

### Cliques da vitrine

`classificarClique` separa os cliques em produto, categoria, banner/promoção, cupom, sacola, ir para
pagamento, escolha do produto e navegação.
- Os 10 maiores dos tipos que importam aparecem em destaque.
- Navegação (×, ←, Fechar, Entrar, Home, Continuar no cardápio…) e as escolhas de complemento ficam
  agrupadas numa linha cada.
- "Ver todos" abre a tabela completa, com a coluna Tipo.

## 2. Onde ficou o kit

- `components/financeiro/ui/meta.tsx` foi para **`components/graficos/kit-meta.tsx`**.
- `components/financeiro/ui/grafico.tsx` foi para **`components/graficos/grafico.tsx`**.
- O financeiro só trocou os imports.
- Tema: os mesmos tokens valem em `.fin-meta` (financeiro, com a fonte Figtree) e em **`.meta-tema`**
  (compartilhado, sem trocar a fonte).
- As regras usam `:is(.fin-meta, .meta-tema)`, e o fundo em gradiente continua só no financeiro.
- Os acréscimos ao kit não mudam o visual do financeiro: setas nas `Abas` e teclado no `GraficoFinanceiro`
  (anel de foco só no `:focus-visible`).

## 3. Testes

| O quê | Resultado |
|---|---|
| Valores antes × depois (`scripts/dashboard/comparar-54.mjs`) | R$ 26/26, % e células todos presentes (desktop e celular). Faltam só os números 23, 29, 33, 38 e 77, que eram os rótulos das bolhas do mapa antigo; o dado continua no ranking, na tabela e na dica |
| Pedidos de TESTE (`limpeza-teste-54.mjs`) | Loja real: total 30 e R$ 1.833,00 iguais com e sem os 2 de teste. Menuzia: 30 → 32 (+R$ 190,00) |
| e2e do bloco (`e2e-54.mjs`) | **45/45**, três rodadas seguidas: abas, URL, voltar/avançar, recarregar, setas, filtro único, hover/teclado/toque no gráfico, mapa (pinos, cor, tamanho, áreas, enquadramento), ranking ao lado/embaixo, loja sem pedidos, loja sem bairro, "Ver todos", celular sem rolagem lateral |
| Contraste (`capturas-54.mjs`) | 0 textos abaixo de 4.5:1 nas 5 abas (desktop e celular) |
| Unitários novos | `dashboard-limpeza` 5/5, `mapa-bairros` 6/6 |
| Financeiro (kit movido) | atomico 23/23, cmv 61/61, contas 80/80, fase1 66/66, fase2 55/55, fase3 106/106, fase6 97/97, fluxo 86/86, integrado 52/52, mesma-base 53/53, loja-sem-financeiro 6/6 |
| Dashboard | dashboard-banco 8/8 (a conta do SQL agora tira os pedidos de TESTE pela mesma regra: na `fin-int`, 1014 dos 1016 pedidos são "TESTE …"), pixel-conversao 48/48 |
| PDV | pdv-v2 70/70, pdv-pagamento 57/57, pdv-navegacao 30/30 |
| Kanban | kanban-card 72/72, kanban-topo-v2 121/121 |
| Vitrine | vitrine-fase3 51/51, vitrine-celular-sem-codigo 11/11 |
| vitest | **2022 passaram** (10 pulados). 4 testes já falhavam na `main` e foram atualizados: `tailwind.config.test.ts` (desde o 4b as cores-base são `--cor-*`; o teste agora confere a cor resolvida no `:root`) e `app/mesa/[token]/etiquetas.test.tsx` (desde a P8 o selo chama "Mais Pedidos") |
| tsc | ok |

## 4. Prints

- `antes/`: a página inteira (desktop 1366 e celular 390), de "Análise de pedidos" para baixo. A captura
  solta a rolagem interna do painel para pegar tudo.
- `depois/`: uma imagem por aba (`pedidos`, `entrega`, `bairros`, `produtos`, `cliques`) em desktop e
  celular, mais a página inteira (`dashboard-*.png`).
- `valores-antes.json` e `valores-depois.json`: o retrato dos números usado na comparação.

Dados: lojas locais de `scripts/dashboard/semear-54.mjs` (`dash54-loja`, `dash54-sem-pedidos`,
`dash54-sem-bairro`, `menuzia`).
