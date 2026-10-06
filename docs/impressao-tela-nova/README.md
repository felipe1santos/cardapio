# Impressão: duas opções e tela nova (2026-10-05/06)

**Branch `impressao-v3`. O código da impressão v3 já está no `main`, mas o deploy ainda não foi feito.** O instalador beta.9, a release e o link novo seguem a ordem do checklist abaixo.

## As duas opções

| Opção | O que imprime | Como é gravada |
|---|---|---|
| **Assistente antigo** (padrão) | a comanda de hoje (Assistente 0.1.23) | modo do Beta = `teste` |
| **Assistente Beta (novo)** | **comanda da cozinha e pré-conta** no modelo v3; a via da cozinha sem valores é opcional e começa desligada | modo do Beta = `cozinha_caixa` |

- **Nada novo no banco:** a opção é **lida** do modo que a loja já tem (`lib/impressao/opcao.ts`). `teste` aparece como antigo; `caixa` e `cozinha_caixa` aparecem como Beta. **O deploy não muda nenhuma loja.**
- **Trocar de opção:**
  - pede confirmação simples: "Sua loja vai passar a imprimir pelo Assistente Beta. Ele precisa estar instalado e conectado.";
  - grava pela troca **auditada** de sempre (`impressao_modo_definir` → `eventos_auditoria`, ação `impressao.modo_alterado`);
  - voltar ao antigo é sempre permitido e devolve a cozinha ao Assistente antigo na hora.
- **Beta sem instalar ou conectar:**
  - em vez de ativar, abre o **passo a passo**: 1) instalar, 2) conectar com o código de 8 letras, 3) escolher a impressora da Cozinha;
  - o botão "Ativar" só libera com tudo pronto, para a loja não ficar sem impressão.

## Como cada loja fica (produção, só leitura, 06/10 ~01:00)

| Loja | Imprime | Modo hoje | Opção na tela | Beta instalado | Muda no deploy? |
|---|---|---|---|---|---|
| menuzia | sim | cozinha_caixa | **Assistente Beta** | beta.7 | não |
| villa-lanches | sim | cozinha_caixa | **Assistente Beta** | beta.7 (2 PCs) | não |
| ponto-400-hamburgueria | sim | **teste** | **Assistente antigo** ⚠ | beta.6 (só testes) | não |
| estancia-burger | sim | teste | Assistente antigo | — | não |
| pizza-do-rosa | não | caixa | Assistente Beta (só pré-conta) | beta.6 | não |
| mama-pizza, teste | não | teste | Assistente antigo | — | não |
| db-doces, nossa-cozinha, w-lanches-reviver | não | teste | Assistente antigo (Beta não liberado) | — | não |

⚠ **Ponto 400:**
- O modo dela é "Somente teste": a **comanda sai hoje pelo Assistente antigo** (visto 05/10 23:19), e o Beta beta.6 dela só imprime testes.
- Pela regra "cada loja continua exatamente como imprime hoje", ela aparece como **Assistente antigo**.
- Para passar ao Beta, ela (ou você) clica em "Assistente Beta". O passo a passo confere a conexão e a impressora antes de ativar.

**Pizza do Rosa:** está em "Somente Caixa" (o Beta imprimiria só a pré-conta) e não imprime. Aparece como Beta, com o aviso "Hoje o Beta imprime só a pré-conta" e o botão "Passar a comanda para o Beta".

**Via da cozinha:**
- desligada em todas as lojas;
- só o Assistente **beta.9** sabe imprimi-la, então as lojas no beta.6/7 continuam sem ela até atualizar, mesmo que alguém ligue a opção.

## Tela nova (kit do Financeiro/Dashboard)

1. **Como sua loja imprime:** as duas opções lado a lado, em cards clicáveis (radio). Cada uma tem uma frase e um selo; a recomendada é o Beta.
2. **Situação:**
   - Assistente (conectado ou sem sinal), versão, impressoras e última impressão, cada um com um ponto verde, âmbar ou vermelho;
   - um selo geral: "Tudo certo", "Atenção" ou "Precisa de ação";
   - **um** aviso com faixa e **um** botão: "Baixar e instalar o Assistente", "Atualizar para o beta.9", "Escolher impressoras", "Ver como resolver", "Passar a comanda para o Beta" ou "Falar com o suporte".
3. **Modelos:**
   - "Ver comanda", "Ver pré-conta" e "Ver via da cozinha"; na opção antiga, só "Ver comanda";
   - "Imprimir teste";
   - a chave da via da cozinha.
4. **Configurações avançadas** (recolhidas):
   - Beta: computadores, impressoras, "Calibrar e ajustar" (passo a passo, envio direto e letra por impressora), opções da comanda e diagnóstico;
   - antigo: token, impressoras do antigo e opções.

**Saiu da tela:**
- os três modos ("Somente teste / Somente Caixa / Cozinha e Caixa");
- o botão "Assistente antigo" do topo;
- a prévia lateral fixa;
- o botão "Testar impressão" do topo (foi para os Modelos).

Nada foi removido do servidor; as rotas continuam as mesmas.

## Prévia em janela

- **`ModalCentral`** (`components/ui/flutuante.tsx`):
  - portal no `<body>`, camada máxima, fundo escurecido;
  - X, Esc e clique fora fecham;
  - o foco fica preso dentro e volta ao botão que abriu;
  - rola por dentro.
- **`NoTopo`:** as outras janelas da tela (pareamento, impressoras, testes, ajuda, calibração) também vão para o topo. A aberta por último fica por cima.
- **Tamanho do papel:** a bobina tem 80 ou 58 mm de verdade, e a área impressa 72 ou 48 mm (pontos ÷ 8). Há o botão "Ampliar" para ler os detalhes.
- **Sem fechar:** troca Comanda / Pré-conta / Via da cozinha e Entrega / Retirada / Mesa / Balcão.
- **Mesmo desenho da impressora:**
  - **Beta:** `v3.js` + `ticket-canvas.js` (o do instalador). O e2e compara a janela com o desenho do Assistente e dá **0 pontos diferentes**.
  - **Antigo:** `recibo.js` (o do Assistente) + `lib/impressao/recibo-antigo-canvas.js`, uma porta do `print.ps1` com a métrica da Consolas no GDI+ (avanço 0,5664 em). Contra o PNG real do `print.ps1` da tag 0.1.23, em 7 casos (80/58 mm, 3 letras, fonte maior, logo): **mesma largura e altura (0,0%)**, com 8 a 18% de diferença só no contorno das letras.
- **Dados de demonstração** (`lib/impressao/demonstracao.mjs`): os mesmos dos modelos v3 (pedido #135 e mesa 04). Com os dados da Ponto 400, a prévia é **idêntica** às amostras em `Downloads\impressao-v3-teste\`: 0 pontos diferentes em `comanda-entrega`, `-58mm`, `preconta-mesa` e `-58mm` (`scripts/impressao/conferir-downloads.mjs`).

## Testes

- **Unitários:** `lib/impressao/opcao.test.ts` (6) e vitest completo: **2095 passaram**.
- **`scripts/impressao/e2e-tela-impressao.mjs`: 33/33**
  - a opção do modo de hoje;
  - Beta sem computador → passo a passo, "Ativar" travado, Esc fecha;
  - Beta pronto → confirmação → grava `cozinha_caixa` → auditoria;
  - beta.6 → aviso "Atualizar para o beta.9";
  - via da cozinha começa desligada;
  - janelas: papel de 80 mm e área de 72 mm, prévia = desenho do Assistente, abas sem fechar, Esc e foco, Tab preso;
  - contraste dos selos e botões ≥ 4,5:1 (4,7 a 6,8);
  - voltar ao antigo grava `teste`;
  - janela do antigo;
  - celular 360/390/430: sem rolagem lateral, opções empilhadas, janela inteira.
- **`scripts/impressao/golden-previa-antigo.mjs`:** 14/14.
- **`scripts/impressao/conferir-downloads.mjs`:** 4/4.
- **Regressão em lotes:**

  | Suíte | Resultado |
  |---|---|
  | impressão v2 (Beta e Assistente antigo, roteamento) | 41/41 |
  | Assistente Beta | 48/48 |
  | modelos | 56/56 |
  | aviso | 34/34 |
  | aviso por versão | ok |
  | Kanban topo | 121/121 |
  | Kanban card | 72/72 |
  | PDV | 70/70 |
  | Mesas | 254/254 |
  | garçom | 47/47 |
  | Pix online | 54/54 |

## Prints

- `antes-1366.png`, `antes-390.png`: a tela de antes.
- `depois-{1366,430,390,360}.png` e `depois-modal-comanda-*.png`: a tela nova (loja demo no Assistente antigo).
- `e2e/`:
  - `beta-1366.png`, `antigo-1366.png`, `ativar-beta-1366.png`;
  - `modal-{comanda,pre_conta,via_cozinha}-1366.png`, `modal-pre-conta-balcao-1366.png`, `modal-antigo-1366.png`;
  - `modal-{360,390,430}.png`.
- `antigo/`: golden do Assistente antigo, com `*-ps1.png` (`print.ps1` real) × `*-previa.png` (tela) e `*-lado.png`.
