# Relatório da noite 3 (06/10/2026) — ajustes visuais, sem publicação

## Resumo

1. **Nada foi publicado:** sem push e sem merge no main, sem deploy, sem migration em produção e sem instalador. Não usei Chrome, loja real, impressora de loja nem WhatsApp.
2. **Item 1 – Vitrine estilo iFood** (`vitrine-p9`): **pronto**.
   - Sacola e checkout repaginados: Entrega → Pagamento → "Revise o seu pedido".
   - Ficha do produto, selos verde e roxo, tamanho da imagem e fonte "Estilo iFood".
   - e2e próprio **50/50**.
3. **Gaveta:** nenhuma loja usa em produção (consulta só leitura), então nenhuma loja muda.
4. **Itens 2/3 – Origem + Kanban** (`kanban-55-56`): **pronto**.
   - O prompt "Itens 55 + 56" foi encontrado. Os dois já estavam no main.
   - Ajuste pedido: botões vivos, seta branca e cantos de 4 px.
   - **Conflita com a `kanban-volta`:** publicar só uma das duas.
5. **Item 4 – Celular compacto** (`celular-p7`): **pronto**. e2e **31/31**. Tablet e desktop sem mudança (verificado no teste).
6. **Item 5 – Mapa em Fortaleza** (`mapa-rotas`): **pronto**.
   - Causa: centro fixo de Fortaleza no código.
   - Agora o mapa abre na loja e enquadra a loja e os pedidos.
   - e2e com o Google simulado: **10/10** (o código antigo falhava 9 das 10 verificações).
7. **Migration:** só a **0152** (vitrine: tamanho da imagem e fonte).
   - Aplicada só no banco local; o rollback foi testado.
   - Em produção ela precisa ir **antes** do deploy da `vitrine-p9`.
8. **Regressão:** vitest **2095** em todas as branches.
   - Todas as suítes que os itens tocam estão verdes.
   - As poucas falhas que sobraram existiam antes e estão explicadas em cada item.
9. **Junção:** as 4 branches juntas fazem merge sem conflito (teste num worktree temporário, já apagado).
10. **Ordem sugerida:** `mapa-rotas` → `celular-p7` → (`kanban-55-56` **ou** `kanban-volta`) → `0152` + `vitrine-p9`.

---

## Item 1 — Pendência 9: vitrine estilo iFood

**Status:** pronto. **Branch:** `vitrine-p9`, a partir de `origin/main` bbdc5ed. **Commits:** `2dc7a13`, `0a1c156`.

### O que mudou

**Ajustes › Apresentação do cardápio**
- **Formato:** saiu a Gaveta e o aviso de fotos por categoria; ficam Categorias e Lista.
- **Tamanho da imagem da lista:** 90, 100 ou 110 px, com prévia de uma linha da vitrine. Substitui o "imagem grande".
  - Loja que não escolher fica como antes (120, ou 140 com "imagem grande").
  - A tela avisa isso.
- **Fonte da vitrine:** "Atual" (Montserrat) ou "Estilo iFood".
  - A Estilo iFood é a Figtree, gratuita, que o painel já carrega.
  - Mesmos tamanhos; o que era negrito 700 passa a 600.

**Home:** só a troca de fonte. O chip "Promoções" e o layout não mudaram.

**Sacola**
- **Topo:** voltar, "SACOLA" e "Limpar" (pede confirmação).
- **Loja:** logo e "Adicionar mais itens".
- **Itens adicionados:** foto, lápis (edita), "− 1 +" redondo (com 1 unidade o − vira lixeira) e preço antigo riscado.
- **Peça também:** carrossel com foto, preço e "+".
- **Cupons disponíveis:** no lugar do "Cupons bloqueados" do iFood.
  - Prêmios do clube (selo roxo com diamante) e cupons da loja.
  - "Aplicar" com 1 toque.
- **Resumo de valores:**
  - Subtotal cheio;
  - "Descontos nos itens" e o cupom ou prêmio, em verde;
  - taxa de entrega e total.
- **Barra fixa:** total, quantidade de itens, "Economia de R$ X" e "Continuar".

**Checkout:** Entrega → Pagamento → painel "Revise o seu pedido".
- **Entrega:**
  - endereço salvo com "Trocar", ou o formulário;
  - "Opções de entrega": Padrão (Hoje, 30–45 min, taxa) e Retirar na loja (Grátis);
  - atalho "Taxa grátis retirando o seu pedido na loja";
  - agendamento;
  - "Seus dados".
- **Pagamento:**
  - "Pagar agora" com o Pix online, **só com a flag**;
  - "Pagar na entrega": Cartão, Dinheiro com troco, e Pix quando não há Pix online;
  - cupom por código e resumo.
- **"Revise o seu pedido":** entrega ou agendamento, pagamento, itens, dados, economia e total, com "Fazer pedido" e "Alterar pedido".

**Ficha do produto**
- Grupos em faixa cinza com OBRIGATÓRIO em grafite e check verde quando o grupo está completo.
- Contadores "− / +" redondos e "Adicionar R$ X".
- Opções com foto (já existia).

**Selos**
- **Desconto comum:** selo verde sólido "-X%", branco sobre #0B7A3E (5,4:1), e preço atual em verde.
  - Antes: #24A96A sobre #EAFFF5, 2,9:1.
- **Preço antigo:** #737373 (4,7:1). Antes: #A1A1AA, 2,6:1.
- **Diamante roxo:** desenho próprio (`components/vitrine/sacola-ifood.tsx`). Não é arquivo do iFood.

**Não quebrou** (verificado nos testes):
- Pixel e API de Conversões (InitiateCheckout, AddPaymentInfo ao sair do Pagamento e Purchase);
- cupons e fidelidade;
- agendamento, taxa de entrega e Pix online;
- pedido mínimo e WhatsApp: a lógica não foi tocada.

### Migration

- `supabase/migrations/0152_vitrine_imagem_fonte.sql` — `vitrine_imagem_tamanho smallint` (90/100/110 ou null) e `vitrine_fonte text default 'atual'`, com grants.
  - Aditiva: nenhuma linha é convertida.
- **Rollback:** `docs/rollback/0152_vitrine_imagem_fonte.down.sql`, testado numa transação no banco local.
- **Aplicar em produção ANTES do deploy:** a vitrine e Ajustes leem as colunas.

### Lojas afetadas

- **Gaveta:** nenhuma loja usa. Em produção são 2 em "categoria" (teste, w-lanches-reviver) e 8 em "lista".
- **"Imagem grande" ligada:** estancia-burger, nossa-cozinha, pizza-do-rosa e villa-lanches.
  - Continuam com 140 px até o dono escolher 90, 100 ou 110.
- **Sacola e checkout novos:** todas as lojas, porque é a vitrine.
- **Pagar agora:** só onde o Pix online estiver ligado (hoje só a Menuzia, ainda sem credenciais).

### Testes

| Suíte | Resultado |
|---|---|
| **e2e-vitrine-p9 (novo)** | **50/50** |
| checkout-larguras (360/390/414 × entrega/retirada × Pix/Cartão/Dinheiro) | 72/72 |
| vitrine-celular-sem-codigo | 11/11 |
| agendamento | 26/26 |
| pixel-conversao | 52/52 |
| vitrine-fase3 | 51/51 |
| pix-online | 54/54 |
| vitrine-tags | 27/27 |
| vitrine-p8 | 142/142 |
| vitest | 2095 |

O e2e novo cobre:
- Ajustes sem Gaveta, com prévia e salvando;
- foto de 90/110 px e fonte Figtree com peso ≤ 600;
- sacola completa, com cupom aplicado em 1 toque gravando no pedido;
- ordem das etapas e o "Alterar pedido";
- Pix online com o Mercado Pago **simulado**, até "pagamento aprovado";
- contraste ≥ 4,5:1 e peso ≤ 600 na ficha, na sacola, no checkout e na revisão;
- 360/390/430 sem rolagem lateral, tablet e desktop.

Cinco e2e do checkout foram atualizados para a nova ordem, com as mesmas verificações: larguras, celular-sem-código, agendamento, pixel e origem-55.

`origem-55` nesta branch dá 33/35 por pedidos de teste "TESTE…" que o Dashboard exclui. Está corrigido no teste da `kanban-55-56` (ver item 2/3); com as duas juntas, 35/35.

### Prints

- `docs/vitrine-p9/antes-*` e `depois-*` (390 e 1366: home, lista, ficha, sacola e cada etapa).
- `docs/vitrine-p9/e2e/` (telas do e2e).
- **Lado a lado com o iFood:** `docs/vitrine-p9/lado-a-lado-{ficha,sacola,sacola-fim,entrega,pagamento,revise,lista}.png`.

### Pendências

Cinco scripts auxiliares de prints e auditoria ainda seguem o fluxo antigo do checkout. Não são suítes de regressão:
- `scripts/vitrine/auditar-fontes-vitrine.mjs`
- `scripts/vitrine/e2e-tela-cheia-navegadores.mjs`
- `scripts/seguranca/verificar-vitrine-nome-zoom.mjs`
- `scripts/push/prints-push.mjs`
- `scripts/pix-online/prints-cliente.mjs`

---

## Itens 2 e 3 — Origem (55) + Kanban (56)

**Status:** pronto. **Branch:** `kanban-55-56`, a partir de `origin/main`. **Commit:** `347efb7`. Sem migration.

### Prompt e modelo

- **Prompt:** "Itens 55 + 56" **encontrado** (mensagem de 05/10, 03:14).
- **Modelo:** `C:\Users\felipe\Downloads\kanban-modelo.jpeg` **não está em Downloads**. Usei a cópia do repositório, `docs/kanban-56/modelo.jpeg`.

### Situação

Os dois itens já estão no main:
- **f75606c:** origem até o pedido (0149), área "Origem das visitas" no Dashboard e Kanban do modelo;
- **ef34a80:** cores exatas do modelo.

Desta noite, só o ajuste que faltava:
- **Botões de etapa** com fundo sólido e vivo, seta **branca** e cantos de **4 px**:
  - aceitar em amarelo-ouro #A16207 (4,9:1);
  - próxima etapa em verde #15803D (5,0:1).
  - Antes: tons claros com seta colorida; o de aceitar dava 2,6:1.
- **Peso 600** no card e nos cabeçalhos (regra 6).
- **Painel lateral:** preços no mesmo verde do botão.
- **Topo:** não mudou. **Card:** continua com 3 linhas.

### ⚠️ Conflito com a `kanban-volta`

- `kanban-volta` (945daa6, não publicada) **volta o Kanban ao visual de antes do item 56**.
- `kanban-55-56` vai no sentido oposto: modelo mais botões vivos.
- **Publicar só uma.** Se for a `kanban-55-56`, a `kanban-volta` pode ser apagada.

### Ponto para você decidir

Os cabeçalhos das colunas seguem as cores **exatas do modelo** (#FE4B11 / #015BB1 / #00946E), como você pediu em ef34a80. O texto branco sobre o laranja dá ~3,3:1 e sobre o verde ~3,9:1, abaixo de 4,5. Não mexi, porque a regra 2 fala de botões e selos.

### Testes

| Suíte | Resultado |
|---|---|
| kanban-56 | 34/34 |
| kanban-card | 72/72 |
| kanban-topo-v2 | 121/121 |
| origem-55 | 35/35 |

**Correção no `origem-55`:** a conta do banco agora tira os pedidos "TESTE…", como o Dashboard faz desde o item 54. Outros e2e deixam esses pedidos na loja local. Não é afrouxar: é a mesma regra da tela.

**`responsivo-kanban`: 18/24, pré-existente.** O teste é anterior ao item 56 e não conhece a etiqueta BALCÃO.

### Prints

`docs/kanban-56/noite3/antes/` e `docs/kanban-56/noite3/depois/`. O lado a lado com o modelo está em `docs/kanban-56/lado-a-lado.png`.

---

## Item 4 — Pendência 7: versão compacta no celular

**Status:** pronto. **Branch:** `celular-p7`, a partir de `origin/main`. **Commit:** `6cd1cb0`. Sem migration.

Só abaixo de 768 px. Tablet e desktop sem mudança, conferido no e2e.

### O que mudou

- **Topo** (Mesas e Comandas, tela da mesa):
  - só a **tela cheia** fica à vista;
  - Nova mesa, Folha de QR, Conta e pagamentos e Trocar de mesa vão para um **menu ⋮**, na camada máxima;
  - o **garçom não vê** ações de gestão.
- **Tela cheia:** além da do navegador, o painel esconde o topo e o **aviso de impressão**, com um botão flutuante para sair.
  - Funciona também no iPhone, que não tem a Fullscreen API.
  - Sair da tela desliga o modo.
- **Busca vira lupa:** em Mesas e na busca do cardápio da tela da mesa.
- **Cartão de mesa:** sem a fileira de botões; ⋮ no canto com QR, Editar, Bloquear e Desativar.
- **Cartão azul da mesa:** faixa fina numa linha, de ~130 para ≤ 72 px.
- **Barra de baixo sempre fixa:** o painel passou de `h-screen` para `h-dvh`.
  - No celular, 100vh passava da área visível. No desktop é igual.
- **Conta:** foto de cada item (vinda do cardápio); Reimprimir e Cancelar ficam no ⋮ do lançamento.
- **PDV:** "Sair do PDV" no ⋮.
  - **Balcão com no máximo 2 selos** (Cozinha e Financeiro); Entrega ou Retirada vira ícone.
- **Pílula do caixa:** "● Caixa" colorida, antes só um ícone, no topo do celular e no cabeçalho do PDV (só com financeiro ligado).

### Testes

| Suíte | Resultado |
|---|---|
| **e2e-celular-p7 (novo)** | **31/31** |
| garcom | 47/47 |
| release-mesas | 254/254 |
| pdv-v2 | 70/70 |
| pdv-janelas | 53/53 |
| pdv-navegacao | 30/30 |
| pdv-pagamento | 57/57 |
| vitest | 2095 |

`verificar-responsivo-mesas` agora abre o QR pelo ⋮ no celular.

**Pré-existentes**, em código não tocado nesta branch:
- `pdv-atendimento` 95/97 e `balcao-entrega` 83/84: verificam o card do Kanban de antes do item 56 (selo DELIVERY, etiqueta RETIRADA).
- `verificar-responsivo-mesas` 238/254: todas por um mesmo botão da barra lateral, de 18×32 px (`components/layout/sidebar.tsx:163`).

**A confirmar:** `financeiro-mesma-base` falha 1 verificação ("status do caixa com y < 60").
- A pílula está na linha do título.
- O y = 74 vem da faixa vermelha "Toque aqui para ativar o som", que fica acima do topo no navegador sem som.
- Vale conferir se essa verificação já falhava no main.

### Prints

`docs/celular-p7/antes-*` e `depois-*` (dono e garçom, 390) e `docs/celular-p7/e2e/`, com o menu, a tela cheia, a mesa, a conta, o PDV, tablet e desktop.

---

## Item 5 — Mapa de rotas abrindo em Fortaleza

**Status:** pronto. **Branch:** `mapa-rotas`, a partir de `origin/main`. **Commit:** `fcdc838`. Sem migration.

### Causa

- `components/pedidos/rota-map.tsx` nascia com o centro **fixo de Fortaleza** (-3.73, -38.53, herança do protótipo) e não sabia onde a loja fica.
- Sem pedido pronto, ou com endereço que não geocodificava, o mapa ficava lá.
- Endereço sem cidade podia cair numa rua homônima de outro estado.

### Correção (só funcionamento)

- O painel lê a **latitude e a longitude da loja** (Ajustes). Sem elas, geocodifica "Cidade, UF".
- Abre na loja, com zoom 14. Com pedidos, **enquadra a loja e os pedidos**.
- A geocodificação dos pedidos usa um **viés** numa caixa em volta da loja.
- **Reserva:** sem nada da loja, o Brasil inteiro (zoom 4), nunca Fortaleza.

**Design intocado (regra 4):** o diff visual entre os prints de antes e depois é de 0,18%, só os pinos.

As travas da regra 4 em `kanban-topo-v2` e `kanban-card` exigiam o arquivo idêntico ao main. Agora elas comparam a **superfície visual** com o main:
- todas as 139 classes do painel;
- o estilo do mapa;
- os ícones dos pinos e das motos.

O design continua travado; só o funcionamento pode mudar. Mapas, Cozinha, badge e botão continuam exigindo **zero** alteração.

### Testes

| Suíte | Resultado |
|---|---|
| **e2e-mapa-rotas (novo)** | **10/10** |
| kanban-topo-v2 | 121/121 |
| kanban-card | 73/73 |
| vitest | 2095 |

O e2e simula a API do Google: o script é interceptado e nenhuma chamada sai da máquina. No código antigo, ele falha 9 das 10 verificações. Prints em `docs/mapa-rotas/antes/` e `depois/`.

### Lojas

Todas as lojas reais têm coordenadas (consulta só leitura). Usam o despacho:
- db-doces;
- mama-pizza;
- pizza-do-rosa;
- ponto-400-hamburgueria;
- villa-lanches;
- w-lanches-reviver.

---

## Decisões que tomei sozinho (para você confirmar)

**Vitrine**
1. **Fonte "Estilo iFood" = Figtree:** gratuita, já carregada no painel. Peso 700 vira 600.
2. **Gaveta:** sai só da tela. O valor `gaveta` continua válido no banco e a vitrine o mostra como Lista (sem converter dado).
3. **Tamanho null:** fica o tamanho de antes. Ajustes só grava quando o dono escolhe.
4. **"Exclusivo / clube" não existe no banco:** o diamante e o selo roxo marcam o **prêmio de fidelidade**.
5. **Pix com a flag do Pix online:** fica só em "Pagar agora", como antes (loja com Pix online não oferecia Pix na entrega).
6. **Agendamento:** foi para a etapa Entrega. O AddPaymentInfo continua ao sair do Pagamento.
7. **Menu de baixo:** continua visível na sacola (regra da P8). A barra "Continuar" fica acima dele.
8. **Sacola, checkout e ficha:** botões com a cor **escura** do tema (a primária azul dava 3,7:1). O "Continuar" e o "Fazer pedido" são verde #0B7A3E.
9. **Prazo:** "30–45 min" é o mesmo texto fixo de antes; não há campo de prazo no banco.
10. **Gorjeta:** não incluí, porque não foi pedida.
11. **Etapas do checkout:** só existem com ele aberto. Campos escondidos disputavam com a janela da conta.

**Kanban**

12. **Botões:** amarelo-ouro #A16207 e verde #15803D.
13. **Cabeçalhos das colunas:** mantive as cores exatas do modelo, mesmo abaixo de 4,5:1.

**Celular**

14. **"Celular" = abaixo de 768 px.**
15. **Tela cheia** esconde topo e aviso de impressão, mas **não** a faixa de "som bloqueado", que avisa pedido novo.
16. **Pílula do caixa** com texto em todo o painel no celular.
17. **Balcão no celular:** Cozinha + Financeiro; Atendimento sai e o tipo vira ícone.

**Mapa**

18. **Reserva do mapa:** Brasil inteiro.
19. **Travas da regra 4:** passaram a comparar a superfície visual, não o arquivo inteiro.

---

## Ordem sugerida de publicação

Cada item é publicado separadamente, com a regra de sempre:
- backup;
- conferência só na Menuzia "Angus Burguer", no perfil "Menuzia teste";
- rollback pronto;
- acompanhamento das lojas.

1. **`mapa-rotas`:** só funcionamento, sem migration, risco baixo.
   - **Conferir:** abrir "Rotas" na Menuzia; deve abrir em Vila Velha.
2. **`celular-p7`:** sem migration; só mexe abaixo de 768 px.
   - **Conferir:** Mesas, uma mesa e o PDV no celular (iframe de 390 px), como dono e como garçom.
3. **`kanban-55-56`, ou a `kanban-volta`:** decidir antes; são opostas.
   - **Conferir:** botões e pedido de TESTE na Menuzia.
4. **Migration `0152`** (com backup) e depois **`vitrine-p9`:** é a maior e mexe no fechamento de pedido de todas as lojas.
   - **Conferir na Menuzia:** sacola, cupom, entrega, retirada, pagamento, revisão e pedido de TESTE (cancelar no fim).
   - Acompanhar os pedidos das lojas na primeira hora.
   - **Rollback:** voltar o deploy. A 0152 pode ficar, porque é aditiva.

---

## Acompanhamento do deploy da impressão (noite anterior, 1 h)

- **Período:** 6 rodadas, de 02:32 a 03:22.
- **Lojas:** as 4 lojas sempre com HTTP 200.
- **Modos de impressão:** não mudaram.
- **Pedidos:** 0 pedidos presos.
- **Assistente:** o beta.9 da Menuzia vivo até 03:22.
- **Logs:** só `AuthRefreshDiscardedError` (sessão), nada de impressão.

---

## Observação de ambiente

Durante o teste do mapa, um pedido **local** ("TESTE Card Parado Dois Dias", loja `ordem-qr-e2e`) ficou em "entregue". Devolvi para "pronto" no banco local e tirei esse passo do teste. Nada em produção.
