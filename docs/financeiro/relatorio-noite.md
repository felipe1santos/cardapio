# Relatório da noite — Financeiro Fases 5, 5b e 6 (2026-10-04)

## Resumo
- **Nada foi publicado.** Não houve merge no main, deploy, Coolify ou migration em produção. O Chrome não foi aberto
  em produção e nenhuma loja real foi tocada.
- **Exceção, antes desta ordem:** no fim da sessão anterior, rodei um **ensaio (dry-run)** da 0141 em produção. Ele
  aplicou e desfez a migration, e a última aplicada continua sendo a 0140.
- **Fase 5 (CMV + Parte 0):** concluída. Branch `financeiro-fase5`. Migrations 0141 e 0142. E2E 61/61 e integridade
  7/7.
- **Fase 5b (contas, compras, DRE):** concluída. Branch `financeiro-fase5b`. Migration 0143. E2E 80/80.
- **Fase 6 (dashboard, alertas, PIN, risco):** implementada, com E2E 89/89. Branch `financeiro-fase6`. Migration 0144.
  - **A regressão do portão ficou INCOMPLETA.** O Claude Code encerrou o servidor local e a regressão por falta de
    memória na máquina, depois de 4 suítes (todas verdes). Pela regra, não reiniciei sozinho.
  - **Antes de publicar a Fase 6, falta rodar a regressão completa.**
- **Regressão completa** (todas as fases do financeiro, PDV, mesas, delivery, logística, impressão, robô, campanhas,
  cozinha, vitrine, kanban e vitest):
  - verde nos portões da 5 e da 5b;
  - incompleta na 6. Detalhe abaixo.
- **Única falha conhecida:** uma verificação da suíte antiga `release-mesas`, anterior à noite (ver Riscos).
- **Todas as migrations têm rollback**, testado no banco local: aplicar, desfazer e aplicar de novo.
- **Decisões provisórias para você confirmar:** estão na lista separada. As principais são as regras de PIN no
  fechamento, a regra de venda manual duplicada e os limites.
- **Publicação:** sugiro a ordem 5 → 5b → 6, cada fase separada, com o checklist do fim deste relatório.

---

## Fase 5 — Precificação / CMV (+ Parte 0)
**Status:** concluída.
- Branch `financeiro-fase5`: `07a40e5` (feature) e `d4a31c8` (prints).
- `feat/financeiro-cmv` aponta para o mesmo `07a40e5`.

**O que foi feito, regras, fórmulas, migrations e arquivos:** ver [fase5-relatorio.md](fase5-relatorio.md) e
[fase5-cmv.md](fase5-cmv.md).

**Parte 0:**
- Itens (a) âncora externa e (d) pgaudit: só no código e no banco local.
- Item (b): passo a passo da senha para você executar.
- Itens (c) e (e): explicados, **não aplicados**.

**Migrations:**
- 0141 (âncora + pgaudit);
- 0142 (CMV).

Os rollbacks ficam em `docs/rollback/`.

**Testes:**
- `e2e-financeiro-cmv`: 61/61;
- `e2e-integridade`: 7/7;
- regressão: ver a tabela abaixo.

**Antifraude (12 tentativas, todas barradas):**

| Tentativa | Resultado |
|---|---|
| garçom, caixa ou motoboy lendo custos pela API | 403 |
| aplicar preço sem a permissão própria | 403 |
| aplicar com preço antigo ou manipulado | 409 |
| preço novo inválido (0) | 400 |
| editar insumo sem permissão | 403 |
| mexer no histórico de custos, até com o acesso do servidor | recusado |
| insumo de outra loja | 404 |
| loja ou custo enviados no corpo | ignorados |
| sem sessão | 401 |
| DELETE em insumo | 405 |

**Prints:** `docs/financeiro/fase5-prints/` (lista e ficha, desktop e celular, e o aviso na Equipe).

---

## Fase 5b — Contas a pagar/receber, compras e DRE
**Status:** concluída.
- Branch `financeiro-fase5b`, a partir da `financeiro-fase5`, commit `b02befd`.
- Regras: [fase5b-contas.md](fase5b-contas.md).
- O item "1.6.1" citado no pedido não existe com esse número no `plano.md`. Segui a §4.5 e a linha 5b da §6.

**O que foi feito:**
- **Duas carteiras:**
  - **CAIXA** (gaveta do turno): exige caixa aberto e vira movimentação do turno.
  - **EMPRESA** (conta, cartão, boleto).
  - A contrapartida vai para `resultado`, por categoria.
- **Contas a pagar:**
  - fornecedor reutilizável e plano de contas editável (9 saídas padrão);
  - recorrência mensal ou semanal, gerada adiante e sem duplicar;
  - anexo em bucket **privado**, com link assinado de 60 s;
  - alerta de vencimento;
  - status a pagar / paga / vencida (calculada) / cancelada.
- **Contas a receber:**
  - repasse iFood, aporte, venda avulsa;
  - **venda do sistema lançada à mão é bloqueada**: cita `#pedido` ou tem o mesmo valor de um pedido do dia;
  - liberar exige justificativa + PIN, fica auditado e gera alerta ao dono.
- **Compras de insumos:**
  - a nota tem itens;
  - atualiza o custo do insumo (histórico com o motivo "Compra nota N"), e o CMV dos produtos recalcula;
  - gera conta a prazo, conta já paga pela empresa ou saída do caixa;
  - a quantidade fica guardada na unidade base (estoque futuro).
- **DRE:** faturamento do livro-caixa − CMV guardado − despesas por categoria = lucro líquido.
  - Compara com o período anterior.
  - Compras de insumos ficam fora das despesas (já estão no CMV), e aporte fica fora do resultado.
- **Nada se apaga:** cancelar e estornar (com PIN), e o banco tem travas até para o service_role.
  - Aprovação acima dos limites.
  - Permissões novas: `contas_lancar` e `contas_marcar_pago`. As que já existiam: `contas_pagar` (ver) e `dre_ver`.

**Migration:** 0143, com rollback testado no banco local.

**Arquivos:**
- `lib/financeiro/contas.ts`, `contas-regras.ts` (+ teste);
- `app/api/admin/financeiro/contas/**`;
- `app/api/cron/financeiro-diario`;
- `components/financeiro/contas/*`;
- `scripts/seguranca/e2e-financeiro-contas.mjs`.

**Testes:**
- `e2e-financeiro-contas`: **80/80**;
- unitários `contas-regras`: 16/16.

Cenários cobertos:
- despesa recorrente;
- conta paga com dinheiro do caixa virando movimentação do turno;
- compra atualizando o CMV;
- repasse iFood;
- venda manual duplicada bloqueada;
- DRE batendo com o livro-caixa (faturamento e carteira resultado conferidos com SQL direto);
- telas no desktop e no celular.

**Antifraude 5b:**

| Tentativa | Resultado |
|---|---|
| venda do sistema lançada à mão (#pedido ou mesmo valor no dia) | 409 `venda_duplicada` |
| aprovar o próprio estorno | 403 |
| garçom ou caixa lendo contas e DRE | 403 |
| atendente lançando conta | 403 |
| só "ver contas": lançar ou dar baixa | 403 |
| conta de outra loja (baixar, cancelar, anexo) | 404 |
| categoria de outra loja | 404 |
| insumo de outra loja na nota | 404 |
| loja, status ou autor no corpo | ignorados |
| clique duplo (mesma chave) | uma conta só |
| sem sessão | 401 |
| DELETE | 405 |
| valor ≤ 0 | 400 |
| anexo HTML | 415 |
| item de nota alterado ou apagado, até pelo service_role | recusado |
| conta apagada, até pelo service_role | recusado |
| valor de conta paga alterado, até pelo service_role | recusado |

**Prints:** `docs/financeiro/fase5b-prints/` (lista, nova conta, pagar, compras, DRE, cadastros, celular).

---

## Fase 6 — Dashboard + alertas + PIN + risco
**Status:** implementada e testada. **Regressão incompleta** (ver abaixo).
- Branch `financeiro-fase6`, a partir da `financeiro-fase5b`.
- Regras: [fase6-dashboard-alertas.md](fase6-dashboard-alertas.md).
- Os itens "1.7, 9 e 10" citados no pedido não existem com esses números no plano. Segui a linha 6 da §6, a §5
  (limites) e a §9 (decisões).

**O que foi feito:**
- **Dashboard do livro-caixa:**
  - faturamento bruto, CMV, lucro bruto e líquido;
  - vendas por origem e por forma;
  - pagos × não pagos × a conferir;
  - ticket médio;
  - mais vendido, mais lucrativo, pior margem;
  - despesas, sangrias, divergências, dinheiro com motoboy;
  - evolução diária, semanal e mensal.
- **Gráfico único** (`components/financeiro/ui/grafico.tsx`):
  - cores exatas do Gerenciador de Eventos da Meta, tooltip, hover e legenda como pedido;
  - medidor do CMV;
  - o teste confere as cores no SVG.
- **Alertas:**
  - **imediatos:** divergência, reaberto, valor manipulado, login simultâneo, venda manual suspeita, Pix a conferir e
    comanda que passou de turno;
  - **por varredura** (cron `financeiro-vigia`, a cada 15 min): caixa esquecido, caixa sem abrir no horário, motoboy
    com dinheiro há X h, desconto alto, sangria alta, cancelamento depois de pago, ações sensíveis demais;
  - sem repetição (dedupe).
- **Abertura rápida do caixa** logo após o login, para quem pode abrir.
- **Aprovação pelo celular:**
  - pedir → aprovar ou recusar com o PIN do aprovador;
  - uso único, mesma ação, mesmo valor, 10 min;
  - preparada para push (ponto de troca `avisarAprovadores`).
  - Ligada em: sangria/despesa/retirada/perda, fechamento do caixa, contas, compras, venda avulsa e troca de pagamento
    do pedido.
- **Regras de PIN no fechamento** (provisórias, configuráveis por loja na tela Regras e limites; só o dono altera).
- **Risco por funcionário:**
  - cancelamentos, descontos, estornos, reimpressões, divergências e ajustes;
  - destaca quem passa de 3 ocorrências e de 2× a mediana da equipe;
  - só dono e gerente.

**Migration:** 0144, com rollback testado no banco local.

**Arquivos:**
- `lib/financeiro/{dashboard, vigia, vigia-regras, risco, risco-regras, fechamento-regras, aprovacao-remota, manipulacao}.ts`
  (+ testes);
- `lib/financeiro/caixa.ts` (fechamento e aprovação);
- `app/api/admin/financeiro/{dashboard, risco, aprovacoes-remotas, config}`;
- `app/api/cron/financeiro-vigia`;
- `components/financeiro/{ui/grafico, dashboard/secao-dashboard, risco/secao-risco, regras, faixa-aprovacoes, abertura-rapida}.tsx`;
- `components/financeiro/{apoio, caixa}.tsx`;
- `app/admin/layout.tsx` (faixa + abertura rápida);
- `app/(auth)/login/actions.ts` (cookie de 1 min "recém-entrou");
- `app/api/loja/[slug]/pedido/route.ts` (valor manipulado);
- `scripts/seguranca/e2e-financeiro-fase6.mjs`.

**Testes:**
- `e2e-financeiro-fase6`: **89/89**;
- unitários de fechamento, risco e vigia: 9 + 4 + 4.

Cenários cobertos:
- cada card do dashboard conferido contra o livro-caixa com SQL direto;
- cada alerta disparando;
- cada regra de PIN;
- aprovação pelo celular, com a tela do caixa e o celular do gerente;
- ninguém aprova a própria ação;
- relatório de risco;
- permissões e antifraude.

**Antifraude 6:**

| Tentativa | Resultado |
|---|---|
| quem pediu lista ou decide aprovações | 403 |
| PIN errado do aprovador | 403 |
| aprovação remota usada duas vezes | 409 `usada` |
| aprovada para R$ 120 usada em R$ 160 | 409 `outro_valor` |
| aprovada para sangria usada em despesa | 409 `outra_acao` |
| outra pessoa usando a aprovação | 404 |
| aprovar o próprio pedido | 403 |
| pedido recusado | 409 `nao_aprovado` |
| pedido expirado | 409 `expirado` |
| pedido de outra loja | 404 |
| apagar pedido de aprovação, até pelo service_role | recusado |
| preço R$ 0,01 enviado no corpo do pedido | sai com o preço do cardápio + alerta grave |
| caixa ou garçom abrindo o dashboard | 403 |
| caixa ou garçom abrindo o risco | 403 |
| "ver auditoria" sem ser dono/gerente, no risco | 403 |
| gerente mudando as regras | 403 |
| regra fora da faixa | 400 |
| cron sem segredo | 401 |

**Prints:** `docs/financeiro/fase6-prints/`:
- dashboard (desktop e celular);
- aprovação (pedido no desktop, faixa e PIN no celular);
- risco (desktop e celular);
- abertura rápida;
- regras.

---

## Regressão por portão
| Suíte | Portão 5 | Portão 5b | Portão 6 |
|---|---|---|---|
| financeiro-fase6 | — | — | 89/89 |
| financeiro-contas (5b) | — | 80/80 | 80/80 |
| financeiro-cmv (5) | 61/61 | 61/61 | 61/61 |
| integridade (5) | 7/7 | 7/7 | 7/7 |
| financeiro-fluxo (4) | 86/86 | 86/86 | **não rodou** |
| financeiro-fase1 / 2 / 3 | 66 / 55 / 106 ok | 66 / 55 / 106 ok | fase1: 16/17 **inconclusivo** (rodou enquanto o servidor era encerrado; um clique deu timeout — pode ser servidor fora ou a abertura rápida cobrindo o botão); fase2/3 não rodaram |
| financeiro-integrado | 52/52 | 52/52 | **não rodou** |
| pdv-pagamento, pdv-atendimento, pdv-v2 | 57 / 97 / 70 ok | 57 / 97 / 70 ok | **não rodou** |
| balcão-entrega, estabilidade, regressão-release | 84 / 53 / 52 ok | 84 / 53 / 52 ok | **não rodou** |
| equipe (repaginada / acessos) | 75 / 27 ok | 75 / 27 ok | **não rodou** |
| kanban (card / topo / topo-v2), cozinha, agendamento | 72 / 48 / 121 / 26 / 25 ok | iguais | **não rodou** |
| cardápio-ordem-QR, impressão-v2, garçom | 111 / 40 / 47 ok | iguais | **não rodou** |
| release-mesas | 250/254 (cantina-demo) | 253/254 | **não rodou** |
| robô, central de atendimento, campanhas (2), vitrine-fase3, caixa-turnos, dashboard-banco | 106 / 71 / 71 / 63 / 51 / 18 / 8 ok | iguais | **não rodou** |
| vitest | 1980 ok | 2012 ok (1 falha era só um rótulo da Fase 6 em andamento; corrigida) | só os de lib: 260 ok |

**Risco para a regressão da Fase 6** (por isso ela é obrigatória antes de publicar):
- **Regras novas de fechamento:** as suítes antigas `financeiro-fase2`, `fase3`, `integrado` e `fluxo` fecham caixa
  com diferença pequena sem justificativa, ou com motoboy pendente sem PIN, e podem falhar. Se falharem, isso é
  esperado pela regra nova e as suítes precisam ser atualizadas para ela, nunca afrouxando a regra.
- **Abertura rápida:** a pergunta pode aparecer na primeira tela depois do login nas suítes que entram em loja com o
  financeiro ligado e o caixa fechado.

**Para retomar:** suba o servidor local (`start-server.sh`) e rode
`PFX=r6 bash scratchpad/regr-full.sh` (o mesmo lote da 5b). Depois, corrija só as expectativas antigas de
fechamento.

---

## DECISÕES PROVISÓRIAS — para você confirmar
**Fase 5b**
1. Limite para pagar conta ou compra **pela empresa** sem PIN: **R$ 1.000,00** (`limite_conta_centavos`). Pela gaveta
   vale o limite de saída do caixa (R$ 100,00, o mesmo da sangria).
2. **Venda manual duplicada:**
   - vale para categorias cujo nome começa com "Venda";
   - bloqueia se a descrição ou a observação cita `#N` de um pedido existente, ou se o valor é igual ao de um pedido
     não cancelado do mesmo dia;
   - liberar exige justificativa ≥ 10 letras + PIN (o dono não precisa do PIN) e gera alerta ao dono.
3. **Plano de contas padrão:**
   - **Saídas:** Insumos e Embalagens no grupo "insumo" (fora das despesas do DRE, já estão no CMV); Pessoal,
     Aluguel, Contas de consumo, Marketing, Taxas e impostos, Manutenção e Outros no grupo "despesa".
   - **Entradas:** Repasse de marketplace (iFood), Venda avulsa e Outras receitas no grupo "receita"; Aporte do sócio
     no grupo "fora" (capital, fora do DRE).
4. **DRE:**
   - faturamento pela **data do recebimento**; o Fluxo usa a data do turno;
   - despesas em **regime de caixa** (pagas no período);
   - sobra de caixa aparece como despesa negativa em "Diferenças de caixa".
5. **Recorrência:**
   - gera a próxima com 31 dias (mensal) ou 7 dias (semanal) de antecedência;
   - mês curto cai no último dia;
   - "cancelar e as próximas" encerra a série.
6. **Alertas de vencimento:** gravidade "atenção", só no painel, sem WhatsApp.
7. **Estorno de baixa:** sempre pede PIN (menos o dono).
8. **Compras:**
   - compra paga com dinheiro do caixa não se cancela (registre a devolução como reforço);
   - o custo do insumo **não volta** sozinho ao cancelar uma compra.
9. **"Conta da empresa (movimento)":** é a soma do que passou pelo sistema, não o saldo do banco (o sistema não tem o
   saldo inicial). Pode aparecer negativa.

**Fase 6**

10. **Regras de PIN no fechamento**, exatamente as do pedido:

    | Situação | Exige |
    |---|---|
    | diferença até R$ 2,00 | justificativa |
    | diferença acima de R$ 2,00 | PIN |
    | motoboy sem acerto | PIN |
    | entregue e não pago | PIN |
    | Pix a conferir | não trava; alerta ao dono |
    | comanda aberta | justificativa; PIN acima de R$ 100,00 |
    | maquininha com diferença | justificativa; PIN acima da tolerância |

    Duas regras que eu decidi:
    - **qualquer** diferença diferente de zero pede justificativa. Antes, até R$ 5,00 fechava sem nada;
    - o dono nunca precisa de PIN, mas justifica.
11. **Alertas e gravidades:**
    - **grave** (vai ao WhatsApp, se a loja configurou o número): cancelamento depois de pago, valor manipulado;
    - **atenção**: os demais;
    - **info**: pedido de aprovação.
12. **Limites da vigia** (por loja, na tela Regras e limites):

    | Alerta | Limite |
    |---|---|
    | caixa sem abrir | 30 min depois da abertura da grade (só lojas com grade e status "automático") |
    | caixa aberto | 14 h |
    | motoboy com dinheiro | 3 h |
    | desconto alto | 10% ou R$ 20,00 |
    | ações sensíveis | 10 por pessoa no turno |
13. **Valor manipulado:** o pedido **segue** com os preços do servidor; os valores enviados são ignorados e o dono
    recebe alerta. Não bloqueia o cliente.
14. **Risco:**
    - "fora do padrão" = pelo menos 3 ocorrências e mais de 2× a mediana da equipe;
    - só dono e gerente, mesmo com "ver auditoria" marcado.
15. **Aprovação pelo celular:**
    - vale 10 min, uma vez, para a mesma ação, valor e pessoa;
    - a faixa consulta a cada 10 s (sem push);
    - um pedido pendente por pessoa e ação.
16. **Abertura rápida:** só na primeira tela depois do login (cookie de 1 min) e uma vez por sessão do navegador.
17. **Dashboard:**
    - exige "Ver valores do financeiro";
    - lucro e CMV exigem "Ver DRE"; item mais lucrativo e pior margem exigem "Ver custos";
    - semana começa na segunda;
    - lucro bruto da série = faturamento (data do recebimento) − CMV (data do pedido). É uma aproximação por dia;
    - meta de faturamento por dia opcional;
    - medidor do CMV contra 100 − margem-alvo.
18. **Regras e limites:** só o dono altera, com auditoria `fin.config_alterada`.

---

## Riscos conhecidos e o que falta
- **Regressão `release-mesas`:**
  - A verificação "nenhum evento guarda senha" falha porque o evento `balcao.abriu` tem o campo "senha" (a senha de
    retirada do balcão) desde 2026-09-25. É falso positivo da suíte antiga, anterior a esta noite.
  - Na loja sem isolamento (`cantina-demo`), a mesma suíte também falha em "delivery mostra o nome novo", porque a
    vitrine tem cache de 60 s depois de um UPDATE direto. Isso também é antigo.
- **Operações em várias gravações sem transação única:** compra (nota + itens + conta + custo) e baixa (livro-caixa +
  status) são feitas pelo PostgREST. São idempotentes por chave, mas uma queda no meio pode deixar uma nota sem conta.
  O próximo passo é uma RPC transacional.
- **Categoria no livro-caixa:** vai em `dados`, que está fora do hash v1 (é o item (e), que você ainda não autorizou).
  O nome da categoria também vai no `motivo`, que está dentro do hash.
- **Gaveta negativa:** a sangria pode ser maior que o saldo da gaveta (regra da Fase 2, não mudei). Apareceu nos dados
  de teste.
- **Storage local:** o container novo do Supabase local esperava um índice em `storage.objects`. Criei o índice **só
  no banco local** para os anexos funcionarem. Em produção, confira o upload de um anexo na conferência.
- **Abertura rápida:** pode aparecer nas suítes antigas que entram em loja com o financeiro ligado e o caixa fechado
  (ver a regressão).
- **Push do painel** não existe; a aprovação pelo celular usa a faixa com consulta a cada 10 s.
- **Fase 5 / Parte 0:**
  - (b): a troca de senha do postgres é sua;
  - (c) e (e): aguardam sua resposta;
  - Coolify: falta o volume `/app/dados/ancoras` e os crons `ancora-integridade` (diário), `financeiro-diario` (de
    hora em hora) e `financeiro-vigia` (a cada 15 min).
- **Prints da 5b:** os prints da lista ainda mostram o rótulo antigo "Saldo da empresa (livro-caixa)". O rótulo foi
  trocado depois para "Conta da empresa (movimento)".

---

## Ordem sugerida de publicação e checklist
**1. Fase 5** (branch `financeiro-fase5` → main):
1. Backup.
2. Ensaio e aplicação da 0141, depois da 0142 (`aplicar-migration-producao.mjs`, com tabelas e SQL de conferência).
3. Merge e push na main. Redeploy no Coolify.
4. No Coolify:
   - volume persistente `/app/dados/ancoras`;
   - cron diário `ancora-integridade`. Rodar uma vez e conferir.
5. Conferência na Menuzia (perfil "Menuzia teste", loja "Angus Burguer"):
   - tela de CMV;
   - insumos e fichas TESTE (desativar no fim);
   - ajuste do garcom123;
   - verificar integridade com a âncora.
6. Acompanhar os pedidos das lojas.
7. Rollback: os `.down.sql` + redeploy do commit anterior.

**2. Fase 5b:**
1. Backup.
2. Ensaio e aplicação da 0143. O bucket privado `financeiro-anexos` nasce na migration.
3. Merge e deploy. Cron de hora em hora `financeiro-diario`.
4. Conferência na Menuzia:
   - conta TESTE a pagar (cancelar no fim);
   - fornecedor TESTE (desativar);
   - compra TESTE a prazo (cancelar);
   - DRE;
   - **anexo: conferir o upload em produção**.
5. Não lançar venda nem compra em loja real.

**3. Fase 6:**
1. Backup.
2. Ensaio e aplicação da 0144.
3. Merge e deploy. Cron a cada 15 min `financeiro-vigia`.
   - **Não** defina `VIGIA_RELOGIO_TESTE` em produção.
4. Conferência na Menuzia:
   - dashboard;
   - regras e limites (confirmar os valores provisórios);
   - pedir e aprovar uma sangria TESTE pelo celular;
   - risco;
   - fechar o caixa de teste.
5. Acompanhar os alertas gerados nas primeiras horas.
