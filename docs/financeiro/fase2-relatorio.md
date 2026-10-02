# Financeiro — Fase 2 (Caixa): relatório

Data: 2026-10-02 · Branch `feat/financeiro-fase2` · Migration **0133**.

## O que entrou

Tudo atrás da flag `financeiro_ativo` (hoje só na Menuzia). Sem a flag, as lojas funcionam exatamente como antes. A
única mudança que vale para todas é o turno fechado ficar imutável no banco, e nenhuma tela antiga altera um turno
fechado.

| Item | Como ficou |
|---|---|
| Um caixa por loja | Evolui o `caixa_turnos` que já existia, sem criar um segundo sistema. "Aberto por", "fechado por" e o aparelho vêm da sessão. |
| Abrir com fundo de troco | Financeiro › Caixa › **Abrir caixa**. O fundo vira lançamento no livro-caixa (gaveta). Só um caixa aberto por vez. |
| Sem caixa não recebe | Com a flag ligada, o banco recusa qualquer pagamento de PDV, balcão ou mesa sem caixa aberto (`caixa_fechado`). A tela mostra "Abra o caixa (Financeiro › Caixa) para receber". |
| Recebimento no livro-caixa | Cada pagamento presencial vira lançamento **na mesma transação**, por gatilho no banco: dinheiro vai para a gaveta, Pix para "a conferir", crédito e débito para cartão. O estorno vira lançamento negativo apontando o original. Nenhuma RPC de dinheiro do PDV ou das Mesas foi reescrita. |
| Movimentações | Sangria, reforço, despesa, retirada e perda/quebra exigem motivo e permissão própria. Saída acima do limite (R$ 100) exige o **PIN de outra pessoa** (gerente ou dono, nunca o próprio). Clique duplo não duplica. O lançamento grava quem fez e quem aprovou. |
| Fechamento cego | Quem só opera o caixa **não vê o esperado**: conta o dinheiro e soma as maquininhas, e só depois o sistema diz se bateu. Toda contagem fica na auditoria, então recontar até "bater" aparece. |
| Divergência | Acima de R$ 5 exige justificativa **e** o PIN de um gerente (o dono não precisa de aprovação). Gera alerta grave ao dono por WhatsApp e lança um ajuste no livro, para a gaveta bater com o contado. |
| Pendências | Antes de fechar aparecem os motoboys sem acerto e as contas abertas. "Fechar mesmo assim" grava as pendências no turno e avisa o dono (R11). |
| Caixa fechado imutável | Nem o service_role altera ou apaga um turno fechado. Nada se lança nele. |
| Reabrir | Só o dono, com motivo de no mínimo 10 letras, e só o último caixa. O fechamento anterior fica guardado e aparece no relatório. Gera alerta grave. |
| Sair com caixa aberto | Quem abriu o caixa e vai sair precisa fechar ou justificar. A saída justificada vai para a auditoria e alerta o dono. |
| Aviso no topo | "Caixa aberto · Fulano · há 3 h" ou "Caixa fechado", para quem mexe no caixa. Caixa aberto há mais de 14 h gera alerta. |
| Relatório de fechamento | Tela própria em /admin/financeiro/caixa/[id], com botão de imprimir ou salvar PDF pelo navegador. **O recibo térmico e o Assistente não foram tocados.** |
| Logística | Com a flag, a gaveta "Fechamento de caixa" leva para Financeiro › Caixa (abrir e fechar). O acerto do motoboy continua lá e também entra no livro-caixa (gaveta). |

Ficou para a Fase 3 (Motoboy), como no plano:
- registrar a forma e o troco na entrega do delivery;
- área do motoboy com login;
- conferir Pix.

## Testes

- Unitários: **1.919** ok. Inclui os 10 novos das regras do caixa.
- `tsc` e `eslint` limpos; `next build` ok.
- **E2E `e2e-financeiro-fase2.mjs`: 55/55**, com navegador real em desktop e celular.
- **E2E da Fase 1: 66/66**, depois das mudanças.
- As duas suítes do financeiro passaram a usar lojas próprias (`fin-e2e-a/b`, `scripts/seguranca/fin-e2e-semente.mjs`). O
  livro-caixa é imutável e não pode prender os turnos das outras suítes.

### Tentativas de fraude (todas precisam FALHAR)

| # | Tentativa | Resultado |
|---|---|---|
| 1 | Receber pagamento sem caixa aberto | recusado pelo banco (`caixa_fechado`) |
| 2 | Abrir um segundo caixa | 409 |
| 3 | Abrir pela rota antiga da Logística | 409 (`usar_financeiro`) |
| 4 | Operador ver o esperado antes de contar | API não entrega (nem saldo, nem recebimentos) |
| 5 | Atendente sem permissão fazer sangria | 403 |
| 6 | Sangria sem motivo | 400 |
| 7 | Sangria acima do limite sem aprovação | 409 (`aprovacao_necessaria`) |
| 8 | Aprovar a própria sangria com o próprio PIN | 403 |
| 9 | PIN errado do aprovador | 403 |
| 10 | Clique duplo na sangria | um só lançamento |
| 11 | Fechar com diferença sem justificar ou sem o gerente | 409; exige justificativa + PIN |
| 12 | service_role mudar o contado de um caixa fechado | recusado (`turno_imutavel`) |
| 13 | service_role apagar um caixa fechado | recusado |
| 14 | Lançar no livro-caixa de um caixa fechado | recusado (`caixa_fechado`) |
| 15 | Receber com o caixa fechado | recusado |
| 16 | "Reabrir" pelo banco sem motivo | recusado (`turno_imutavel`) |
| 17 | Gerente reabrir um caixa | 403 |
| 18 | Dono reabrir sem motivo | 400 |
| 19 | Quem abriu sair com o caixa aberto sem justificar | 409 (`caixa_aberto`) |
| 20 | Ver o relatório de caixa de outra loja | 404 |

### Regressão (build da Fase 2, banco com 0132 + 0133)

| Suíte | Resultado |
|---|---|
| Financeiro Fase 1 | 66/66 |
| Caixa: turnos (rota antiga) / regras | 18/18 · 34/34 |
| PDV v2 | 70/70 |
| Balcão e entrega | 84/84 |
| Garçom (mesas) | 47/47 |
| Impressão v2 | 40/40 |
| Cozinha | 26/26 |
| Robô WhatsApp | 106/106 |
| Campanhas | 71/71 |
| Equipe repaginada / acessos / menu | 75/75 · 27/27 · 16/16 |
| Vitrine (checkout em larguras, pedido idempotente, ordem/QR) | não rodaram: a loja de teste `ordem-qr-e2e` perdeu a semente porque o Storage local recusa upload (`42P10`, versão do container). A Fase 2 não altera nenhum arquivo da vitrine. Na Fase 1, com a semente boa, o checkout passou 72/72. |

A `caixa-turnos` revelou um caso real, já corrigido: inserir um turno que já nasce fechado (dado importado) violava a
regra de status. O gatilho agora acompanha o status.

Rollback da 0133 e reaplicação: ok. Depois disso o e2e da Fase 2 passou de novo, 55/55.

## Prints

`docs/financeiro/prints-fase2/`:
- `01-abrir-caixa`
- `02-despesa-aprovacao-pin`
- `03-movimentacoes`
- `04-contagem-cega`
- `06-divergencia`
- `07-fechado`
- `08-relatorio`
- `09-caixa-celular`

## Para publicar (precisa da sua autorização)

1. Backup e aplicação da **0133**. Rollback em `docs/rollback/0133_financeiro_caixa.down.sql`.
2. Merge na main e Redeploy.
3. Na Menuzia, a partir daí, **é preciso abrir o caixa para receber no PDV, no balcão e nas mesas**: Financeiro › Caixa ›
   Abrir caixa. Os pedidos online e o delivery continuam entrando normalmente.
4. Operador de caixa com permissões personalizadas: na Equipe, marque a área "Financeiro" e "Abrir caixa", "Fechar
   caixa" e "Receber pagamento". Quem não tem permissões personalizadas (o padrão do papel) já funciona.
