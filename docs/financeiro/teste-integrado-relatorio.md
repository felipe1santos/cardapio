# Financeiro — teste de ponta a ponta integrado ao sistema

Data: 2026-10-02 · Suíte `scripts/seguranca/e2e-financeiro-integrado.mjs`. Roda na loja descartável `fin-int`, criada pela
semente completa `semear-demo-mesas`.

O teste usa só caminhos reais: as mesmas rotas e o mesmo acesso (RLS) das telas do PDV, da mesa do garçom, da vitrine e
da Logística. Nenhum pagamento é inserido direto no banco.

## Um dia de loja simulado (52 verificações, todas ok, em várias rodadas seguidas)

| # | Situação | O que foi conferido |
|---|---|---|
| 1 | Caixa fechado | O PDV não recebe e mostra "Abra o caixa (Financeiro › Caixa)". A mesa do garçom também não recebe. Nada é gravado em pagamentos. A cozinha recebe os pedidos normalmente. |
| 2 | Abrir o caixa pela tela | Operador de caixa abre com fundo de R$ 150 e o nome dele fica registrado. |
| 3 | Balcão em dinheiro com troco | Conta de R$ 75 com nota de R$ 100. A gaveta recebe +R$ 75 (não os R$ 100) e o troco de R$ 25 fica registrado. Cozinha prepara e serve, e a conta fecha. |
| 4 | Balcão dividido | Pix e crédito. Clique duplo no Pix gera um pagamento e um lançamento. O operador não consegue estornar; o gerente estorna o Pix e entra um lançamento negativo no mesmo caixa. O cliente paga a diferença no débito e a conta fecha. |
| 4b | "Fechar e receber" de uma vez | Dinheiro com troco + Pix na mesma operação geram 2 lançamentos e a conta fechada. |
| 5 | Mesa | O garçom abre a mesa, lança, a cozinha serve e o garçom recebe em dinheiro. Entra na gaveta em nome do "Garçom Demo" e a mesa fecha. |
| 6 | Delivery em dinheiro | Pedido pela vitrine. A Logística despacha ao motoboy e marca entregue, como a tela faz. O acerto cobra do motoboy o total do pedido e o valor entra na gaveta. |
| 7 | Cancelamento | O garçom pede, o gerente aprova, o pedido fica cancelado e nenhum dinheiro se mexe. |
| 8 | Sangria e conferência | **A gaveta esperada é igual a fundo + dinheiro recebido + acerto − sangria**, calculado de forma independente a partir dos pagamentos de verdade. Cartão é igual a crédito + débito. Pix a conferir é igual ao Pix não estornado. |
| 9 | Fechamento cego pela tela | O operador não vê o esperado, conta certo e o caixa fecha sem diferença. |
| 10 | Depois de fechado | O balcão ainda abre conta e lança (a cozinha não para), mas não recebe. "Fechar e receber" com o caixa fechado **desfaz tudo**: nada pago e a conta segue aberta. A vitrine continua recebendo pedidos. Delivery entregue com o caixa fechado abre o caixa sozinho, o dono é avisado e o dinheiro do motoboy entra no acerto. Acerto sem caixa aberto é recusado. |
| 11 | Relatório e isolamento | O relatório bate com os pagamentos, por forma. O dono da loja vizinha não lê o relatório e não acessa o financeiro. A auditoria registra abrir, contar e fechar. |
| 12 | Concorrência | 8 transações simultâneas, cada uma com 2 eventos e 1 lançamento, e a corrente de assinaturas continua íntegra. |

## Defeitos encontrados e corrigidos (migration 0134)

1. **Falso alarme de adulteração na auditoria (defeito real).**
   - **O defeito:** a corrente de assinaturas da auditoria era ordenada pelo horário `now()`, que é o horário do *início*
     da transação. Dois eventos gravados na mesma transação, ou duas transações simultâneas, ficavam "fora de ordem" e
     o "Verificar integridade" acusava adulteração que não houve. O livro-caixa tinha o mesmo risco com transações
     simultâneas.
   - **A correção:** cada registro ganha uma sequência tirada *depois* da trava da loja, que é a ordem real de gravação.
     A verificação percorre a corrente nessa ordem. Os registros que já existiam são re-selados uma vez, na migration.
   - **Em produção:** as 9 lojas estavam íntegras antes da correção (pouca concorrência até então), mas uma loja
     movimentada cairia nisso.
2. **Caixa aberto sozinho sem aviso.**
   - **O defeito:** a regra antiga (0115) abre o caixa na 1ª entrega do delivery. Isso continua, senão o dinheiro do
     motoboy ficaria fora de qualquer caixa. Mas com o financeiro ligado era um caixa sem responsável e sem fundo de troco.
   - **A correção:** agora o dono recebe o alerta "caixa aberto automaticamente".

## Regressão depois da 0134

| Suíte | Resultado |
|---|---|
| Financeiro Fase 1 | 66/66 |
| Financeiro Fase 2 | 55/55 |
| Financeiro integrado | 52/52 |
| Caixa: turnos / regras | 18/18 · 34/34 |
| PDV v2 | 70/70 |
| Balcão e entrega | 84/84 |
| Garçom | 47/47 |
| Impressão | 40/40 |
| Cozinha | 26/26 |
| Equipe | 75/75 · 27/27 |
| Menu | 16/16 |
| Robô WhatsApp | 106/106 |
| Campanhas | 71/71 |

Depois de todas as suítes, nenhuma das 28 lojas locais tem a corrente quebrada.

Rollback da 0134 e reaplicação: ok.

## O que fica para a Fase 3 (Motoboy)

- Registrar a forma e o troco no ato da entrega.
- Pix confirmado só depois de conferido.
- Acerto do motoboy por pedido, em vez de por janela de caixa.
- Área do motoboy com login.
