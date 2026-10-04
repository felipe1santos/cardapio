# Relatório de publicação — Financeiro Fases 5, 5b e 6 (noite de 2026-10-04)

## Resumo
1. **Etapa A:** os 7 itens foram concluídos e a regressão completa ficou verde.
   - Destaques: atomicidade de todas as gravações de dinheiro; `release-mesas` 254/254; vitest com 2013 testes.
2. **Fase 5 (CMV):** publicada às 05:26 (migration) e 05:32 (deploy). Main `f261d49`, migration 0142. Conferida na
   Menuzia e acompanhada por 20 min.
3. **Fase 5b (contas, compras, DRE):** publicada às 05:56 e 06:04. Main `474e84e`, migration 0143. Conferida e
   acompanhada.
4. **Fase 6 (dashboard, alertas, PIN, aprovação pelo celular, risco):** publicada às 06:25 e 06:31. Main `a88486f`,
   migration 0144. Conferida na Menuzia e acompanhada.
5. **Não apliquei a 0141** (pgaudit + hash externo). Ela fica para você, como pedido. O app funciona sem ela.
6. **Integridade** do livro-caixa e da auditoria: 0 problemas nas 10 lojas, antes e depois de cada fase.
7. **Lojas reais:** nada foi criado nem editado. O custo na venda só roda na Menuzia; nas outras lojas, o pedido
   segue o mesmo caminho e tem o mesmo tempo de resposta, com prova em teste.
8. **Ficaram desligados, com o passo a passo abaixo:** crons novos, volume de âncoras e pgaudit. Os anexos ficam no
   Storage do Supabase, sem volume no Coolify.
9. **Acompanhamento:** de madrugada não entrou pedido em nenhuma loja. O site e a vitrine responderam 200 o tempo
   todo e não houve erro de custo.
10. **Logs do Coolify:** não consegui ler. A janela do Chrome está minimizada e a tela de logs não desenha as linhas.
    Usei saúde do site, integridade e erros no banco.

---

## Etapa A — correções

### 1. Atomicidade (tudo ou nada) — FEITO
Todas as gravações de dinheiro e custo das Fases 5, 5b e 6 viraram **uma transação só** no banco. O servidor valida
e calcula; a função do banco grava tudo ou nada. A auditoria é gravada na mesma transação.

| Operação | Função (migration) | O que fica junto |
|---|---|---|
| Salvar insumo | `cmv_insumo_salvar` (0142) | insumo + componentes da sub-receita + histórico de custo + auditoria |
| Salvar ficha | `cmv_ficha_salvar` (0142) | ficha + componentes + auditoria |
| Baixa de conta | `fin_conta_baixar` (0143) | linhas do livro-caixa + status "paga" + auditoria (gaveta exige turno aberto) |
| Estorno da baixa | `fin_conta_estornar` (0143) | linhas opostas (ligadas às originais) + conta "a pagar" + auditoria |
| Cancelar conta / série | `fin_conta_cancelar` (0143) | conta + próximas da série + auditoria |
| Compra de insumos | `fin_compra_registrar` (0143) | nota + itens + conta a pagar (+ baixa pela empresa) ou saída do caixa + custo dos insumos + histórico + auditoria |
| Cancelar compra | `fin_compra_cancelar` (0143) | compra + conta + auditoria |
| Movimento do caixa com aprovação pelo celular | `fin_lancar_grupo` (0143/0144) | linhas + aprovação marcada como usada |
| Fechamento do caixa | `fin_caixa_fechar` (0144) | ajuste da contagem + turno fechado + aprovação usada + auditoria |
| Decisão do aprovador | `fin_aprovacao_remota_decidir` (0144) | aprovação gravada + pedido decidido + auditoria |

Mudanças de comportamento:
- **Aprovação pelo celular:** agora é gasta **na mesma transação** do dinheiro (`fin_usar_aprovacao`). Se a
  gravação falha, a aprovação continua valendo. Usar duas vezes é recusado no banco (duas abas ao mesmo tempo).
- **Repetição:** toda operação é idempotente pela chave. Clique duplo devolve o mesmo resultado, sem duplicar.

Teste `e2e-financeiro-atomico` (**23/23**). Um gatilho temporário recusa um passo do meio e o teste confere que nada
ficou pela metade:
- insumo com falha no histórico: custo, histórico e auditoria intactos;
- ficha com falha nos componentes: ficha antiga inteira;
- compra com falha no histórico de custo: nem nota, nem conta, nem custo;
- baixa com falha ao marcar "paga": nenhuma linha no livro-caixa;
- estorno com falha: nenhuma linha oposta;
- cancelar conta com falha na auditoria: a conta não fica cancelada;
- cancelar compra com falha na auditoria: compra e conta continuam ativas;
- decisão do aprovador com falha na auditoria: pedido segue pendente, nenhuma aprovação gravada;
- sangria aprovada pelo celular com falha: nada no livro-caixa e a aprovação continua valendo; sem a falha, entra e
  vira "usada"; na segunda vez, recusada;
- fechamento com falha: o caixa continua aberto e não fica ajuste no livro-caixa.

Repetições testadas: compra (mesma chave → mesma compra), baixa (repetida → "repetido").

### 2. Janela "Abrir o caixa agora?" — FEITO
- Agora é um **flutuante** (`components/ui/flutuante.tsx`, camada máxima), pequeno (300 px), preso à direita
  **logo abaixo do topo**:
  - não cobre a barra do topo (o teste mede a posição);
  - não escurece nem trava a tela.
- Aparece **uma vez por login**. O login grava um cookie de 1 minuto, apagado assim que a pergunta aparece.
- **"Agora não"**, clicar fora ou Esc valem até o próximo login. No login seguinte ela volta, se o caixa continuar
  fechado.
- Só para quem pode abrir o caixa. O **servidor** nunca libera garçom, cozinha, motoboy ou logística, mesmo com a
  permissão marcada.
- Prints: `docs/financeiro/fase6-prints/abertura-rapida-desktop.png` e `abertura-rapida-celular.png`.
  - No desktop, a janela fica sobre um cartão de número do Kanban, sem cobrir nenhum botão.
  - No celular, fica sobre os cartões do topo, também sem cobrir botões.

### 3. Testes ajustados — conferido
Diff dos três commits. **Nenhuma verificação foi removida nem afrouxada:**

**`c5c3462`** — `e2e-financeiro-fase1`. A janela nova cobria o botão do perfil; o teste a dispensa. Nenhum `ok(...)`
mudou.
```diff
+  // Fase 6: abertura rápida do caixa logo após o login (quem pode abrir, caixa fechado) — esta suíte não testa isso.
+  await p.getByTestId('abertura-rapida-depois').click({ timeout: 3000 }).catch(() => {})
```

**`c79201f`** — `e2e-financeiro-integrado`. O fechamento com pendência passa a justificar e, se pedir, usa o PIN do
gerente. A verificação "caixa fechado sem diferença, por Atendente Demo" continua igual.
```diff
+  // Fase 6 (regras de PIN no fechamento): pendência que passa de turno pede justificativa; acima do limite, PIN.
+  await ate.p.waitForTimeout(1200)
+  if (await ate.p.getByTestId('fechar-justificativa').count()) {
+    await ate.p.getByTestId('fechar-justificativa').fill('TESTE mesa ainda aberta passa para o próximo turno')
+    await ate.p.getByTestId('fechar-com-justificativa').click()
+    await ate.p.waitForTimeout(1200)
+  }
+  if (await ate.p.getByTestId('aprovacao-pin').count()) {
+    await ate.p.getByTestId('aprovador').filter({ hasText: 'Gerente' }).first().click()
+    for (const d of '482913') await ate.p.getByTestId('aprovacao-pin').getByTestId(`pin-${d}`).click()
+  }
```

**`056ff5a`** — `fase1` (o aviso de configuração depois do flutuante) e `fluxo`. A verificação do rodapé ficou **mais
forte**: antes olhava só a 1ª página; agora soma todas.
```diff
+  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
-    ok('totais do rodapé = soma das linhas (todas, não só a página)', fx.total === fx.linhas.length && fx.totais.recebido === fx.linhas.reduce((s, l) => s + l.recebido, 0))
+    const todasLinhas = [...fx.linhas]
+    for (let pg = 1; todasLinhas.length < fx.total && pg < 50; pg++) todasLinhas.push(...((await api(dono.p, `/api/admin/financeiro/fluxo?${PERIODO}&porPagina=100&pagina=${pg}`)).j?.linhas ?? []))
+    ok('totais do rodapé = soma das linhas (todas, não só a página)', fx.total === todasLinhas.length && fx.totais.recebido === todasLinhas.reduce((s, l) => s + l.recebido, 0), `${fx.total} × ${todasLinhas.length}`)
```

**Teste novo** (`e2e-financeiro-fase6`):
- "fechar com pendência SEM justificativa → bloqueado, caixa continua aberto" (409 `justificativa_necessaria`);
- "…com justificativa mas SEM PIN acima do limite → bloqueado, caixa continua aberto" (409 `aprovacao_necessaria`).

### 4. release-mesas — 254/254
- A "senha" das comandas de balcão é o **número de chamada** da retirada, mostrado e chamado em público. Não é
  credencial: sozinha, não permite retirar o pedido de outra pessoa.
- **Gatilho novo (0144) em `eventos_auditoria`:** os eventos novos gravam o campo como `codigo_retirada`. A
  normalização acontece antes do hash da cadeia, então a integridade continua valendo.
- **Eventos antigos:** são imutáveis e ficam como estão.
- **A verificação** do teste passou a olhar só os eventos **da própria rodada**. Ela continua procurando senha,
  password, token e e-mail técnico.

### 5. Decisões ajustadas — FEITO
- **Despesa pela empresa sem PIN: até R$ 300,00.**
  - Padrão `limite_conta_centavos = 30000` na 0143.
  - Acima disso, PIN, menos para o dono.
- **Venda manual:**
  - **citar o número de um pedido do sistema → BLOQUEIA**. Liberar só com justificativa + PIN, auditado e com
    alerta;
  - **só o mesmo valor de um pedido do dia → apenas AVISA**. A conta entra, o aviso volta na tela e o registro
    `contas.venda_parecida` fica na auditoria.

### 6. Segurança para as lojas reais — FEITO
**Gatilho do custo na venda (0142):**
- Em loja **sem** o financeiro, ele sai **antes de qualquer coisa**: só uma leitura por chave, sem subtransação e
  sem gravar nada.
- Na Menuzia, uma falha no cálculo não derruba o pedido: o item fica "erro" (sem custo).

**Teste `e2e-loja-sem-financeiro`** (6/6), com 24 pedidos alternando o gatilho ligado e desligado:
- todos os pedidos entraram;
- 0 custo gravado em loja sem o financeiro;
- **mesmo tempo de resposta** (mediana de 42 ms com o gatilho × 39 ms sem);
- cálculo quebrado de propósito: o pedido entra e o item fica "erro".

**Migrations só aditivas:**
- Criam tabelas, funções, colunas novas com padrão e gatilhos novos.
- Nada é apagado nem renomeado.
- `lock_timeout` de **5 s** no aplicador: se a trava de `pedido_itens` ou `eventos_auditoria` não vier em 5 s, a
  migration desiste em vez de segurar pedidos.

### 7. Regressão completa (em 4 lotes, por causa da memória)
| Suíte | Resultado |
|---|---|
| financeiro-fase1 | 66/66 |
| financeiro-fase2 | 55/55 |
| financeiro-fase3 | 106/106 |
| financeiro-integrado | 52/52 |
| financeiro-fluxo | 86/86 |
| financeiro-cmv | 61/61 |
| integridade | 7/7 |
| financeiro-contas | 80/80 |
| financeiro-fase6 | 96/96 |
| financeiro-atomico (novo) | 23/23 |
| loja-sem-financeiro (novo) | 6/6 |
| pdv-pagamento | 57/57 |
| pdv-atendimento | 97/97 |
| pdv-v2 | 70/70 |
| balcao-entrega | 84/84 |
| estabilidade-operacional | 53/53 |
| regressao-release | 52/52 |
| **release-mesas** | **254/254** |
| garcom (mesas/comandas) | 47/47 |
| impressao-v2 | 40/40 |
| caixa-turnos | 18/18 |
| kanban-card | 72/72 |
| kanban-topo | 48/48 |
| kanban-topo-v2 | 121/121 |
| cozinha-fase5 | 26/26 |
| cardapio-ordem-qr | 111/111 |
| equipe-repaginada | 75/75 |
| equipe-acessos | 27/27 |
| agendamento | 25/25 |
| vitrine-fase3 | 51/51 |
| dashboard-banco | 8/8 |
| robo-whatsapp | 106/106 |
| atendimento-whatsapp | 71/71 |
| campanhas-repaginada | 71/71 |
| campanhas-metricas | 63/63 |
| vitest | 2013 ok (10 pulados) |

**Problemas que a regressão achou e eu corrigi:**
- **Turno reaberto:** o fechamento atômico não gravava o status `fechado`. Corrigido em `a88486f`.
- **Teste de atomicidade:** passou a comparar antes e depois.

**Rollbacks** das 0142, 0143 e 0144: testados em cadeia no banco local (desfazer 0144 → 0143 → 0142 e reaplicar).

---

## Etapa B — publicação

### Fase 5 — PUBLICADA
- **Linha do tempo:** 05:26 migration, 05:32 build novo no ar.
- **Main:** `f261d49`.
- **Migration:** **0142** (com backup e ensaio). A **0141 não foi aplicada**, de propósito.
- **Backup:** `C:\Users\felipe\backups\menuzia\2026-10-04-pre-0142` (`usuarios`, `restaurantes`).
- **Conferência na Menuzia.** Antes de qualquer clique: `/api/sessao/estado` deu `financeiroAtivo: true` e
  "Administrador", e a tela mostrou "Angus Burg…". Depois:
  - Precificação abriu: 28 produtos "Sem ficha", nenhum custo exposto;
  - insumo TESTE: criado (201), custo alterado (200), histórico com 2 linhas, **desativado** no fim;
  - CMV das vendas: 200;
  - **garcom123 ajustado ao cargo**: papel garçom, área Mesas, sem permissões sensíveis (auditado);
  - Print: `docs/financeiro/publicacao-prints/fase5-precificacao-menuzia.jpg`.
- **Integridade:** 0 problemas nas 10 lojas.
- **Acompanhamento (05:34–05:54):**
  - site e vitrine 200 em todas as amostras;
  - nenhum pedido novo (madrugada) e nenhum custo com erro.
- **Rollback:** não houve.

### Fase 5b — PUBLICADA
- **Linha do tempo:** 05:56 migration, 06:04 build novo no ar.
- **Main:** `474e84e`.
- **Migration:** **0143** (com backup e ensaio).
- **Backup:** `C:\Users\felipe\backups\menuzia\2026-10-04-pre-0143` (`usuarios`, `fin_config`).
- **Conferência na Menuzia** (loja e usuário confirmados antes, por rota neutra):
  - plano de contas padrão criado (13 categorias);
  - conta TESTE de R$ 1,00 lançada e paga pela empresa;
  - a repetição devolveu "repetido";
  - a conta foi **estornada** e **cancelada**;
  - compra TESTE a prazo: custo do insumo TESTE atualizado e compra **cancelada**, com a conta junto;
  - DRE: 200;
  - no fim, nenhuma conta TESTE em aberto;
  - **o envio de anexo não foi testado em produção**, para não deixar arquivo de teste no Storage (ver Riscos);
  - Print: `docs/financeiro/publicacao-prints/fase5b-contas-menuzia.jpg`.
- **Integridade:** 0 problemas nas 10 lojas.
- **Acompanhamento (06:04–06:24):** site e vitrine 200, nenhum pedido novo, nenhum custo com erro.
- **Rollback:** não houve.

### Fase 6 — PUBLICADA
- **Linha do tempo:** 06:25 migration, 06:31 build novo no ar.
- **Main:** `a88486f`.
- **Migration:** **0144** (com backup e ensaio).
- **Backup:** `C:\Users\felipe\backups\menuzia\2026-10-04-pre-0144` (`fin_config`).
- **Conferência na Menuzia** (loja e usuário confirmados antes, por rota neutra):
  - Dashboard: 200; tela renderizada com cartões, gráfico e faturamento de R$ 9,00;
  - Risco: 200;
  - Regras e limites: 200, com tolerância R$ 2,00 e limite da empresa R$ 300,00;
  - Aprovações: 200, nenhuma pendente;
  - **caixa TESTE** aberto com fundo R$ 0. Ao tentar fechar, foi barrado nas pendências que já existiam na loja
    (regra nova). Com justificativa, **fechou** pela transação nova (`fin_caixa_fechar`), sem diferença;
  - não testei a aprovação pelo celular em produção: o único aprovador é o próprio dono, e ninguém aprova o próprio
    pedido. Ela está coberta nos testes locais;
  - não fiz pedido na vitrine para testar "valor manipulado", para não criar pedido;
  - **Print:** a janela do Chrome minimizou e o print não saiu. A tela foi conferida pelo DOM.
- **Integridade:** 0 problemas nas 10 lojas.
- **Acompanhamento (06:33–06:53):** site e vitrine 200, nenhum pedido novo, nenhum custo com erro.
  - Integridade final: 0 problemas nas 10 lojas.
  - Última migration em produção: `0144_dashboard_alertas_pin_risco.sql`.
- **Rollback:** não houve.

---

## As 18 decisões provisórias (texto inteiro)
As **2 marcadas com ✅ AJUSTADA** foram definidas por você nesta rodada.

**Fase 5b**

1. ✅ **AJUSTADA** — Limite para pagar conta ou compra **pela empresa** sem PIN: ~~R$ 1.000,00~~ **R$ 300,00**
   (`limite_conta_centavos`). Pela gaveta vale o limite de saída do caixa (R$ 100,00, o mesmo da sangria).
2. ✅ **AJUSTADA** — **Venda manual duplicada:**
   - vale para categorias cujo nome começa com "Venda";
   - **citar `#N` de um pedido existente** na descrição ou na observação → **bloqueia**. Liberar exige justificativa
     ≥ 10 letras + PIN (o dono não precisa do PIN) e gera alerta ao dono;
   - **só o mesmo valor** de um pedido não cancelado do mesmo dia → **apenas avisa**. A conta entra, o aviso aparece
     e fica na auditoria.
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
    - um pedido pendente por pessoa e ação;
    - agora a aprovação é gasta na mesma transação do dinheiro.
16. **Abertura rápida** (revisada nesta rodada, item 2): uma vez **por login**, num flutuante abaixo do topo; "Agora
    não" vale até o próximo login; nunca para garçom, cozinha ou motoboy.
17. **Dashboard:**
    - exige "Ver valores do financeiro";
    - lucro e CMV exigem "Ver DRE"; item mais lucrativo e pior margem exigem "Ver custos";
    - semana começa na segunda;
    - lucro bruto da série = faturamento (data do recebimento) − CMV (data do pedido). É uma aproximação por dia;
    - meta de faturamento por dia opcional;
    - medidor do CMV contra 100 − margem-alvo.
18. **Regras e limites:** só o dono altera, com auditoria `fin.config_alterada`.

---

## Postgres: itens (c) e (e), senha e o que ficou para você

### (c) Usuário só-leitura para as conferências (`menuzia_leitura`) — NÃO aplicado
- Hoje, os scripts que só **leem** produção, como as conferências e os relatórios, entram com o `postgres`, que pode
  tudo.
- A proposta é criar uma role com `LOGIN` e `SELECT` nas tabelas, sem `INSERT`, `UPDATE`, `DELETE` ou DDL, com senha
  própria guardada no gerenciador.
- Os scripts de leitura passariam a usar essa role, e o `postgres` ficaria só para aplicar migration, com a senha
  colada na hora.
- Ganho: se a string das conferências vazar, quem a tiver só lê; não altera nada.
- Custo: uma senha a mais para guardar e ajustar `ler-prod` para a nova string.
- Risco para as lojas: nenhum, porque o app não usa essa role.

### (e) Hash v2 do livro-caixa — NÃO aplicado
- Hoje o hash de cada lançamento cobre os campos de dinheiro e de identidade: loja, tipo, valor, conta, data, autor,
  origem e o hash anterior.
- Ficam **fora do hash** três colunas: `dados` (detalhes em JSON), `aprovado_por_nome` e `dispositivo`.
- A proposta é uma versão 2 do hash que inclui também essas três colunas, só para lançamentos **novos**.
  - Os antigos continuam conferidos pela v1. Não se recalcula o passado.
  - Uma coluna `hash_versao` diz qual fórmula vale para cada linha.
- Ganho: quem tem o `postgres` não consegue trocar o nome do aprovador ou o dispositivo sem quebrar a cadeia.
- Custo: mudança no gatilho do livro-caixa, o ponto mais sensível do financeiro, com teste completo de integridade
  antes.
- **Nota da Fase 5b:** a categoria da conta paga fica em `dados`, fora do hash v1. O nome da categoria também vai no
  `motivo`, que está dentro do hash. A v2 cobriria `dados` também.

### Os dois limites do hash de hoje
1. **Quem tem o `postgres` pode reescrever a cadeia inteira.** A verificação interna continua "íntegra", porque a
   cadeia só prova coerência consigo mesma.
   → É coberto pela **âncora externa (0141)**, que **ainda não está em produção**: você vai aplicar.
2. **`dados`, `aprovado_por_nome` e `dispositivo` estão fora do hash.** → O pgaudit (0141) registra qualquer
   `UPDATE` nelas. Quem resolve de vez é a v2 (e).

### Passo a passo da senha do postgres (eu NÃO troquei)
Conferido:
- O `.env.local` nunca foi commitado: está no `.gitignore`, e no histórico só aparece o `.env.local.example`, com
  valores fictícios.
- A senha real e a service key aparecem em 0 commits.
- O app em produção não usa a senha do postgres; só os scripts desta máquina usam.

Passo a passo:
1. Crie no seu gerenciador de senhas o item **"Menuzia — Postgres (produção)"**.
2. No Supabase: **Project Settings › Database › Database password › Reset database password**. Gere uma senha forte e
   salve-a **primeiro** no gerenciador.
3. Confirme a troca. O app continua no ar.
4. No `C:\projetos\cardapio-estab\.env.local`, **apague** a linha `DATABASE_URL=...`.
5. Para migrations e conferências:
   - cole a connection string só na sessão do terminal (`$env:DATABASE_URL = "…"`);
   - feche o terminal no fim.
6. Se eu precisar dela, você cola com `! $env:DATABASE_URL="…"`. Eu não a escrevo em arquivo nem no chat.
7. Opcional: ative o 2FA da conta Supabase.

### O que ficou pendente para você
**1. Migration 0141** (pgaudit + função da âncora externa)
- Arquivo: `supabase/migrations/0141_integridade_ancora_e_pgaudit.sql`.
- Rollback: `docs/rollback/0141_integridade_ancora_e_pgaudit.down.sql`.
- **Como aplicar** (a ordem importa, porque o aplicador confere a última migration):
  - Rode `node scripts/seguranca/aplicar-migration-producao.mjs 0141_integridade_ancora_e_pgaudit.sql <última> x
    "select exists(select 1 from pg_extension where extname='pgaudit') as ok"`. Primeiro sem `--aplicar` (ensaio);
    depois com `--aplicar --confirmar-producao`.
  - `<última>` é a última migration registrada naquela hora (hoje `0144_…`, se a Fase 6 for publicada).

**2. Coolify**
- **Volume persistente** `/app/dados/ancoras`. É só para a âncora; os anexos ficam no Storage do Supabase e não
  precisam de volume.
- **Tarefas agendadas** (Scheduled Tasks), todas desligadas por enquanto. Cada uma é uma linha única:

  | Tarefa | Quando | Comando |
  |---|---|---|
  | âncora diária | 07:00, só depois da 0141 | `curl -s -X POST https://app.menuzia.com.br/api/cron/ancora-integridade -H "x-cron-secret: $CRON_SECRET"` |
  | financeiro diário (recorrências e vencimentos) | de hora em hora | `curl -s -X POST https://app.menuzia.com.br/api/cron/financeiro-diario -H "x-cron-secret: $CRON_SECRET"` |
  | vigia (alertas) | a cada 15 min | `curl -s -X POST https://app.menuzia.com.br/api/cron/financeiro-vigia -H "x-cron-secret: $CRON_SECRET"` |

  Sem os crons, as recorrências e os alertas de vencimento ainda são gerados quando alguém abre Contas. Os alertas da
  vigia ficam desligados.
- **Nunca** defina `VIGIA_RELOGIO_TESTE` em produção (é só do teste local).

**3. Senha do postgres:** passo a passo acima.

---

## Riscos conhecidos
- **Anexos de contas (boleto/nota) não testados em produção.**
  - O bucket privado `financeiro-anexos` nasceu na 0143.
  - No banco local, o Storage precisou de um índice que faltava. Em produção não testei, para não deixar arquivo.
  - Teste um anexo na próxima conferência. Se der erro 500, é o mesmo índice: peça ao suporte do Supabase ou me
    avise.
- **Âncora externa e pgaudit fora do ar** até você aplicar a 0141. O limite 1 do hash continua aberto até lá.
- **Acompanhamento sem tráfego:** como foi de madrugada, não houve pedidos para observar. Vale olhar os primeiros
  pedidos da manhã: Kanban, PDV e o custo gravado só na Menuzia.
- **Logs do Coolify** não lidos (janela minimizada). Usei saúde do site, integridade e erros no banco.
- **Gaveta negativa:** a sangria pode passar do saldo da gaveta. É uma regra da Fase 2, que não mudei.
- **Abertura rápida:** fica sobre o conteúdo logo abaixo do topo à direita. Nas telas conferidas não cobre botão, mas
  uma tela com botão nesse canto ficaria coberta até a pessoa responder ou clicar fora (clicar fora fecha).
