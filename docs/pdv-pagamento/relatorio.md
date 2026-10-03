# PDV: forma de pagamento e troco antes de lançar + caixa que abre sozinho — relatório

Branch `feat/pdv-pagamento` · migration **0135** · prints em `docs/pdv-pagamento/prints/`.

## Parte 1: forma de pagamento e troco antes de lançar (PDV/balcão)

**Modelo de dados.** É o mesmo da vitrine, sem converter nada:

- `pedidos.forma_pagamento` (pix | cartao | dinheiro);
- `troco_para`;
- `pago`;
- o detalhe crédito/débito vai na coluna nova `pedidos.cartao_tipo`, então a vitrine e os relatórios continuam vendo
  "cartão".

Antes, todo pedido do balcão era gravado como "dinheiro", fixo no banco.

| Item | Como ficou |
|---|---|
| Bloco PAGAMENTO | No painel do pedido, acima de "Lançar na cozinha": Dinheiro, Pix, Cartão de crédito e Cartão de débito, com botões grandes e ícones. Respeita as formas que a loja aceita. Funciona no celular (dentro de "Ver pedido") e no tablet. |
| Obrigatório | Sem forma escolhida, "Lançar na cozinha" fica desabilitado com a dica "Escolha a forma de pagamento". O servidor também recusa (`forma_obrigatoria`). Se uma tela antiga ficar aberta, o aviso pede para atualizar a página. |
| Mesa | Sem essa etapa: paga no fechamento. O balcão só tem entrega e retirada (não existe "consumo no local"). |
| Dinheiro | "Precisa de troco? Não/Sim" → "Troco para quanto?" com atalhos R$ 20 · 50 · 100 · 200 (só os maiores que o total) e campo livre. Aparece em destaque "Levar de troco: R$ 37,00". |
| Troco precisa ser maior que o total | A tela avisa e bloqueia. O banco confere de novo contra o **total da conta** (com a taxa de entrega), na mesma transação do lançamento: se não passar, nada é gravado. |
| Total que muda depois | O "levar" é recalculado ao vivo. Num segundo lançamento na mesma conta, a tela pré-preenche a forma e confere de novo. A forma vale para a conta inteira: os pedidos ainda não pagos acompanham. |
| Status | Escolher a forma **não marca como pago**. As telas mostram "A receber na entrega" ou "A pagar na retirada"; a comanda impressa diz "A RECEBER". "Pago" só aparece quando o pagamento é registrado. |
| Alterar depois de lançar | No detalhe do pedido (Painel de Pedidos), "Alterar pagamento", com a opção "Reimprimir comanda". Até sair para entrega, quem atende pode alterar. Depois de sair ou de pago, só gerente ou dono; com o financeiro ligado, com o PIN de **outra** pessoa (o dono não precisa). Tudo vai para a auditoria (`pedido.pagamento_alterado`: quem, de/para, quem aprovou). As telas se atualizam pelo tempo real de sempre. |

**Onde a informação aparece**

- **Comanda impressa (modelo oficial):** ela já imprimia "Pagamento" e "Troco para" a partir desses mesmos campos. Agora
  sai a forma certa: `Pagamento: DINHEIRO` / `Troco para: R$ 100,00` / `A RECEBER`, ou `Pagamento: PIX` /
  `Pagamento: CREDITO`. **O layout não foi tocado** (CLAUDE.md §7 e a ordem de não mexer no Assistente).
  - O trecho "(levar R$ 37,00)" **não sai no papel**: incluir uma linha nova exigiria mudar o recibo e publicar um
    Assistente novo. Fica para você decidir. Na tela, na Logística e no app do motoboy o "levar" aparece em destaque.
- **Kanban:** card e detalhe com ícone, forma, "Troco p/ R$ 100,00" e status.
- **Cozinha (KDS):** ícone, forma e troco no ticket.
- **Logística:** forma com crédito/débito, "A receber" e o alerta amarelo **"Levar R$ 37,00 de troco (cliente paga com
  R$ 100,00)"**.
- **App do motoboy:** "Levar R$ X de troco", que já existia, agora com a forma certa.
- **WhatsApp:** "💳 *Pagamento na entrega:* Dinheiro (troco para R$ 100,00)" ou "…na retirada: Cartão de débito".
  - Vale só quando a loja manda a mensagem de "em preparo" para pedidos do balcão (categoria "local").
- **Financeiro:** troco e acerto conforme as regras atuais.

**Correção encontrada no caminho:** a entrega do balcão que o cliente **já pagou no caixa** também entrava no acerto do
motoboy, porque era gravada sempre como dinheiro. O mesmo dinheiro contava duas vezes. Agora fica fora do acerto.

## Parte 2: caixa que abre sozinho pelo delivery

### 2.1 Com o financeiro ligado (hoje só a Menuzia)
- A 1ª entrega **não abre mais o caixa**.
- Entrega em dinheiro não paga vira **"a acertar"**: um lançamento na carteira do motoboy, por pedido, sem turno quando
  o caixa está fechado.
- O "a acertar" de cada motoboy vale para toda entrega em dinheiro depois do último acerto dele, desde a entrada do
  financeiro na loja (no máximo 14 dias). Quando alguém abre o caixa, isso aparece no acerto (conferência às cegas atual)
  e o acerto entra no turno de **quem acertou**. O livro-caixa registra: gaveta + valor declarado, carteira do motoboy −
  esperado (baixa a pendência) e a diferença no resultado.
- Aviso no topo: "Caixa fechado · R$ X a acertar".
- Alerta ao dono quando passa de `fin_config.horas_motoboy_pendente` (padrão agora **2 h**).

### 2.2 Sem o financeiro (as outras lojas): regra escolhida
**Dia operacional de 05:00 a 05:00 (horário de São Paulo).**
- O turno automático da Logística fecha sozinho às 05:00 do dia seguinte ao que abriu. A madrugada conta no dia anterior,
  o que cobre lojas que vendem depois da meia-noite.
- A próxima entrega abre o turno do dia.
- Se ninguém entrega, o turno vencido também fecha ao abrir a Logística.
- Nada é barrado, nenhuma entrega muda e o fechamento fica na auditoria ("Automático (fim do dia)").

Por que não "horário de fechamento da loja": nem toda loja tem horário cadastrado, e há lojas que fecham depois da
meia-noite. Com o corte às 05:00 a regra é a mesma para todas e nunca parte um expediente no meio.

### 2.3 Ponto 400 Hamburgueria e outras lojas

**Levantamento (só leitura, antes de mudar).** Backup em `~/backups/menuzia/2026-10-02-caixas-automaticos/`.

Só **duas** lojas tinham caixa aberto sozinho e nunca fechado:
- **Ponto 400:** aberto em 30/09 23:01. Tinha 16 entregas (4 em dinheiro, R$ 214,99) e **nenhum acerto** feito.
- **Menuzia:** o caixa 3, aberto em 02/10 07:57, sem nenhum lançamento.

Nenhuma outra loja estava nessa situação.

**Ponto 400 (03/10, ~00:08, depois da 0135).** Script `ajustar-caixas-automaticos-0135.mjs`, primeiro em teste (faz e
desfaz), depois aplicado:
- O caixa de 30/09 fechou às **05:00 de 01/10**, o fim do dia operacional dele.
- Foram criados o turno de **01/10** (05:00 → 05:00 de 02/10), já fechado, e o de **02/10** (desde 05:00), aberto. Esse
  último fecha sozinho às 05:00 de 03/10 pela regra nova.
- Nenhuma entrega foi apagada nem alterada. O script conferiu antes e depois a quantidade e a soma dos pedidos (iguais) e
  a corrente de assinaturas (íntegra).
- Tudo ficou na auditoria, como "Sistema".
- A Logística volta a mostrar o dia certo.

**Menuzia.**
- O caixa 3 foi encerrado como "Sistema (ajuste 0135)", com contagem zero (não tinha nenhum lançamento) e a justificativa
  registrada.
- A única entrega em dinheiro dele (#141, R$ 32,00) **não** ficou "a acertar": a conta foi paga no caixa. É exatamente a
  correção da contagem em dobro.
- Os 2 alertas de teste (divergência de R$ 30 e caixa aberto sozinho) ficaram como lidos ("Sistema (ajuste de teste
  0135)"), sem apagar nada.

**⚠️ Erro meu durante a conferência em produção.**
- Para conferir o PDV, usei a sessão do Chrome achando que era da Menuzia, mas ela estava logada como um usuário da
  **Ponto 400** ("Guilherme Silva").
- Abri por engano, nessa loja real, **uma comanda de balcão vazia, "TESTE conferência 0135"**. Ela ficou sem pedido e sem
  pagamento, e nada foi impresso nem enviado. A tentativa de lançar sem forma foi recusada (é o teste que eu queria) e não
  gravou nada.
- Cancelei a comanda na hora, em nome de "Sistema", com o motivo "Aberta por engano numa conferência técnica do suporte
  Menuzia".
- **O que ficou:**
  - o registro de abertura na auditoria da Ponto 400 aparece em nome do Guilherme Silva (imutável);
  - a numeração de senha do balcão deles pulou um número.
- A partir de agora confiro a loja da sessão antes de qualquer ação.

## Testes

| Suíte | Resultado |
|---|---|
| **e2e-pdv-pagamento** (novo) | **57/57** |
| Financeiro integrado | 52/52 |
| Financeiro Fase 1 / Fase 2 | 66/66 · 55/55 |
| PDV v2 / atendimento / janelas / navegação | 70/70 · 97/97 · 53/53 · 30/30 |
| Balcão e entrega | 84/84 |
| Impressão | 40/40 |
| Caixa turnos / regras | 18/18 · 34/34 |
| Garçom (mesas) | 47/47 |
| Cozinha | 26/26 |
| Equipe | 75/75 |
| Menu | 16/16 |
| Robô WhatsApp | 106/106 |
| Unitários | 1.930 (incluindo as regras novas e a mensagem do WhatsApp) |

O **e2e-pdv-pagamento** cobre:
- tela do PDV: sem forma bloqueia; dinheiro sem dizer se precisa de troco bloqueia; atalho de troco; troco digitado menor
  que o total bloqueia; total mudou e o troco é recalculado;
- matriz pela API: entrega e retirada × Pix, crédito, débito, dinheiro sem troco e com troco;
- recusas: sem forma, troco igual ao total, forma fora da lista;
- mesa sem a etapa;
- a forma vale para a conta inteira, e a tela pré-preenche;
- alterar: antes de sair (atendente), depois de sair (gerência + PIN de outra pessoa; o próprio PIN é recusado; o dono
  altera direto); tudo auditado;
- telas: Kanban, detalhe, cozinha, Logística (alerta de troco) e motoboy;
- **impressão virtual:** os dados reais da fila do Assistente, desenhados pelo próprio código do recibo e da comanda Beta;
- caixa com financeiro: não abre sozinho, vira "a acertar" sem turno, aviso no topo, alerta depois de 2 h, acerto no
  turno de quem acertou e carteira do motoboy zerada; balcão pago no caixa fica fora do acerto;
- caixa sem financeiro: turno vencido fecha às 05:00 com auditoria, a entrega abre o turno do dia e o acerto fica só do
  dia;
- vitrine igual;
- celular e tablet.

Nas suítes antigas, o lançamento no balcão passou a escolher **"Dinheiro, sem troco"**, que é o que o sistema gravava
antes, então as verificações delas continuam valendo. Duas verificações da suíte de balcão exigiam o **oposto** do pedido
novo ("card sem forma de pagamento") e foram atualizadas.

## Publicação
- 03/10 ~00:02: backup e **0135** aplicada (`~/backups/menuzia/2026-10-03-pre-0135`).
- main `7691d3f`; deploy no Coolify com sucesso.
- Ajuste da Ponto 400 e da Menuzia aplicado em seguida.
- **Rollback:** `docs/rollback/0135_pdv_pagamento_caixa_dia.down.sql` (testado localmente) + redeploy do commit anterior
  (`bb48c78`).

## Para você decidir
- Imprimir "(levar R$ 37,00)" na comanda exige mudar o recibo e publicar um Assistente novo.
- O corte do dia operacional às 05:00. Dá para virar configuração por loja.
