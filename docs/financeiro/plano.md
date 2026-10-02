# Módulo Financeiro + Equipe/Permissões + Área do Motoboy — Fase 0: diagnóstico e plano

Branch `feat/financeiro` (a partir da main 24da0b1). **Nada foi alterado ainda**: este documento é só leitura do
sistema atual + proposta. Aguardando aprovação antes de qualquer migration ou mudança em fluxo de dinheiro.

---

## 1. Como o sistema está hoje

### 1.1 Onde o dinheiro mora
| Onde | Tabela / coluna | Observação |
|---|---|---|
| Pedido | `pedidos.subtotal, taxa_entrega, desconto, total, troco_para, pago, forma_pagamento (pix/cartao/dinheiro), status, canal (delivery/mesa/balcao), entregador_id, entregue_em` | valores em `numeric(10,2)` (reais), não centavos |
| Itens | `pedido_itens.preco_unitario, quantidade, complementos(jsonb com preço), cancelado_em/motivo/por` | **não guarda o custo** do item no momento da venda |
| Conta de mesa/balcão | `comandas` (taxa de serviço %, desconto valor/%, taxa de entrega, taxa extra, cupom, `total_final`, reabertura) + `comanda_taxas` (várias taxas, 0124) | total calculado por `comanda_totais()` no banco |
| Pagamentos (salão/PDV) | `pagamentos_comanda` (forma dinheiro/pix/crédito/débito/vale/fiado, valor, valor_recebido, troco, `chave_idempotencia`, criado_por, estorno por colunas) | gravado pela RPC `comanda_pagamento_registrar` (trava a conta, recalcula o restante, idempotente) |
| Caixa | `caixa_turnos` (0114: um turno aberto por loja, aberto/fechado por) + `fechamentos_caixa` (acerto do entregador: esperado, troco levado, declarado, diferença) | turno atravessa a meia-noite; abre sozinho na 1ª entrega (gatilho 0115) |
| Cupons | `cupons`, `cupom_usos`, `cupom_reservas_cliente` | |
| Auditoria | `eventos_auditoria` (0059/0071: ator, usuário, papel, ação, entidade, dados, correlação) | leitura só dono/gerente |

### 1.2 Fluxos
- **PDV / Mesas (PDV v2)**: pagamentos, estorno, desconto, taxas, cupom, cancelamentos, fechar e reabrir conta passam por
  RPCs do banco (`comanda_*`, `item_cancelar`, `pedido_presencial_cancelar`, `cancelamento_solicitar/decidir`), chamadas
  por `lib/servicos/conta-presencial.ts`. Bom ponto de partida: o banco já recalcula e já é idempotente no pagamento.
- **Delivery**: o pedido nasce no servidor (total calculado lá). `pago` = verdadeiro **só se a forma for Pix, na criação, sem
  confirmação nenhuma**; cartão e dinheiro na entrega nunca viram "pago". O Kanban muda o status direto do navegador (RLS
  + gatilho de transição válida).
- **Motoboy**: portal por **token permanente** (link/QR) em `/entregador/[token]`, já é PWA (manifest + service worker).
  Pode: pegar pedido (despacho aberto), marcar entregue, marcar problema (cancela). **Não registra como o cliente pagou.**
- **Acerto do motoboy** (`/api/admin/caixa`, tela dentro da Logística): o servidor calcula o esperado (pedidos em dinheiro
  entregues no turno) e o troco (`troco_para − total`); a tela manda só o valor declarado. **Não é cego** (mostra o esperado).
- **Loja sem motoboy** (`usa_logistica=false` ou `entrega_sem_entregador`): rota `saiu-entrega` leva o pedido até
  "entregue" sem registrar recebimento e sem entrar em caixa nenhum. **Nexta**: idem (só muda status).
- **Fechar caixa**: só marca `fechado_em`; recusa se houver motoboy sem acerto (a menos de "forçar"). Não há contagem
  da gaveta, fundo de troco, sangria, reforço nem despesa.
- **Dashboard**: soma `pedidos.total` no navegador (ignora estornos, descontos/taxas da conta, itens cancelados).

### 1.3 Usuários, permissões e auditoria
- `usuarios`: papel (dono, gerente, garcom, atendente, cozinha, logistica, entregador), `acessos` (áreas + ações sensíveis,
  0120), `cargo` e `situacao` (0128), `desativado_em` (corta o acesso pela RLS na próxima requisição).
- O **middleware** relê papel e acessos do banco a cada requisição; APIs usam a sessão (`getCurrentSession`) e
  `service_role` com filtro manual por loja. Ações sensíveis inferidas do corpo (`sensivelDaRequisicao`).
- Login: e-mail ou usuário + senha; limite de tentativas em memória. **Sem PIN, sem histórico de login/IP/dispositivo,
  sem detecção de login simultâneo, sem bloqueio por inatividade.**
- Aprovação: só existe "garçom pede cancelamento → gestor decide" (sem PIN do aprovador, **sem impedir autoaprovação**).
- Auditoria: escrita só pelo servidor, mas **sem trava contra UPDATE/DELETE para o service_role, sem hash encadeado**, e
  várias ações de dinheiro (pagamento, estorno, cancelar item, abrir/fechar caixa, acerto) gravam a auditoria "se der"
  (falha silenciosa, fora da transação).
- Flags por loja: colunas em `restaurantes` (`pdv_v2`, `modulo_mesas_ativo`, `push_liberado`…).
- Alertas ao dono: **não existem** (nenhum canal).

### 1.4 Custos e impressão
- `itens_cardapio_gestao.preco_custo` (0130, só gestor lê) e `fichas_preparo` (ingredientes em texto livre, sem custo).
  **Não existe cadastro de insumos.** O custo não é guardado na venda.
- Impressão: a folha térmica do pedido (`recibo.js`) é intocável (CLAUDE.md §7). Existe uma fila `impressao_trabalhos`
  (pré-conta) onde dá para acrescentar um tipo novo "relatório de caixa" **sem mexer no recibo** (Assistente precisa de
  versão nova para imprimir; versões antigas ignoram o tipo).

---

## 2. Lacunas e riscos de fraude encontrados (hoje)

| # | Risco | Onde | Gravidade |
|---|---|---|---|
| R1 | `fechamentos_caixa` (acertos) pode ser **editado/apagado pelo navegador** por dono/gerente/logística, sem auditoria | grant antigo da 0003 | Alta |
| R2 | Apagar um entregador **apaga os acertos dele** (cascade) e tira os pedidos em dinheiro do esperado | `entregadores` CRUD no navegador | Alta |
| R3 | Trocar o `entregador_id` de um pedido **já entregue** (muda quem deve o dinheiro), sem trava e sem auditoria | grant de coluna 0061 | Alta |
| R4 | Pix marcado como pago na criação, **sem confirmação**; cartão/dinheiro na entrega nunca registrados como recebidos | `pedidos.pago` | Alta |
| R5 | Token do motoboy **não expira e não pode ser revogado**; quem tiver o link marca entregue/cancela pedidos | portal `/entregador/[token]` | Alta |
| R6 | Fechamento de caixa **não conta a gaveta**; acerto **não é cego** | `/api/admin/caixa` | Alta |
| R7 | Sem fundo de troco, sangria, reforço, despesa — o dinheiro que sai da gaveta não tem registro | — | Alta |
| R8 | Auditoria **alterável pelo service_role**, sem hash; ações de dinheiro auditadas fora da transação (falha silenciosa) | `eventos_auditoria` | Média/Alta |
| R9 | Aprovação sem PIN do aprovador e **sem impedir autoaprovação** | cancelamento | Média |
| R10 | Entregas de loja sem motoboy e do Nexta **não entram em caixa nenhum** | `saiu-entrega`, Nexta | Média |
| R11 | "Forçar" fechamento não guarda o que ficou pendente | caixa | Média |
| R12 | Taxas da conta são apagadas e regravadas (`comanda_taxas_definir`), auditoria só vê a soma | 0124 | Baixa/Média |
| R13 | `cupom_usos` apagável por dono/gerente (libera cupom de novo), sem auditoria | cupons | Baixa |
| R14 | Mudança de status do delivery pelo navegador não é auditada | Kanban | Média |
| R15 | Portal do motoboy calcula "a devolver" com outra fórmula (por dia) diferente do acerto (por turno) | `calcularCaixaEntregadorHoje` | Média |
| R16 | Sem histórico de login, IP, dispositivo; login compartilhado passa despercebido | login | Média |
| R17 | Dashboard soma `pedidos.total` no navegador (não bate com o que entrou de fato) | dashboard | Média |

Todos entram no plano abaixo (coluna "Fase" na seção 6).

---

## 3. Decisões de desenho (propostas)

1. **Um caixa único por loja** (é o que já existe: um turno aberto por vez). Vários terminais operam o mesmo turno; cada
   lançamento guarda **quem** fez e de **qual dispositivo**. Mais simples e mais seguro que caixa por terminal (sem dinheiro
   "entre caixas"). O turno continua atravessando a meia-noite.
2. **Livro-caixa (ledger) único, em centavos inteiros, append-only**, com **partidas por carteira**: cada movimento de
   dinheiro é um "grupo" com uma ou mais linhas em carteiras (Gaveta do turno, Com o motoboy X, Pix a conferir, Conta da
   empresa, A receber, Cartão/maquininha). Ex.: troco entregue ao motoboy = −Gaveta / +Motoboy X. Os saldos (dinheiro na
   gaveta, dinheiro com cada motoboy, Pix a conferir) saem **somando o ledger**, nunca de um total digitado.
3. **O ledger é escrito pelo banco**, dentro das mesmas transações das RPCs que já movem dinheiro (pagamento, estorno,
   fechar conta, cancelar pós-pagamento) — só quando a loja tem `financeiro_ativo`. Assim nenhum caminho "esquece" de
   lançar e nada fica pela metade.
4. **Valores antigos continuam em reais** (`numeric`) nas tabelas de hoje para não quebrar nada; o ledger e as tabelas novas
   usam **centavos (bigint)**, com conversão única e testada na fronteira.
5. **Imutabilidade no banco**: gatilhos que recusam UPDATE/DELETE no ledger e na auditoria **para todos os papéis,
   inclusive service_role**; correção só por lançamento de estorno/ajuste vinculado ao original. Hash encadeado por loja
   (`hash = sha256(hash_anterior || conteúdo)`) + verificador.
6. **Feature flag `restaurantes.financeiro_ativo`** (padrão falso). Com a flag desligada, tudo funciona exatamente como
   hoje. Ligada primeiro só na Menuzia.
7. **Motoboy entra por login** (usuário papel `entregador` ligado a `entregadores.usuario_id`). O link/QR atual continua
   funcionando por compatibilidade, mas: (a) ganha **revogar/gerar novo**; (b) com o financeiro ligado, **registrar
   pagamento** só pelo login (o token só consegue ver e marcar saída/entrega como hoje); (c) bloquear o funcionário
   revoga o token também.
8. **Aprovação com PIN do aprovador** (PIN pessoal de 4–6 dígitos, guardado com hash), validado no servidor, **aprovador ≠
   solicitante**, registrado no lançamento e na auditoria. Limites por loja numa tabela de configuração.

---

## 4. Modelo de dados proposto

Todas com `restaurante_id`, RLS por loja (`auth_restaurante_id()`), escrita **só pelo servidor/RPC**, valores em centavos.

### 4.1 Base (Fase 1)
| Tabela | Campos principais | Notas |
|---|---|---|
| `fin_config` | `restaurante_id` PK, limites (desconto %, desconto R$, sangria/despesa R$, divergência R$, horas caixa aberto, horas motoboy pendente), margem-alvo, inatividade (min), WhatsApp do dono para alertas | padrões na seção 5 |
| `fin_lancamentos` | `id`, `grupo_id`, `turno_id`, `carteira` (gaveta/motoboy/pix_conferir/cartao/empresa/a_receber), `entregador_id`, `tipo` (venda, recebimento, troco, sangria, reforco, despesa, retirada, perda, ajuste, troco_motoboy, acerto_motoboy, estorno, taxa, desconto, pix_confirmado…), `valor_centavos` (com sinal), `forma`, `origem` (pdv/mesa/balcao/delivery/motoboy/online/manual), `pedido_id`, `comanda_id`, `pagamento_id`, `referencia_id` (lançamento corrigido), `motivo`, `usuario_id/nome` (da sessão), `aprovado_por/nome`, `aprovacao_id`, `chave_idempotencia` (único por loja), `dispositivo`, `criado_em` (servidor), `hash_anterior`, `hash` | append-only (gatilho), índice por (loja, turno), (loja, carteira, entregador), (loja, criado_em) |
| `fin_aprovacoes` | `id`, `acao`, `solicitante_id`, `aprovador_id`, `valor_centavos`, `motivo`, `contexto jsonb`, `criado_em` | aprovador ≠ solicitante (CHECK + servidor) |
| `fin_alertas` | `id`, `tipo`, `gravidade`, `mensagem`, `dados`, `usuario_id`, `lido_por/em`, `criado_em` | painel do dono + WhatsApp opcional |
| `usuarios` + | `pin_hash` (pgcrypto/bcrypt), `pin_falhas`, `pin_bloqueado_ate` | PIN nunca volta para a tela |
| `usuarios_sessoes` | `usuario_id`, `ip`, `dispositivo` (user-agent + id do terminal), `criado_em`, `visto_em`, `encerrada_em`, `motivo` | login simultâneo → alerta; bloquear derruba (revoga refresh token via Admin API) |
| `eventos_auditoria` + | `hash_anterior`, `hash`, gatilho de imutabilidade; `restaurantes` delete deixa de apagar em cascata (RESTRICT) | ações de dinheiro passam a auditar **dentro** da transação (falha = operação falha) |
| `restaurantes` + | `financeiro_ativo boolean default false` | flag |

### 4.2 Caixa (Fase 2) — evolui `caixa_turnos`
`caixa_turnos` + `valor_inicial_centavos`, `status` (aberto/fechado/divergente/reaberto), `contado_dinheiro_centavos`,
`contado_cartao_centavos`, `esperado_dinheiro_centavos`, `diferenca_centavos`, `fechado_com_aprovacao_id`,
`justificativa`, `reaberto_por/em/motivo`, `dispositivo_abertura`. Fechado ⇒ gatilho recusa novos lançamentos no turno.
`fin_movimentacoes` não é preciso: sangria/reforço/despesa/retirada/perda são lançamentos com `tipo` + anexo
(`fin_anexos`: caminho no Storage privado).

### 4.3 Motoboy (Fase 3)
`entregadores` + `usuario_id`, `token_revogado_em`, `ativo`; `fin_entregas_pagamento` (pedido_id, entregador_id,
forma informada, valor recebido, troco dado, NSU, motivo "não pago", localização aproximada, `chave_idempotencia`,
criado_em) — cada registro gera os lançamentos. `pedidos` + `status_financeiro` (pago / a_receber / a_conferir /
nao_pago / cancelado). `fechamentos_caixa` vira histórico (só leitura) e o acerto novo é um grupo no ledger
(contado vs esperado, diferença como pendência do motoboy).

### 4.4 CMV (Fase 5)
`insumos` (nome, unidade de compra, quantidade da compra, custo da compra, rendimento, unidade base, custo por unidade
base calculado), `insumo_custos` (histórico), `fichas_custo` (item_id, insumo_id, quantidade em unidade base),
`complemento_custos` (complemento → custo), `pedido_itens.custo_unitario_centavos` (**gravado na venda**, pelo servidor).
`itens_cardapio_gestao.preco_custo` passa a ser o custo calculado (ou manual quando não houver ficha).

### 4.5 Contas a pagar/receber + compras + DRE (Fase 5b)
`fin_fornecedores`, `fin_categorias` (plano de contas simples e editável, com padrões), `fin_contas` (pagar/receber,
descrição, fornecedor, categoria, valor, vencimento, pago_em, forma, status, recorrência, anexo, observação — status é
derivado de lançamentos; cancelar = lançamento de cancelamento), `fin_compras` + `fin_compra_itens` (insumo, quantidade,
unidade, valor) → atualiza custo do insumo (histórico) e gera conta a pagar ou movimentação do turno. Preparado para
estoque futuro (quantidades guardadas), sem controle de estoque agora.

### 4.6 Migrations previstas (cada uma com `docs/rollback/NNNN_*.down.sql`, backup antes, dry-run + conferência)
| Nº | Conteúdo | Fase |
|---|---|---|
| 0132 | flag, `fin_config`, `fin_lancamentos` (imutável + hash), `fin_aprovacoes`, `fin_alertas`; correções R1/R2/R3 (revoga escrita do navegador em `fechamentos_caixa`; entregador vira desativação em vez de delete; trava `entregador_id` depois de entregue) | 1 |
| 0133 | auditoria imutável + hash encadeado + RESTRICT; PIN; `usuarios_sessoes` | 1 |
| 0134 | caixa: colunas do turno, fechamento cego, trava de turno fechado; ledger nas RPCs de pagamento/estorno/fechar conta (só com flag) | 2 |
| 0135 | motoboy: `usuario_id`, revogação de token, registro de pagamento na entrega, `status_financeiro`, acerto no ledger | 3 |
| 0136 | relatórios (views/funções do fluxo de caixa a partir do ledger) | 4 |
| 0137 | insumos, fichas de custo, custo na venda | 5 |
| 0138 | contas a pagar/receber, fornecedores, categorias, compras | 5b |
| 0139 | alertas automáticos + relatório de risco (funções agregadas) | 6 |

---

## 5. Permissões e limites padrão (editáveis por loja)

Permissões novas (ações sensíveis em `lib/acessos.ts`, checadas no servidor e, para dinheiro, também no banco):
`financeiro_ver`, `caixa_abrir`, `caixa_fechar`, `caixa_reabrir` (só dono), `sangria`, `despesa`, `acerto_motoboy`,
`pix_conferir`, `desconto` (com limite), `taxa`, `cancelar_pedido`, `cancelar_conta`, `estornar`, `receber_pagamento`,
`aprovar`, `reimprimir`, `cardapio_editar`, `precos_editar`, `custos_editar`, `equipe_editar`, `config_editar`,
`auditoria_ver`, `contas_pagar_ver`, `contas_pagar_lancar`, `contas_marcar_pago`, `dre_ver`.

| Precisa de aprovação (PIN de outro usuário com `aprovar`) | Padrão |
|---|---|
| Desconto acima de | 10 % ou R$ 20,00 |
| Sangria / retirada / despesa acima de | R$ 100,00 |
| Fechar caixa com divergência acima de | R$ 5,00 |
| Cancelar item/pedido depois de enviado à cozinha ou depois de pago | sempre |
| Estorno / troca de forma de pagamento de pedido pago | sempre |
| Taxa manual ou preço alterado no PDV | sempre |
| Marcar como pago sem registro de recebimento | sempre |
| Reabrir caixa fechado | só o **dono**, com motivo |
| Caixa aberto há mais de / motoboy com dinheiro há mais de | 14 h / 3 h (alerta) |
| Bloqueio por inatividade | 5 min |

Perfis (modelos editáveis) seguem a Parte 2 do pedido, reaproveitando os cargos da Equipe (0128): Dono, Gerente,
Operador PDV/Caixa, Garçom (com as opções receber/desconto/taxa), Cozinha, Motoboy, Atendente, Personalizado.

---

## 6. Fases de implementação

| Fase | Entrega | Riscos tratados |
|---|---|---|
| **1. Base** | flag; ledger imutável com hash; auditoria imutável com hash e verificador; aprovação com PIN (aprovador ≠ solicitante); PIN pessoal e troca rápida de operador; bloqueio por inatividade; histórico de sessões e alerta de login simultâneo; bloquear derruba sessões (inclusive motoboy); permissões novas na Equipe; correções R1, R2, R3, R8, R9, R13, R16 | R1 R2 R3 R8 R9 R13 R16 |
| **2. Caixa** | abrir com fundo de troco ("Aberto por" automático); sem caixa aberto não recebe (com flag); sangria/reforço/despesa/retirada/perda com aprovação acima do limite; fechamento com conferência cega (dinheiro + maquininha), resumo, **modal de pendências** com ações; caixa fechado imutável; reabrir só dono; sair com caixa aberto exige justificativa; aviso no topo "Caixa aberto por X há Y"; relatório de fechamento impresso pela fila (sem mexer no recibo); ledger nas RPCs de pagamento/estorno/fechamento | R6 R7 R11 R12 R14 |
| **3. Motoboy** | login do motoboy + área PWA (entregas dele, rota no Maps/Waze, saí/entregue/não entreguei, pagamento: dinheiro com troco calculado, cartão com NSU, Pix "a conferir", não pago com motivo; "Dinheiro comigo agora"; fila offline sem duplicar); troco no despacho sai da gaveta; acerto cego com pendência; conferir Pix; loja sem motoboy/Nexta: recebimento registrado no retorno pela mesma tela; token revogável | R4 R5 R10 R15 |
| **4. Fluxo de caixa** | tabela por turno, extrato de lançamentos com quem fez/aprovou, filtros, exportar CSV/PDF | — |
| **5. Precificação/CMV** | insumos, fichas de custo (partindo da ficha de preparo), custo de complementos, margem e sugestão de preço, "Aplicar novo preço" auditado, custo gravado na venda | — |
| **5b. Contas a pagar/receber + compras + DRE** | contas, recorrência, fornecedores, categorias, compras atualizando custo/CMV, DRE com comparação | — |
| **6. Dashboard + alertas + risco** | dashboard financeiro a partir do ledger; alertas (painel e WhatsApp do dono); relatório de risco por funcionário | R17 |

Cada fase: implementação → testes (unitários, e2e com navegador desktop/celular, **tabela de tentativas de fraude**,
regressão de PDV/Mesas/Delivery/Logística/Impressão/Robô/Campanhas/Cozinha/Vitrine/Dashboard) → relatório da fase com
prints → **sua autorização** → publicação (backup + migration + deploy fora do pico + conferência na Menuzia).

---

## 7. Riscos do próprio projeto e como tratar

| Risco | Tratamento |
|---|---|
| Quebrar PDV/Mesas/Delivery ao mexer nas RPCs de dinheiro | flag: com `financeiro_ativo=false` as RPCs fazem exatamente o de hoje (o lançamento no ledger é um passo a mais, só com a flag); suítes de regressão existentes (pdv-v2 71, release-mesas 254, balcão/entrega 84, caixa 35+18…) rodam a cada fase |
| Gatilho de imutabilidade travar algo legítimo (ex.: limpeza de dados de teste, exclusão de loja) | exclusão de loja passa a exigir procedimento do superadmin (desliga gatilho dentro de transação auditada); dados de teste só no ambiente local |
| Diferença de arredondamento reais ↔ centavos | conversão única (`round(valor*100)`), testes de propriedade, conciliação automática ledger × `pagamentos_comanda` no fechamento |
| Assistente de impressão antigo não imprimir o relatório | relatório também fica em tela/PDF; impressão só para Assistente beta.9+ (não mexer no Assistente sem sua ordem) |
| Motoboy sem internet | fila local no PWA com `chave_idempotencia`; servidor ignora repetição |
| Lojas reais com caixa em uso hoje (Estância, PdR) | nada muda nelas sem a flag; a flag só liga com sua autorização |
| Volume de trabalho | entregas por fase, cada uma utilizável sozinha atrás da flag |

---

## 8. Perguntas para você decidir antes da Fase 1
1. **Caixa único por loja** (todos os terminais no mesmo turno, cada lançamento com o usuário) — ok? Alternativa: um caixa
   por operador (mais complexo; dinheiro precisa ser transferido entre caixas).
2. **Motoboy por login** (com o link/QR antigo só para ver e marcar entrega, e pagamento só pelo login) — ok?
3. **Limites padrão** da seção 5 — ok, ou quer outros valores?
4. **Alertas pelo WhatsApp do dono**: usar o WhatsApp da própria loja (robô) para mandar ao número do dono? Qual número
   na Menuzia (o de teste 5527992534407)?
5. **PIN**: 4 ou 6 dígitos? (proposta: 6, com bloqueio após 5 erros por 15 min)
6. **Garçom recebendo pagamento** (regra do salão já existe): quando o garçom recebe, o dinheiro entra na gaveta do turno
   na hora (proposta) ou fica "com o garçom" até acertar com o caixa (como o motoboy)?

---

## 9. Decisões (aprovadas em 2026-10-01)
1. **Um caixa por loja.** Cada lançamento mostra o nome de quem estava logado (da sessão, nunca do formulário).
2. **Entrega exige registro do pagamento**, tanto pelo motoboy quanto pelo operador do Kanban/Logística: forma, valor
   recebido e troco dado. A diferença do troco aparece nas pendências antes de fechar o caixa.
   O link/QR do motoboy continua valendo (passa a ser revogável); login próprio do motoboy na Fase 3.
3. **Limites padrão** da seção 5 (editáveis por loja).
4. **Alertas**: painel do dono + WhatsApp da própria loja para o número do dono (Menuzia: 5527992534407, o de teste).
5. **PIN** de 6 dígitos; 5 erros bloqueiam por 15 minutos.
6. **Garçom que recebe**: o dinheiro entra na gaveta do turno na hora.
