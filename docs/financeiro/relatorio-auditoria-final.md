# Financeiro — auditoria final de ponta a ponta (09/10/2026)

**Veredito:** SIM, pronto para o piloto em UMA loja. Todo o fluxo de dinheiro foi testado em produção
na Menuzia e conciliado centavo a centavo com o livro-caixa (0 diferença em todas as rodadas). Os 6 bugs
achados hoje (2 deles graves: trava da gaveta furada por concorrência e venda manual duplicando
faturamento) estão corrigidos e publicados. Antes de ligar, faltam só as 4 condições abaixo.

Testes feitos em produção, só na Menuzia (outras lojas: somente leitura). Nenhuma impressão disparada
(impressão automática da Menuzia desligada durante os testes e religada no fim), nenhum Pix real pago,
nenhum UPDATE/DELETE no livro-caixa ou na auditoria. Scripts e resultados brutos em `.medidas/fin/`
(fora do repositório): `conciliar.mjs`, `14…26-*.mjs`, `r14…r26.txt`, `matriz.md`.

## Resumo por área

| Área | Cenários | ✅ | 🐞 achados | 🔧 corrigidos e publicados | ⏭️ pulados (motivo) |
|---|---|---|---|---|---|
| Fase 1 (CMV %, piloto, retirada/compra) | 3 | 3 | 1 | 1 (B1) | — |
| 1. Caixa / turno | 9 | 9 | 0 | — | — |
| 2. Movimentações | 5 | 5 | 1 | 1 (B2) | — |
| 3. Acerto de motoboys | 6 | 4 | 0 | — | 3.1 entregue pago (regra 6: entrega de teste termina "Não entregue"; coberto pelo e2e da Fase 3 99/99); 3.4 entregue automático (sem relógio simulado; item 61 testado em 08/10) |
| 4. Pix | 4 | 4 | 0 | — | 4.3 sem reexecução (e2e local de 07/10: 54/54; exige stack local inteira) |
| 5. Integração PDV/mesa/Kanban/delivery | 7 | 7 | 1 | 1 (B5) | — |
| 6. Precificação / CMV | 4 | 4 | (B1) | (B1) | — |
| 7. Contas e compras | 4 | 4 | 0 | — | 7.4 sem reexecução (e2e atômico de 04/10) |
| 8. Fluxo, DRE, Dashboard | 4 | 4 | 0 | — | — |
| 9. Alertas, risco, auditoria, integridade | 5 | 4 | 0 | — | 9.4 pgaudit só registra ddl/role: a 0141 continua pendente com o Felipe |
| 10. Permissões e PIN | 6 | 6 | 1 | 1 (B3, janela de PIN) | 10.5 "expirar" (esperar 10 min) |
| 11. Sincronização | 5 | 5 | 1 | 1 (B4) | — |
| 12. Carga leve | 1 | 1 | 0 | — | — |
| 13. Lojas sem financeiro | 2 | 2 | 0 | — | — |
| 14. Telas | 2 | 2 | 0 | — | — |

## Bugs (todos corrigidos e publicados)

| # | O que era | Impacto | Correção | Commit |
|---|---|---|---|---|
| B0 | (manhã) Estorno e cancelamento depois da cozinha sem aprovação; saída maior que a gaveta aceita | fraude: gerente estornava sozinho; gaveta negativa | PIN de outra pessoa + alerta + auditoria; trava "Só há R$ X na gaveta" | 6ca6f63, 3abf6ec |
| B1 | % do CMV dividida pelo faturamento inteiro | CMV parecia 4% quando era 33%: dono acharia a margem ótima | regra única `cmv-pct.ts` (dashboard, DRE, CMV) + aviso "X% sem custo" / "Cadastre o custo…" | 441302e |
| B2 | Duas saídas da gaveta ao mesmo tempo passavam juntas pela trava | gaveta −R$ 41,99 em produção (2 sangrias de R$ 125,99 com R$ 209,99) | fila por loja (`fila-gaveta.ts`) em sangria, retirada, despesa, perda, conta e compra pagas com o caixa | e70ce93 |
| B3 | Janela de PIN fechava e reabria a cada PIN errado | perdia o aprovador escolhido; o erro não aparecia | janela fica aberta entre as tentativas | b452435 |
| B4 | Caixa e Dashboard não se atualizavam sozinhos | venda/sangria de outro aparelho só aparecia ao recarregar → decisão em cima de saldo velho | atualização automática (Caixa 15 s, Dashboard 30 s, ao voltar à aba; pausa com janela aberta) — medido: 9,4 s | d26bbb9 |
| B5 | Venda manual citando pedido do sistema só era barrada na categoria "Venda avulsa" | lançar "pedido #247" em "Outras receitas"/"Repasse" duplicava o faturamento | barrada em qualquer conta a receber (liberar: justificativa + PIN) | c8922dd |

Falsos alarmes investigados e descartados: "contagem cega vaza saldo" (a API manda `saldos: null` ao cargo
Caixa — o teste confundiu null com presente); "CSV não bate" (o comparador casava linhas pelo minuto de
abertura; pela ordem: 102/102 campos iguais); "fila não segurou na rodada 1" (os 3 valores cabiam na gaveta).

## Conciliação (conciliar.mjs) e cadeia de hash

| Momento | Checagens | Diferenças | Cadeia |
|---|---|---|---|
| Antes de começar (16:58Z) | 46 | 0 | íntegra |
| Depois da carga (30 vendas + 10 movimentos) | 101 | 0 | íntegra |
| Depois da limpeza (1ª rodada), 09/10 | 103 | 0 | íntegra |
| Semana inteira 01/10 → 09/10 | todas | 0 | íntegra |
| FINAL, depois da 2ª rodada e da limpeza | 121 | 0 | íntegra (âncora diária conferida: 07:00Z de hoje) |

**Segunda rodada (Fase 5)**: os blocos que tinham rodado antes das correções (caixa/movimentações,
integração, sincronização) rodaram de novo sobre o código final publicado. Única mudança em relação à 1ª
rodada: exatamente os itens corrigidos (2.3 agora deixa passar só uma das duas sangrias; 11.1 atualiza
sozinho). Nenhuma regressão.

## Tempo de sincronização entre aparelhos

Venda recebida no aparelho B → saldo novo na tela do Caixa do aparelho A sem recarregar: **9,4 s e 6,0 s**
nas duas medições (o Caixa consulta a cada 15 s; o Dashboard a cada 30 s). Antes da correção B4: só
recarregando a página. Sangria no A → o B vê o saldo novo na próxima consulta e é travado
se tentar passar do que sobrou. Caixa fechado no A → o B recebe "caixa fechado" ao tentar lançar.

## Decisões para o Felipe revisar

1. Dono estorna/cancela sem PIN (decidido por você hoje); fica na auditoria e no risco.
2. Acerto de motoboy com diferença não pede PIN: a diferença não some, fica como saldo do motoboy e gera alerta; só o dono dá baixa.
3. No fechamento, qualquer diferença (mesmo dentro da tolerância de R$ 2) pede justificativa; PIN e alerta grave só acima de R$ 5.
4. DRE: a coluna "% do fat." continua sobre o faturamento inteiro; a % do CMV (sobre vendas com custo) aparece numa nota abaixo da tabela. "X% sem custo" é medido em valor vendido.
5. Venda manual que cita pedido do sistema agora bloqueia em qualquer conta a receber (antes só "Venda avulsa").
6. Fila da gaveta é em memória: vale porque o app roda numa instância só no Coolify. Se um dia rodar em várias, levar a conferência para dentro da transação do banco (migration).
7. Taxa extra e desconto da CONTA aparecem em "outros" na conciliação do DRE (os do pedido/entrega entram em Taxas/Descontos). O total bate; é só a classificação.
8. Fluxo de Caixa agrupa o turno pelo dia de ABERTURA; DRE e Dashboard pelo dia de cada lançamento. Caixa que vira a meia-noite: as vendas depois da meia-noite aparecem no dia seguinte no DRE e no turno do dia anterior no Fluxo.
9. Insumos de teste foram desativados (o produto não exclui insumo: o histórico de compras aponta para ele).

## As 4 condições do piloto (por inteiro)

1. **A loja precisa de pelo menos um gerente com PIN, além do dono.** Sem isso, ninguém além do dono consegue estornar, cancelar o que já foi para a cozinha, fazer sangria/despesa/retirada acima do limite ou fechar o caixa com diferença ou com pendências. Na Ponto 400 hoje só existe o dono (sem PIN).
2. **Começar com a casa limpa:** nenhuma conta antiga aberta e nenhum motoboy com dinheiro a acertar. Senão todo fechamento pede justificativa e PIN (foi o que aconteceu na Menuzia com as contas de 04/10 e os R$ 12 do Jose). Na Ponto 400 há 1 conta aberta (#7, R$ 33,00, de 07/10) e um caixa automático aberto desde 08/10.
3. **CMV só funciona com custo cadastrado, e só a partir das vendas feitas depois do cadastro.** Sem custo, o Dashboard mostra "Cadastre o custo dos itens para ver o CMV"; com custo parcial, a % vale só para as vendas com custo e aparece quantos % das vendas estão sem custo. Na Ponto 400 não há nenhum custo cadastrado (lista dos 15 mais vendidos no guia do piloto).
4. **Ainda não testado pelo dono: a aprovação pelo celular.** O fluxo foi testado por API hoje (pedir, aparecer para o aprovador, quem pede não aprova, PIN errado, aprovar, recusar, valor diferente recusado, uso único), mas o checklist do piloto previa que o próprio dono fizesse o teste no celular dele, com o "Gerente Teste" e o "Gerente Aprovador (teste)" da Menuzia, antes de ligar numa loja real.

Guia completo do piloto (checklist, ligar/desligar, guia de 1 página para a equipe, o que acompanhar):
`docs/financeiro/piloto-ponto400.md`.

## O que não foi testado e por quê

- Entrega PAGA na porta (dinheiro, cartão, Pix, mista): a regra do dia manda encerrar entrega de teste como "Não entregue". Coberto pelo e2e da Fase 3 (99/99, 03/10) e pela entrega #184 (09/10 madrugada).
- "Entregue automático em 1h30": sem relógio simulado no servidor de produção; testado no item 61 (08/10).
- Pix online pago/webhook: proibido pagar Pix real e forjar webhook em produção; coberto pelo e2e local com Mercado Pago simulado (54/54, 07/10) e testes de unidade. Não reexecutado (stack local inteira com 8 GB).
- Atomicidade com falha injetada: e2e de 04/10; não reexecutado.
- Aprovação pelo celular "expirar" (esperar 10 min).
- pgaudit registrando escrita no livro: depende da 0141 (pendente com você).
- Telas "Auditoria", "Risco" e "Regras" em 1366×768 (o robô saiu do Financeiro no meio); conferidas em 390×844.

## Estado final da Menuzia (17:50Z)

- Caixa **fechado**; 0 contas/comandas abertas; 0 pedidos em andamento; 0 contas a pagar/receber em aberto; 0 motoboy com saldo (incluindo os R$ 12 do Jose, acertados).
- As 5 comandas antigas de 04/10 (#33, #37, #38, #39, #40) foram canceladas pelo dono com motivo; as contas de teste canceladas; tudo por estorno/cancelamento/lançamento contrário (nenhum UPDATE/DELETE no livro-caixa ou na auditoria).
- CMV: ficha do Xtudo sem componentes; insumos de teste ("TESTE kit Xtudo", "TESTE Conferencia F5") desativados; continua ativo só o insumo "Carne" (já existia, sem marca de teste).
- Usuários: Administrador (dono, **sem PIN**), garcom123, **Gerente Teste** (PIN 862985) e **Gerente Aprovador (teste)** mantidos; "Caixa Auditoria (teste)" (criado hoje para testar o cargo Caixa) **desativado**; motoboy "Teste Conferencia" mantido.
- Impressão automática da Menuzia **religada** (ficou desligada só durante os testes, para nada sair na impressora).
- Conciliação 121/121, cadeia íntegra.

## Publicação

Commits publicados hoje (cada um com typecheck, lint e a suíte de unidade inteira — 1.901 testes — antes do push):
6ca6f63, 3abf6ec, b452435, 441302e, e70ce93, d26bbb9, c8922dd. Depois de cada deploy, o Assistente que estava
buscando pedidos (só o da Menuzia estava ligado à tarde) voltou a buscar em menos de 5 min; os cardápios
da Villa, da Ponto 400 e da Estância abriram (200) depois do último deploy. Nenhuma reversão foi necessária.
