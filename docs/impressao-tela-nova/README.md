# Tela de Impressão — protótipo aprovado (2026-10-06)

A referência é `prototipo/tela-impressao-menuzia.html`, o protótipo aprovado pelo dono. O lado a lado com a tela real está em `v4/lado-a-lado-*.png`.

**Publicação:**
- `main` em 34a55ff;
- migration **0151** (`impressao_qr`) aplicada com backup em `~/backups/menuzia/2026-10-06-pre-0151`;
- instalador sem mudança: o Assistente novo continua no **0.2.0-beta.9** (publicado em 05/10, SHA-256 `ffe20127…9b6d99`). Esta entrega não mexe no Assistente.

## Estrutura (igual ao protótipo)

- **Cabeçalho:**
  - título e frase curta;
  - pílulas: Assistente conectado, Cozinha pronta, Caixa pronto (este só no novo) e "Atualização disponível" em amarelo, só quando o Assistente está abaixo do beta.9;
  - à direita, **Ver modelo da impressão**.
- **1. Escolha o assistente:**
  - dois cards, Assistente antigo (Padrão) e Assistente novo (Recomendado);
  - cada um diz o que imprime;
  - o selecionado mostra "● Em uso na sua loja", com fundo branco, borda mais escura e sombra leve;
  - trocar pede confirmação. Se o escolhido não estiver instalado e conectado, abre o **guia de instalação** e o "Ativar" fica travado até ficar pronto. Vale para o novo e para o antigo.
- **2. Instale no computador da loja:**
  - arquivo e "Baixar instalador" do assistente escolhido (0.2.0-beta.9 ou 0.1.23);
  - aviso amarelo de versão antiga, com "Como atualizar".
- **3. Impressoras e o que cada uma imprime:**
  - novo: impressoras reais, com Cozinha / Caixa / Os dois (as funções Cozinha e Recibo/Extrato), "Testar" e "Adicionar impressora" (a lista detectada no computador);
  - antigo: impressoras do Assistente antigo, com Editar, Remover e Adicionar.
- **4. Conexão e ajuste do papel**, em quatro blocos:
  - **Computador:** "Trocar computador" gera o código de conexão; no antigo, copiar ou gerar o token.
  - **Largura do papel:** 80 ou 58 mm, por impressora.
  - **Forma de envio:** Envio direto ou Pelo Windows.
  - **Calibrar:** abre o passo a passo. Tem aviso amarelo de calibração antiga (mais de 30 dias), de impressora nunca calibrada e de driver em 58 mm.
- **5. O que aparece no papel:**
  - logo, quantidade, adicionais, multiplicar adicionais e letra maior;
  - **preço dos adicionais**, só no antigo: no modelo novo o adicional sai no nome, com o valor somado;
  - **via da cozinha sem valores** e **QR Code do cardápio**, só no novo.
- **Situação geral:**
  - Assistente, Cozinha, Caixa e Última impressão, com ícone e bolinha;
  - "Atualizar";
  - "Detalhes técnicos" recolhido: versão, computadores (com Desconectar), largura em pontos, tamanho da letra por impressora, envio, modo, últimos erros, impressão automática, aceitar pedidos e, no antigo, o Assistente ativado;
  - guia e diagnóstico.
- **Passos:** concluído = número com fundo verde-claro; o primeiro pendente = contorno azul.

## Modal "Ver modelo da impressão"

- Janela vertical no centro, com 440 px de largura e quase a altura da tela. No celular, ocupa a tela toda.
- Abre na **largura** da janela; "Inteira" cabe tudo, "Largura" volta, − e + mudam o zoom em 10%. **100% = tamanho real** do papel da loja: 80 ou 58 mm, com 72 ou 48 mm impressos.
- **Abas:** Comanda / Pré-conta / Via da cozinha (no antigo, só Comanda), mais Entrega / Retirada / Mesa / Balcão.
- **A imagem é a do renderizador da impressora:**
  - novo: `v3.js` + `ticket-canvas.js`;
  - antigo: `recibo.js` + a porta do `print.ps1`.
- Fecha com ✕, Esc e clique fora, e o foco volta ao botão. Usa a `JanelaCrua` de `components/ui/flutuante.tsx`, na camada máxima.

## Como cada loja ficou (o deploy não muda modo)

| Loja | Modo | Opção na tela |
|---|---|---|
| menuzia | cozinha_caixa | Assistente novo (beta.9 instalado em 06/10) |
| villa-lanches | cozinha_caixa | Assistente novo (beta.7, com "Atualização disponível") |
| pizza-do-rosa | caixa | Assistente novo, com o aviso "Passar a comanda" |
| ponto-400-hamburgueria | teste | Assistente antigo (a cozinha sai hoje pelo antigo) |
| estancia-burger | teste | Assistente antigo |
| as outras 5 | teste | Assistente antigo |

## Decisões

- **QR Code do cardápio** virou opção real: migration 0151, ligada por padrão, então o papel não muda para ninguém. Desligada, o servidor não manda o QR (vale para qualquer versão do Beta).
- **Preço dos adicionais** aparece só no antigo, porque não muda o modelo novo.
- **Tamanho da letra** de cada impressora foi para "Detalhes técnicos". O protótipo não tem esse ajuste.
- Voltar para o **antigo** também exige o Assistente antigo conectado: se não estiver, abre o guia (baixar e colar o token), para a loja não ficar sem impressão.
- Ajustes de cor para passar no contraste:
  - texto cinza-claro #6B7A86 → #5F6E7A (de 4,4 para 5,1:1);
  - texto do selo "Recomendado" #0B8457 → #087049 (de 4,2 para 5,4:1);
  - chave desligada #C5CDD4 → #8A97A2.

## Testes

- **`scripts/impressao/e2e-tela-impressao.mjs`: 44/44**
  - antigo ↔ novo;
  - guia de instalação;
  - confirmação auditada;
  - pílulas e avisos;
  - estado dos passos;
  - Cozinha / Caixa / Os dois gravando nas funções;
  - "Testar";
  - "Adicionar";
  - modelo = renderizador real (comanda, pré-conta e via da cozinha, 0 pontos diferentes);
  - zoom ("Inteira" cabe, "+", 100% = 80 mm);
  - abas, Tab, Esc com foco de volta e clique fora;
  - QR desligado deixa o modelo mais curto;
  - via da cozinha;
  - peso ≤ 600 e contraste ≥ 4,5:1;
  - modelo do antigo;
  - celular 360/390/430 (sem rolagem lateral, janela na tela toda).
- **Regressão:**

  | Suíte | Resultado |
  |---|---|
  | modelos | 56/56 |
  | impressão v2 (Beta e antigo) | 41/41 |
  | Assistente Beta | 48/48 |
  | aviso | 34/34 |
  | aviso por versão | ok |
  | Kanban topo | 121/121 |
  | Kanban card | 72/72 |
  | PDV | 70/70 |
  | Mesas | 254/254 |
  | garçom | 47/47 |
  | Pix online | 54/54 |
  | Downloads | 4/4 |
  | golden do antigo | 14/14 |
  | vitest | 2095 |

## Prints

- `prototipo/`: protótipo em 1366 e 390, com e sem o modal.
- `v4/beta-*.png`, `v4/antigo-*.png`, `v4/modal-*.png`: a tela real.
- `v4/lado-a-lado-{1366,390}.png` e `v4/lado-a-lado-modal-{1366,390}.png`: protótipo × tela real.
- `v4/e2e/`: prints do e2e (guia de instalação, novo, antigo, modais no celular).
