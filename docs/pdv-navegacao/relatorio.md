# PDV e Mesas — navegação sem telas empilhadas + telas maiores (relatório)

Data: 2026-10-01 · Branch `feat/pdv-navegacao` · Sem migration · Sem mudança de lógica de negócio
(valores, regras de fechamento, permissões, impressão e caixa intocados — só a casca das telas).

## O que mudou

### Uma tela por vez (`components/pdv/tela-pdv.tsx`)
- **`TelaPdv`**: cada janela do PDV/Mesas/Balcão virou uma *tela* da pilha. A tela da frente cobre a
  de trás por inteiro (fundo opaco); a de trás continua montada, então ao voltar ela aparece
  **exatamente como estava** (rolagem, digitação, seleção).
- **Cabeçalho único**: "← Voltar" (48 px) · caminho com o identificador
  (`Mesa 01 · Comanda 653 · Nome ›` / `Balcão · Senha 311 · Nome ›`) + título da tela · "X" (48 px).
- **Voltar** pelo botão, pela tecla **Esc** e pelo **voltar do navegador/Android/gesto**: cada tela
  empilha uma entrada no histórico (`pushState`) e o `popstate` fecha só a do topo. Fechar por
  código (ação concluída) tira a entrada sem fechar outra tela; se a página mudou (ex.: "Voltar às
  mesas"), não mexe no histórico.
- **"X" fecha a pilha inteira**; só pergunta "Descartar o que não foi salvo?" se alguma tela tem dado
  digitado (Receber com valor, Fechar com pagamento/decisão, Taxas alteradas, Motivo digitado…).
  A pergunta aparece **dentro da própria tela**, não num modal por cima.
- **Avisos depois da ação**: pagamento registrado volta à conta com
  "Pagamento de R$ 1,00 registrado"; ao concluir o fechamento, volta à tela base com
  "Conta fechada · Mesa 01 · … · R$ 6,70" (aviso no `<body>`, sobrevive à troca de rota).
- **Transição** de 150 ms (opacity + transform); desligada com "reduzir movimento".

### Telas maiores
- Desktop/tablet: ~94% da altura e até 1200 px de largura (telas de formulário curtas usam 560–900 px);
  celular: tela cheia. Conteúdo rola por dentro; **barra de ações fixa embaixo**.

### Botões e Receber
- Toque ≥ 48 px; ações principais 56–64 px (medidas em px — a raiz do painel é 87,5%, então
  `h-12` dava 42 px; corrigido).
- Todo botão das telas com **ícone + texto** (`BotaoPdv` e ícones nas sub-telas antigas).
- **Receber** refeito: restante em destaque, "Valor a receber" e "Valor recebido" grandes (26 px),
  **troco grande**, formas de pagamento em botões de 64 px com ícone e check na selecionada,
  atalhos **Valor exato / R$ 50 / R$ 100 / R$ 200**, **teclado numérico** na tela.
- **Hierarquia**: uma ação forte por vez — com saldo a receber o destaque é "Receber" e "Fechar conta"
  fica em contorno verde; sem saldo, "Fechar conta" é o botão cheio. Cancelar em vermelho, separado.

### Textos
- Saiu "Valor, troco e saldo são recalculados no servidor; a tela só antecipa".
- Erros dizem o que fazer: "Valor maior que o restante. Máximo: R$ 7,70.",
  "Valor recebido menor que o valor a receber. Confira o valor entregue pelo cliente.",
  "Sem conexão. Confira a internet e tente de novo." (antes "Sem conexão com o servidor.").

## Inventário de modais

| Onde | Janela | Virou |
|---|---|---|
| PDV v2 — conta | Conta da mesa/balcão (`ContaPresencialModal`) | Tela base da pilha, barra de ações fixa |
| PDV v2 — conta | Receber | Tela nova (teclado, atalhos, troco grande) |
| PDV v2 — conta | Fechar conta (etapas) | Tela |
| PDV v2 — conta | Taxas da conta | Tela (dentro do Fechar e a partir da conta) |
| PDV v2 — conta | Pendências / Sem pendências | Tela |
| PDV v2 — conta | Resolver pendências | Tela |
| PDV v2 — conta | Histórico | Tela |
| PDV v2 — conta | Cancelar/pedir cancelamento de pedido | Tela |
| PDV v2 — conta | Motivo (cancelar conta etc.) | Tela |
| PDV v2 — conta | Desconto e taxa de serviço | Tela |
| PDV v2 — conta | Identificar cliente | Tela (formulário) |
| PDV v2 — conta | Resumo do encerramento | Tela + aviso ao sair |
| PDV v2 — atendimento | Abrir mesa / Limpeza / Identificar | Tela (formulário) |
| Central de Balcão | Novo atendimento de balcão | Tela |
| PDV (legado e v2) | Opções do item | Tela |
| PDV legado | Receber (`PagamentoModal`) | Tela |
| PDV legado | Conta da mesa | Tela |
| PDV | "Sair do sistema?" | Tela "Sair do PDV" |
| Mesas — mesa | Item do garçom (configurador) | Tela |
| Mesas — mesa | Conferência do lançamento (celular) | Tela |
| Mesas — mesa | Pedido enviado | Tela |
| Mesas — mesa | Cardápio em somente visualização | Tela |
| Mesas — conta | Motivo / Trocar de mesa / Confirmação (juntar contas) | Tela |
| Mesas — conta | Lançamento do histórico | Tela |
| Mesas — conta | Fechar conta / Taxas / Identificar / Resumo | as mesmas telas do PDV v2 |
| `components/pdv/taxa-extra.tsx` | Taxa manual antiga | **Removido** (sem uso desde as taxas múltiplas) |
| Mesas (salão) | Nova/Editar mesa | Mantido (gaveta de cadastro, fora da operação) |
| Mesas | Configurar conta (Ajustes) | Mantido (configuração) |
| Mesas | QR das mesas | Mantido (configuração/impressão de QR) |

## Testes

- **Novo e2e** `scripts/seguranca/e2e-pdv-navegacao.mjs` — **30/30**:
  - Mesa → Conta → Receber → Voltar → Fechar → etapas → Pagamento → concluir (+ aviso)
  - Balcão → Pedido → Receber e fechar · PDV pagamento dividido (pix + dinheiro)
  - Voltar pelo botão, Esc e navegador com a conta preservada; X pergunta só com dado digitado
  - Uma tela visível por vez (ponto central = tela do topo, fundo opaco)
  - Casca em 1024×768, 1280×800, 1366×768, 1920×1080 e 390×844: Voltar/X ≥ 48 px, ações à vista,
    sem rolagem lateral
- **Regressão** (build final, tudo verde): pdv-v2 70/70 · pdv-atendimento 97/97 · balcão/entrega 84/84 ·
  estabilidade 53/53 · caixa-turnos 18/18 · caixa-e-regras 35/35 · garçom 48/48 · modelos Beta/taxa 57/57 ·
  cozinha 26/26 · regressão-release 52/52 · release-mesas 254/254 · checkpoint-e 90/90 · etapa-f 136/136 ·
  retoque visual 46/46 · checkout 72/72. Suítes de mesas na loja isolada `cantina-mesas2` (como manda
  `e2e-ambiente.mjs`; na mesma loja das do PDV dão falso positivo de "senha" na auditoria e o pop-up do
  cupom BALCAO10 cobre a vitrine).
- **Unitários**: 170 arquivos / 1822 testes passando (3 arquivos/10 testes pulados, como antes).
- **Prints** antes/depois em `docs/pdv-navegacao/prints/` (antes: 1280×800; depois: 1024×768,
  1280×800, 1366×768, 1920×1080 e 390×844).

## Problemas achados nos testes e corrigidos
- Alvos de toque com `h-12` mediam 42 px (raiz 87,5%): Voltar/X/teclado/atalhos/formas agora em px.
- O campo padrão do painel (36 px / 12,8 px, regra mais específica) encolhia os campos do Receber e das
  telas antigas: classes próprias com prioridade.
- Fechar uma tela ao mesmo tempo em que a página navega ("Juntar contas" → outra mesa) desfazia a
  navegação (o voltar do histórico chegava antes): `saindoDaPilha()` antes do `router.push`.
- "Tem certeza que quer sair?" do PDV era um modal escuro por cima: virou a tela "Sair do PDV".

## Ressalvas
- "Registrar e fechar" continua passando pela tela **Fechar conta** quando há pedido na cozinha
  (regra de fechamento existente: decidir pendências). Ao concluir, volta à tela base com o aviso.
- Os campos das telas antigas de Mesas herdaram 48 px de altura e texto de 15 px pela casca; o
  desenho interno delas (ordem dos campos) não mudou.
