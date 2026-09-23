# Spec técnico final — PDV, Balcão e Mesas sobre um único motor de conta

**Menuzia · versão 1 · 2026-09-23 · status: aguardando autorização de implementação**

Este documento consolida a auditoria (aprovada como diagnóstico) com as 23 decisões
obrigatórias do dono. Nada aqui foi implementado. Nenhum arquivo do repositório,
banco ou produção foi alterado para produzi-lo. Referências usam caminhos reais do
repositório; migrations são citadas como `0072:554` (arquivo `supabase/migrations/0072_*.sql`, linha 554).

---

## Sumário

1. Correções ao relatório da auditoria
2. Achado de segurança confirmado (token de impressão entre lojas)
3. Decisões incorporadas
4. Visão da arquitetura
5. Modelo de dados final
6. Estados e transições
7. Regras de fechamento
8. Regras financeiras
9. Permissões
10. APIs e RPCs
11. Tempo real e concorrência
12. Impressão
13. Telas (wireframes textuais)
14. Compatibilidade com dados antigos
15. Transição das rotas antigas do PDV
16. Migrations
17. Etapas de implementação
18. Testes
19. Rollout
20. Rollback
21. Impacto por módulo
22. Preparação para o futuro módulo Receitas
23. Decisões que ainda exigem aprovação

---

## 1. Correções ao relatório da auditoria

| Item | Texto anterior | Correção |
|---|---|---|
| Máquina de estados (seção 8) | "Não existe máquina de estados no banco — qualquer valor é aceito." | `pedidos.status` é o enum `status_pedido` (`0003:22`: recebido, preparando, pronto, em_rota, entregue, cancelado); só esses valores são aceitos. **O problema real: qualquer transição entre valores válidos pode ser gravada sem validar o estado anterior** — por exemplo `cancelado → preparando` ou `entregue → recebido` a partir de uma aba desatualizada do Kanban (`avancarStatusPedido`, `lib/queries/pedidos.ts:319-322`, faz `update({status}).eq('id', …)` sem `.eq('status', anterior)`), e não há trigger de transição no banco. |
| Item 14 dos riscos | "Precisa ser confirmado no banco" | **Confirmado** — ver seção 2. |
| Seções 15, 17, 18 e tabelas | trechos cortados na exibição | Reconstruídas integralmente neste documento (seções 4–9, 13 e 14). |

---

## 2. Achado de segurança confirmado — `impressao_agente_token` legível entre lojas

**Verificação feita (somente leitura, transação `read only` com rollback, nenhum valor exibido):**

- Privilégio de coluna: `has_column_privilege('authenticated', 'restaurantes', 'impressao_agente_token', 'SELECT') = true`; para `anon` = `false` (a 0055 corrigiu só o anônimo).
- Policies de leitura ativas em `restaurantes`: `"Anyone can read restaurant storefront"` com `qual = true` para `public` (`0003:165-167`) e `"Tenant members can read their restaurant"` (`id = auth_restaurante_id()`). A primeira, por ser `true`, libera todas as linhas.
- Simulação de um usuário autenticado (dono) de uma loja: consegue ver **7 outras lojas**, e **4 delas com o token de impressão legível**.

**Conclusão: sim, outro tenant consegue ler a coluna.** Com o token, qualquer usuário
logado de qualquer loja pode consultar a fila de impressão de outra loja via
`/api/agente/pedidos` (que autentica só pelo token) e ver pedidos com nome, telefone e
endereço de clientes, além de marcar pedidos como impressos.

**Classificação: BLOQUEANTE (segurança).** Recomendação: tratar como Etapa 0, antes
de qualquer feature (seção 17), com:
1. revogar `SELECT (impressao_agente_token)` de `authenticated` e tirar a policy
   `using (true)` do alcance de colunas sensíveis — o caminho mais seguro é
   `revoke select on restaurantes from authenticated` + `grant select (lista de colunas públicas)`,
   espelhando a 0055, e expor o token apenas via rota de servidor para o dono;
2. **rotacionar todos os tokens de agente existentes** (já constava como pendência
   na memória do projeto: "tokens de impressão ainda por rotacionar");
3. revisar pelo mesmo critério as demais colunas não públicas de `restaurantes`
   (`evolution_instance`, pixels, flags internas).

---

## 3. Decisões incorporadas

| # | Decisão | Onde está no spec |
|---|---|---|
| 1 | Balcão = comanda avulsa, reusando o motor seguro de Mesas e Comandas | 4, 5.1 |
| 2 | Comanda própria, nome obrigatório, telefone opcional, número sequencial, 1+ pedidos, pagamento real, histórico | 5.1, 7, 8 |
| 3 | Número de balcão sequencial permanente por loja (sem reinício diário) | 5.1 (`comandas.senha`) |
| 4 | Nome e telefone são snapshot da comanda; nada em `clientes` | 5.1, 14 |
| 5 | Central de Balcão ao clicar no card preto | 13.1 |
| 6 | PDV abandona `pedidos.pago=true`; mesa e balcão usam as mesmas operações de servidor | 8, 10, 15 |
| 7 | Sem Receitas, sessão de caixa, sangria, suprimento, livro, lucro — mas pagamentos já com dados suficientes | 8.4, 22 |
| 8 | Quatro dimensões separadas | 6 |
| 9 | Fluxos por dimensão para presencial | 6 |
| 10 | Fechamento analisa saldo, pedidos, cozinha, atendimento, cancelamentos e lançamentos concorrentes | 7 |
| 11 | Fechamento normal pelo atendente | 7.2, 9 |
| 12 | Resolução forçada só dono/gerente, com motivo, auditoria e efeito financeiro | 7.4, 9 |
| 13 | Modal diferencia 6 categorias de pendência | 7.3, 13.5 |
| 14 | Fechamento considera o estado de atendimento, não só `status` | 7.1 |
| 15 | `atendente` é o operador de caixa; permissões preparadas para um papel `caixa` futuro | 9 |
| 16 | Kanban sem mudança visual | 6.5, 21 |
| 17 | Correção "qualquer valor é aceito" | 1 |
| 18 | Reconstruir trechos cortados | todo o documento |
| 19 | Confirmar vazamento do token sem mostrar valor | 2 |
| 20 | Compatibilidade detalhada | 14 |
| 21 | Transição das rotas antigas | 15 |
| 22 | Wireframes | 13 |
| 23 | Spec completo antes de implementar | este documento |

---

## 4. Visão da arquitetura

```
                ┌───────────────────────── PDV (app/admin/pdv) ─────────────────────────┐
                │  Central de Balcão   Comanda de Balcão   Comanda de Mesa   Pagamento   │
                └───────────────┬───────────────────────────┬───────────────────────────┘
                                │ fetch (sessão + papel)     │
        ┌───────────────────────▼───────────┐   ┌───────────▼────────────────────────────┐
        │ /api/admin/balcao/comandas         │   │ /api/admin/comandas/[id]  (ações)      │
        │  GET central · POST abrir          │   │  lancar · pagar · estornar · ajustar   │
        └───────────────────────┬───────────┘   │  atender · fechar · resolver · reabrir │
                                │               └───────────┬────────────────────────────┘
                                ▼                           ▼
                   lib/servicos/conta-presencial.ts  (serviço único, server-only)
                     · valida permissão (podeNoSalao / pode)   · monta ator e origem
                     · gera/valida chave de idempotência       · traduz erros das RPCs
                                │
                                ▼  RPCs SECURITY DEFINER (service_role), com FOR UPDATE
     comanda_balcao_abrir · comanda_registrar_pagamento · comanda_estornar_pagamento
     comanda_ajustar_valores · pedido_atender · pedido_transicionar · comanda_pendencias
     comanda_fechar (v2) · comanda_resolver_pendencias · comanda_reabrir
                                │
                                ▼
        comandas (tipo mesa|balcao) ─< pedidos ─< pedido_itens
                  └─< pagamentos_comanda          eventos_auditoria
```

Princípios:

- **Um motor de conta** para mesa e balcão: mesmas RPCs, mesmas regras, mesma auditoria.
  O Salão (`/admin/mesas/[id]`, rota `app/api/admin/mesas/[id]/conta/route.ts`) passa a
  delegar ao mesmo serviço — sem mudança de comportamento para o garçom.
- **O navegador nunca grava dinheiro nem estado de conta.** Tudo passa por rota de
  servidor → RPC com trava de linha.
- **Status da cozinha continua em `pedidos.status`** (enum inalterado); atendimento e
  financeiro ganham dimensões próprias.

---

## 5. Modelo de dados final

### 5.1 `comandas` (alterações)

| Coluna | Tipo | Regra |
|---|---|---|
| `tipo` | `text not null default 'mesa'` | CHECK `tipo in ('mesa','balcao')`. Default preserva todas as comandas existentes como `mesa`. |
| `mesa_id` | passa a **nullable** | CHECK `(tipo = 'mesa' and mesa_id is not null) or (tipo = 'balcao' and mesa_id is null)`. |
| `senha` | `int null` | Só balcão. Sequencial permanente por loja. UNIQUE parcial `(restaurante_id, senha) where tipo = 'balcao'`. |
| `cliente_nome` | `text null` | Snapshot. CHECK: balcão exige `length(trim(cliente_nome)) between 1 and 60`. |
| `cliente_telefone` | `text null` | Snapshot, só dígitos (10–13), opcional. **Não** cria/atualiza `clientes`. |
| `aberta_por`, `aberta_por_nome` | `uuid` FK usuarios SET NULL, `text` | Quem abriu (hoje não existe; o salão usa `responsavel_*`). |
| `reaberta_em`, `reaberta_por_nome`, `reabertura_motivo` | `timestamptz`, `text`, `text` | Última reabertura (histórico completo fica na auditoria). |

- `restaurantes.balcao_seq int not null default 0` — contador da senha, incrementado sob
  trava de linha num trigger `comanda_numerar_balcao` (mesmo padrão de `comanda_numerar`,
  `0072:55-70`). Contador separado de `comanda_seq` para a senha de balcão sair 1, 2, 3…
  sem buracos causados por comandas de mesa. `comandas.numero` continua existindo para
  todas (identificador interno único).
- Índice `comandas_mesa_aberta_unq` (`0034:16`) continua valendo (só linhas com
  `mesa_id`). Novo índice `idx_comandas_balcao_abertas (restaurante_id) where tipo='balcao' and status='aberta'`.
- Trigger `comanda_herdar_taxa` (`0067:51-63`) passa a agir **só para `tipo='mesa'`** —
  hoje ela sobrescreveria taxa 0 com a taxa padrão também no balcão.
- Status da comanda inalterado: `aberta | fechada | transferida | cancelada` (`0070:22`).
  Balcão nunca usa `transferida` (RPCs de transferência recusam `tipo='balcao'`).

### 5.2 `pedidos` (alterações — só aditivas)

| Coluna | Tipo | Regra |
|---|---|---|
| `atendimento_status` | `text null` | CHECK `in ('aguardando_servico','servido','aguardando_retirada','entregue_balcao','nao_entregue','concluido')`. **NULL para delivery** (delivery segue em `status`). |
| `atendido_em`, `atendido_por`, `atendido_por_nome` | `timestamptz`, `uuid` FK SET NULL, `text` | Quando/quem serviu ou entregou no balcão. |
| `concluido_em` | `timestamptz` | Carimbado pelo fechamento da comanda. |
| `resolvido_forcado` | `boolean not null default false` | Marca pedidos tratados por resolução forçada. |

- Valor inicial de `atendimento_status` no insert (trigger `pedido_atendimento_inicial`):
  canal `mesa` → `aguardando_servico`; canal `balcao` → `aguardando_retirada`;
  canal `delivery` → NULL. Pedidos antigos ficam NULL e são lidos por regra de
  compatibilidade (seção 14).
- `canal` (`0058`) passa a ser a fonte de verdade de presencial vs. delivery.
  Um pedido de balcão novo **sempre** tem `comanda_id` (nova CHECK:
  `canal <> 'balcao' or comanda_id is not null or criado_em < <data do corte>`; o
  corte temporal preserva balcões antigos sem comanda — seção 14).
- `pedidos.pago` e `pedidos.forma_pagamento`: **congelados como compatibilidade**; o
  motor novo não lê nem decide nada por eles (seção 14).

### 5.3 `pagamentos_comanda` (alterações)

| Coluna | Tipo | Regra |
|---|---|---|
| `canal` | `text not null` | `'mesa' | 'balcao'`, snapshot de `comandas.tipo` no momento do pagamento (preenchido pela RPC). |
| `origem` | `text not null default 'salao'` | `'pdv' | 'salao'` — de qual tela veio o pagamento. |
| `forma` | existente | Já normalizada: `dinheiro, pix, credito, debito, vale, fiado` (`0067:95-97`). Nada muda. |

Já existentes e suficientes: `restaurante_id`, `comanda_id`, `valor`, `valor_recebido`,
`troco`, `chave_idempotencia` (UNIQUE por loja), `criado_por`, `criado_por_nome`,
`criado_em`, `estornado_em`, `estornado_por_nome`, `estorno_motivo`, `observacao`.

Correção de idempotência: hoje a chave é única por loja e, se reutilizada em outra
comanda, a RPC devolve o pagamento da outra comanda (`0072:211-216`). A RPC passa a
**recusar** (`chave_em_outra_comanda`) em vez de devolver.

### 5.4 `eventos_auditoria` (sem mudança de schema)

Novas ações registradas (colunas existentes: `acao`, `entidade`, `entidade_id`,
`dados jsonb`, `usuario_*`, `papel`, `correlacao`):

`balcao.abriu`, `pedido.transicao`, `pedido.atendido`, `pedido.resolucao_forcada`,
`comanda.pagamento`, `comanda.estorno`, `comanda.fechou`, `comanda.fechou_com_resolucao`,
`comanda.reabriu`, `pedido.cancelou`, `item.cancelou`.
Todo evento de mudança de estado grava em `dados`: `estado_anterior`, `estado_novo`,
`motivo` (quando houver), `origem` (`pdv|salao|kanban|cozinha|sistema`) e, se houver
efeito financeiro, `valor_afetado` e o id do estorno/ajuste.

### 5.5 `permissoes` (código, não banco)

Novas chaves em `lib/auth/permissoes.ts` (seção 9). Nenhum enum novo de papel.

---

## 6. Estados e transições

### 6.1 As quatro dimensões

| Dimensão | Onde vive | Valores |
|---|---|---|
| **Cozinha** | `pedidos.status` (enum existente) | recebido → preparando → pronto; cancelado. (`em_rota` é só delivery.) |
| **Atendimento** | `pedidos.atendimento_status` (novo) | mesa: aguardando_servico → servido → concluido · balcão: aguardando_retirada → entregue_balcao → concluido · ambos: nao_entregue (só por resolução) |
| **Financeiro** | derivado por comanda (`comanda_totais`) | nao_pago (pago = 0) · parcial (0 < pago < total) · pago (pago = total) · estornado (houve estorno e pago < total após já ter sido pago) |
| **Comanda** | `comandas.status` | aberta → fechada · cancelada · transferida (só mesa) · fechada → aberta (reabertura, só dono/gerente) |

O financeiro **não** é gravado por pedido: dinheiro pertence à comanda. O estado
financeiro exibido por pedido na tela é o da comanda.

### 6.2 Cozinha — transições permitidas (validadas no servidor)

| De | Para | Quem |
|---|---|---|
| recebido | preparando | cozinha (estação), Kanban, aceite automático, atendente (PDV) |
| preparando | recebido | cozinha (devolver), gerente/dono |
| preparando | pronto | cozinha, Kanban, atendente (PDV) |
| recebido, preparando, pronto | cancelado | ver 7.4 e matriz (motivo obrigatório) |
| pronto | entregue | **só como efeito de atendimento** (6.3) para presencial; delivery inalterado |
| cancelado, entregue | qualquer | **proibido** (exceto reabertura de comanda, que não mexe em status de pedido) |

Implementação: RPC `pedido_transicionar(p_restaurante, p_pedido, p_de, p_para, p_ator, p_ator_nome, p_origem, p_chave)`
com `update … where id = p_pedido and status = p_de` (retorna `conflito` com o status
atual se 0 linhas) **e** trigger `pedidos_transicao_valida` (BEFORE UPDATE OF status)
que recusa transições fora da tabela, cobrindo também quem ainda grava pelo navegador
durante a transição.

### 6.3 Atendimento — transições

| De | Para | Condição | Quem |
|---|---|---|---|
| aguardando_servico | servido | `status = 'pronto'` | atendente, garçom (mesa), gerente, dono |
| aguardando_retirada | entregue_balcao | `status = 'pronto'` | atendente, gerente, dono; estação de expedição |
| servido / entregue_balcao | concluido | fechamento da comanda | sistema (RPC de fechamento) |
| aguardando_* | servido / entregue_balcao | `status in (recebido, preparando)` | **só resolução forçada** (dono/gerente, motivo) |
| aguardando_* | nao_entregue | resolução forçada | dono/gerente, motivo |

Compatibilidade com o Kanban: ao marcar `servido`/`entregue_balcao`, a RPC
`pedido_atender` também grava `status = 'entregue'`. Assim o Kanban (visual
congelado, que tira o card da coluna "Pronto" quando o status vira `entregue`)
continua funcionando igual. Para pedidos presenciais, `status = 'entregue'` passa a
significar "atendimento realizado"; a dimensão cozinha é lida como
`status in ('pronto','entregue') ⇒ cozinha concluída`.

### 6.4 Comanda — transições

| De | Para | Condição | Quem |
|---|---|---|---|
| (nova) | aberta | balcão: nome obrigatório · mesa: 1º lançamento | atendente, garçom (mesa), gerente, dono |
| aberta | fechada | regras de 7.1 | atendente (normal); gerente/dono (com resolução) |
| aberta | cancelada | nenhum pagamento ativo (`comanda_cancelar`, `0070:30`) | gerente, dono |
| aberta | transferida | só mesa (`mesa_transferir`) | conforme `comanda.transferir` |
| fechada | aberta | reabertura com motivo | gerente, dono |

### 6.5 Kanban (visual congelado)

Mudanças apenas internas:
- `avancarStatusPedido`/`marcarPedidoEntregue` no navegador passam a chamar
  `POST /api/admin/pedidos/[id]/transicao` com `{de, para}`; em conflito (409) o card
  volta ao estado real e aparece a mensagem de erro já existente (`setError`).
- O botão "Entregue" de pedidos presenciais prontos passa a chamar `pedido_atender`
  (mesmo visual, mesmo texto).
- Aceite automático passa a usar a transição com `de='recebido'` (várias abas não
  conseguem mais aceitar duas vezes).
- Nenhuma coluna, cor, cartão, botão, métrica, dimensão ou fonte muda.

---

## 7. Regras de fechamento

### 7.1 Análise (RPC `comanda_pendencias`, reutilizada pelo fechamento)

Sob `select … for update` da comanda, para cada pedido não cancelado da comanda:

| Categoria | Condição |
|---|---|
| **aguardando_aceite** | `status = 'recebido'` |
| **em_preparo** | `status = 'preparando'` |
| **pronto_nao_atendido** | `status = 'pronto'` e `atendimento_status in ('aguardando_servico','aguardando_retirada')` |
| **cancelamento_pendente** | existe `solicitacoes_cancelamento` pendente do pedido ou de item dele |

E para a comanda:

| Categoria | Condição |
|---|---|
| **atendido_nao_pago** | nenhuma pendência acima e `pago = 0` e `total > 0` |
| **parcialmente_pago** | `0 < pago < total` |

Retorno: lista de pedidos pendentes com número, itens (nome × qtd, cancelados à
parte), categoria, estado da cozinha, estado de atendimento, tempo desde
`criado_em`/`preparando_em`/`pronto_em`, valor, `criado_por_nome`, e o resumo
financeiro da comanda (`total`, `pago`, `restante`, formas usadas).

### 7.2 Fechamento normal — `comanda_fechar` v2

Permitido quando **tudo** é verdade (checado dentro da mesma transação, com a
comanda travada):
1. comanda `aberta`;
2. nenhum pedido em aguardando_aceite, em_preparo, pronto_nao_atendido;
3. nenhum cancelamento pendente;
4. `restante = 0` (`comanda_totais`);
5. todos os pedidos não cancelados com `atendimento_status in ('servido','entregue_balcao')`
   ou pedido legado (seção 14).

Efeitos atômicos: `comandas.status='fechada'`, `fechada_em/por/por_nome`,
`total_final`; pedidos atendidos → `atendimento_status='concluido'`, `concluido_em`;
compatibilidade `pedidos.pago = true` (como hoje, `0072:554`); encerra
`sessoes_mesa`, `selecoes_mesa`, `chamados_mesa` (como hoje); auditoria
`comanda.fechou`. **A mesa só aparece livre depois do commit** (o estado da mesa é
derivado de "tem comanda aberta"; enquanto a transação não termina, a comanda
continua aberta para qualquer leitor).

Se alguma condição falha: não fecha; retorna `{ok:false, pendencias:[…]}` (HTTP 409)
e a tela abre o aviso de pendências (13.5).

### 7.3 Concorrência no fechamento

- Novo lançamento enquanto fecha: trigger `pedidos_exige_comanda_aberta` (BEFORE
  INSERT em `pedidos` com `comanda_id`): `select 1 from comandas where id = new.comanda_id and status = 'aberta' for update`
  — espera o fechamento terminar e, se fechou, recusa com `comanda_fechada`. O
  lançamento do garçom/PDV recebe 409 e a tela avisa "a conta foi fechada".
- Dois caixas fechando: o segundo espera a trava e recebe `comanda_nao_aberta` (409).
- Clique duplo: chave de idempotência por ação (seção 11).

### 7.4 Resolução forçada — `comanda_resolver_pendencias` (dono/gerente)

Entrada: `p_comanda`, `p_acoes jsonb` = lista de `{pedido_id, acao, item_ids?}`,
`p_motivo` (obrigatório, ≥ 5 caracteres), `p_confirmacao` (true), `p_chave`.

| Ação | Para quem | Efeito |
|---|---|---|
| `marcar_atendido` | pedido pronto | igual ao atendimento normal (não exige motivo se só isso) |
| `forcar_atendido` | pedido recebido/preparando | atendimento → servido/entregue_balcao, `status → entregue`, `resolvido_forcado = true` — **nunca silencioso**: exige motivo e confirmação |
| `nao_entregue` | pedido não atendido | atendimento → `nao_entregue`; valor segue na conta (cobra-se ou ajusta-se explicitamente) |
| `cancelar_pedido` / `cancelar_itens` | qualquer não cancelado | cancela com motivo; se a soma já paga passar a exceder o novo total, a RPC **recusa** com `ajuste_financeiro_necessario` e o valor excedente — o operador precisa antes registrar estorno (`comanda_estornar_pagamento`) ou desconto/ajuste (`comanda_ajustar_valores`), ambos auditados |

Tudo na mesma transação com a comanda travada. Auditoria por pedido afetado:
`pedido.resolucao_forcada` com estado anterior (cozinha + atendimento), estado novo,
operador, papel, data, motivo, origem (`pdv|salao`) e efeito financeiro. Depois da
resolução, o fechamento normal (7.2) é tentado na mesma chamada se o operador
escolheu "resolver e fechar".

### 7.5 Reabertura — `comanda_reabrir` (dono/gerente)

`fechada → aberta` com motivo; não mexe em pagamentos nem em status de pedidos;
limpa `fechada_*` e `total_final`; grava `reaberta_*`; atendimentos `concluido` voltam
para `servido`/`entregue_balcao`; recusa se a mesa (tipo mesa) já tiver outra comanda
aberta; auditoria `comanda.reabriu`.

---

## 8. Regras financeiras

### 8.1 Total e saldo
Sempre `comanda_totais` (servidor): subtotal (itens não cancelados; `preco_unitario`
já inclui complementos) + taxa de serviço (%) − desconto (valor ou %, limitado a
subtotal + taxa) = total; `pago` = soma de pagamentos não estornados; `restante = max(total − pago, 0)`.
O navegador exibe, nunca decide.

### 8.2 Pagamento
`comanda_registrar_pagamento` (existente, `0072:198`), mais `canal`/`origem`:
- forma ∈ `formas_pagamento_mesa` da loja (validação já existe na rota do salão; a
  lista passa a valer também para balcão — decisão pendente 23.4);
- valor > 0 e ≤ restante (sem pagamento acima do saldo);
- dinheiro: `valor_recebido ≥ valor`, troco calculado no servidor;
- fiado exige observação (regra atual);
- idempotente por chave UUID gerada pela tela a cada intenção de pagamento.

Pagamento parcial e múltiplas formas: vários registros; fecha quando `restante = 0`.

### 8.3 Desconto, taxa, estorno
- Desconto e taxa: `comanda_ajustar_valores` (motivo obrigatório para desconto;
  recusa se o já pago exceder o novo total). Atendente só aplica desconto se
  `salao_caixa_desconto` estiver ligado (regra atual).
- Balcão nasce com taxa 0 (trigger ajustado); ajuste de taxa em balcão fica
  disponível para gerente/dono.
- Estorno: `comanda_estornar_pagamento`, dono/gerente, motivo obrigatório, só com
  comanda aberta (para estornar comanda fechada: reabrir → estornar → fechar, tudo
  auditado).

### 8.4 Dados gravados por pagamento (para o futuro Receitas)
restaurante, comanda, canal (`mesa|balcao`), origem (`pdv|salao`), forma normalizada,
valor, valor recebido, troco, operador (id + nome + papel via auditoria), data/hora,
chave de idempotência, observação; estorno com autor, data e motivo.

---

## 9. Permissões

### 9.1 Novas chaves de permissão (código)

| Chave | dono | gerente | atendente (caixa) | garçom | cozinha |
|---|---|---|---|---|---|
| `balcao.abrir` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `balcao.lancar` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `pedidos.presencial.transicionar` (aceitar/preparar/pronto pelo PDV) | ✅ | ✅ | ✅ | ❌ | ❌ |
| `pedidos.presencial.atender` (servir / entregar no balcão, pedido pronto) | ✅ | ✅ | ✅ | ✅ (só mesa) | ❌ |
| `comanda.pagar` (registrar pagamento) | ✅ | ✅ | ✅ | se `salao_garcom_recebe` | ❌ |
| `comanda.fechar` (fechamento normal) | ✅ | ✅ | ✅ | se `salao_garcom_recebe` | ❌ |
| `comanda.desconto` | ✅ | ✅ | se `salao_caixa_desconto` | ❌ | ❌ |
| `comanda.estornar` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `comanda.resolver_forcado` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `comanda.reabrir` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `pedidos.presencial.cancelar` (não pago) | ✅ | ✅ | ❌ (solicita) | ❌ (solicita) | ❌ |
| `pedidos.presencial.cancelar_pago` | ✅ | ✅ | ❌ | ❌ | ❌ |

A estação da cozinha continua autenticando por token (`/api/cozinha/[token]`) e só
faz transições de cozinha (`lib/cozinha/modo.ts`), agora também validadas pela trigger.

### 9.2 Papel `caixa` futuro
As telas e rotas checam **chaves de permissão**, nunca o nome do papel. Criar o papel
`caixa` depois = adicionar o valor ao enum `papel_usuario` (migration isolada, como a
`0057`) e incluí-lo nas listas acima, sem tocar em telas ou RPCs.

### 9.3 Correções de autorização incluídas
- `/api/admin/pedidos/[id]/cancelar` passa a checar o `canal` do pedido
  (hoje o atendente cancela pedido de mesa por ela).
- `/api/admin/pdv/pedido/[id]/cancelar` (legado) exige motivo, checa status e
  permissão, e zera `reimprimir` até ser desligada.
- Rotas do PDV passam a validar permissão dentro do handler (hoje só o middleware).

---

## 10. APIs e RPCs

### 10.1 Rotas novas (server, sessão obrigatória, loja da sessão, nunca do corpo)

| Rota | Método | Corpo | Permissão | Chama |
|---|---|---|---|---|
| `/api/admin/balcao/comandas` | GET | — | `balcao.abrir` | lista da central (seção 13.1) |
| `/api/admin/balcao/comandas` | POST | `{nome, telefone?, chave}` | `balcao.abrir` | `comanda_balcao_abrir` |
| `/api/admin/comandas/[id]` | GET | — | `comanda.ver` | conta completa (itens, pedidos, estados, pagamentos, histórico) |
| `/api/admin/comandas/[id]/lancamento` | POST | `{itens[], observacao?, chave}` | `balcao.lancar` / `pedidos.mesa.enviar_cozinha` | serviço de lançamento (mesmo saneamento de `lib/lancamento-mesa.ts`) |
| `/api/admin/comandas/[id]` | POST | `{acao, …, chave}` | por ação | serviço de conta |

Ações do POST `/api/admin/comandas/[id]`: `pagamento`, `estorno`, `ajustar_valores`,
`atender` (`{pedido_id}`), `transicionar` (`{pedido_id, de, para}`),
`pendencias` (leitura), `fechar`, `resolver` (`{acoes[], motivo, fechar?}`),
`reabrir` (`{motivo}`), `cancelar_pedido`, `cancelar_item`, `reimprimir`.

`/api/admin/pedidos/[id]/transicao` (POST `{de, para}`) — usado pelo Kanban.

A rota atual `app/api/admin/mesas/[id]/conta/route.ts` passa a delegar ao mesmo
serviço (contrato HTTP inalterado para as telas do salão).

### 10.2 RPCs (todas SECURITY DEFINER, `execute` só para `service_role`)

| RPC | Status | Resumo |
|---|---|---|
| `comanda_balcao_abrir(p_restaurante, p_nome, p_telefone, p_ator, p_ator_nome, p_chave)` | nova | cria comanda `tipo='balcao'`, senha, auditoria `balcao.abriu`; idempotente |
| `pedido_transicionar(…)` | nova | 6.2 |
| `pedido_atender(p_restaurante, p_pedido, p_ator, p_ator_nome, p_origem, p_chave)` | nova | 6.3 |
| `comanda_pendencias(p_restaurante, p_comanda)` | nova | 7.1 (somente leitura) |
| `comanda_fechar` | nova versão | 7.2 (assinatura atual `0072:523` mantida + `p_origem`) |
| `comanda_resolver_pendencias(…)` | nova | 7.4 |
| `comanda_reabrir(…)` | nova | 7.5 |
| `comanda_registrar_pagamento` | nova versão | + `canal`, `origem`; chave de outra comanda é recusada |
| `comanda_totais`, `comanda_ajustar_valores`, `comanda_estornar_pagamento`, `comanda_cancelar`, `item_cancelar`, `pedido_mesa_cancelar`, `cancelamento_*` | existentes | passam a aceitar `tipo='balcao'` onde fizer sentido; transferências recusam balcão |

---

## 11. Tempo real e concorrência

| Tema | Solução |
|---|---|
| Atualização PDV ↔ Kanban ↔ cozinha | publicar `comandas` e `pagamentos_comanda` no `supabase_realtime`; PDV passa a usar `useRealtimeComFallback` (`lib/realtime-fallback.ts`) em vez do canal simples (`app/admin/pdv/page.tsx:891-909`) |
| Evento fora de ordem | a tela nunca aplica o payload do Realtime diretamente: evento = "recarregar"; leitura com guarda de sequência (padrão `refetchSeq` do Kanban) |
| Clique duplo / reenvio | chave UUID por intenção (abrir, lançar, pagar, fechar, resolver, reabrir); índices únicos já existentes para pedidos (`0065:28`) e pagamentos (`0067:105`); novas ações gravam a chave em `eventos_auditoria.dados` e a RPC confere antes de agir |
| Cozinha × PDV no mesmo pedido | `pedido_transicionar` com `where status = de` + trigger; perdedor recebe 409 com o estado atual |
| Dois caixas fechando | `for update` na comanda (7.3) |
| Garçom lançando durante fechamento | trigger `pedidos_exige_comanda_aberta` (7.3) |
| Pedido de outra loja | todas as RPCs recebem `p_restaurante` da sessão e filtram por ele (padrão atual) |
| Adulteração de preço/origem/canal/status | preço recalculado em `criarPedido`; `origem`, `canal`, `tipo`, `comanda_id` definidos no servidor; corpo do PDV passa a ter lista fechada de campos (hoje `...rest`) |
| Operador sem permissão digitando a URL | middleware (`lib/auth/rotas.ts`) + checagem no handler + RLS |
| Falha no meio | cada RPC é uma transação; lançamento (pedido + itens) passa a ser uma RPC única `comanda_lancar` para não haver pedido sem itens |
| Impressão antes de rollback | a impressão só enxerga pedidos commitados (o agente consulta por HTTP); rollback nunca imprime |

---

## 12. Impressão (layout intocado — CLAUDE.md §7)

- Nenhuma mudança em `printer-agent`/`recibo.js`, fonte, colunas, conteúdo ou ordem.
- Pedido de balcão novo imprime como qualquer pedido (`cliente_nome` = nome da
  comanda, `mesa` = NULL). **A senha de balcão não aparece no recibo** a menos que
  você autorize explicitamente (decisão 23.2).
- Só lógica de disparo (permitida pelo §7), proposta para etapa própria:
  - todo cancelamento (inclusive PDV legado e entregador `/problema`) zera `reimprimir`;
  - pedido que chegou a `pronto` sem `impresso` dentro da janela entra na fila
    (decisão 23.6).

---

## 13. Telas (wireframes textuais)

### 13.1 Central de Balcão (clique no card preto "Balcão")

```
┌ PDV › Balcão ────────────────────────────────────────────────────────── [ + Novo pedido ] ┐
│ Buscar por nome ou senha…                                  Abertas 3 · Hoje R$ 1.284,50  │
├───────┬──────────────┬───────┬───────┬──────┬──────────┬───────────┬──────────┬───────────┬─────────┤
│ Senha │ Nome         │ Aberta│ Tempo │ Ped. │ Valor    │ Cozinha   │ Atend.   │ Financeiro│         │
├───────┼──────────────┼───────┼───────┼──────┼──────────┼───────────┼──────────┼───────────┼─────────┤
│ 128   │ João         │ 19:02 │ 18min │  2   │ R$ 64,90 │ 1 preparo │ aguard.  │ não pago  │ [Abrir] │
│ 127   │ Ana ·(27)…21 │ 18:55 │ 25min │  1   │ R$ 32,00 │ pronto    │ aguard.  │ pago      │ [Abrir] │
│ 126   │ Pedro        │ 18:40 │ 40min │  1   │ R$ 18,00 │ pronto    │ entregue │ parcial   │ [Abrir] │
└───────┴──────────────┴───────┴───────┴──────┴──────────┴───────────┴──────────┴───────────┴─────────┘
  Cores/selos seguem o padrão do painel (Badge), ordenado pelo mais antigo.
  Clique na linha ou em [Abrir] → 13.3 (tipo balcão).
```

### 13.2 Nova comanda de Balcão

```
┌ Novo pedido de balcão ─────────────────────── × ┐
│ Nome do cliente *   [ João                   ]  │
│ Telefone (opcional) [ (27) 9____-____        ]  │
│  Não cria cadastro de cliente; fica só neste    │
│  atendimento.                                   │
│                                                 │
│ Senha será gerada ao abrir (próxima: 129)       │
│                     [Cancelar] [Abrir e lançar] │
└─────────────────────────────────────────────────┘
  "Abrir e lançar" cria a comanda (idempotente) e vai para o cardápio do PDV
  com a comanda selecionada; o lançamento usa /comandas/[id]/lancamento.
```

### 13.3 Comanda no PDV (mesa ou balcão — mesma tela)

```
┌ Balcão · Senha 128 · João · aberta 19:02 (18min) ─────────── [Histórico] ┐
│ Cozinha: 1 em preparo · Atendimento: 1 aguardando · Financeiro: não pago  │
├───────────────────────────────────────────────────────────────────────────┤
│ #412  19:03  por Carla        preparando   aguardando retirada  R$ 42,90  │
│   2× X-Burguer (+Bacon)                                                   │
│   1× Coca lata                                                            │
│   [Marcar pronto]                                    [Cancelar…]           │
│ #415  19:15  por Carla        pronto       aguardando retirada  R$ 22,00  │
│   1× Batata turbinada                                                     │
│   [Entregue no balcão]                               [Cancelar…]           │
├───────────────────────────────────────────────────────────────────────────┤
│ Subtotal R$ 64,90 · Taxa R$ 0,00 · Desconto R$ 0,00 · Total R$ 64,90      │
│ Pago R$ 0,00 · Restante R$ 64,90                                          │
│ [+ Lançar itens]  [Receber]  [Fechar conta]                               │
└───────────────────────────────────────────────────────────────────────────┘
  Mesa: cabeçalho "Mesa 03 · Comanda 57 · Resp. Maria · 4 pessoas",
  atendimento "aguardando serviço → [Servido]".
  Botões aparecem conforme permissão; ações desabilitam durante a requisição.
```

### 13.4 Pagamento

```
┌ Receber · Balcão 128 · João ───────────────────── × ┐
│ Restante: R$ 64,90                                   │
│ Forma:  (•) Dinheiro ( ) Pix ( ) Débito ( ) Crédito  │
│         ( ) Vale                                     │
│ Valor a pagar  [ 64,90 ]  (máx. R$ 64,90)            │
│ Recebido       [ 100,00 ] → Troco R$ 35,10           │
│ Observação     [                           ]         │
│ Pagamentos já feitos: —                              │
│               [Cancelar] [Registrar pagamento]       │
│               [Registrar e fechar conta]             │
└──────────────────────────────────────────────────────┘
  Valor, troco e saldo recalculados no servidor; a tela só antecipa.
  "Registrar e fechar" = pagamento + tentativa de fechamento; se houver
  pendência, o pagamento fica gravado e abre 13.5.
```

### 13.5 Aviso de pendências (fechamento bloqueado)

```
┌ Não dá para fechar ainda · Mesa 03 ─────────────────────────────────── × ┐
│ Aguardando aceite (1)                                                     │
│   #420 · 2min · R$ 18,00 · por Maria · 1× Pudim                           │
│ Em preparo (1)                                                            │
│   #418 · 12min · R$ 45,00 · por Maria · 1× Picanha, 1× Suco               │
│ Pronto, não servido (1)                                                   │
│   #415 · pronto há 3min · R$ 22,00 · 1× Batata      [Marcar servido]      │
│ Cancelamento pendente (1)                                                 │
│   #410 · item 1× Coca · pedido por João (garçom)    [Decidir]             │
│ Financeiro: parcialmente pago · Pago R$ 40,00 de R$ 105,00 · falta R$ 65  │
│                                                                           │
│ [Voltar sem fechar] [Abrir pedidos pendentes] [Receber restante]          │
│ [Resolver pendências…]  (só gerente/dono)                                 │
└───────────────────────────────────────────────────────────────────────────┘
  "Servido, mas não pago" aparece quando só o financeiro impede o fechamento.
```

### 13.6 Resolução forçada (gerente/dono)

```
┌ Resolver pendências · Mesa 03 ───────────────────────────────────────── × ┐
│ #418 em preparo   ( ) Manter  ( ) Forçar servido  ( ) Não entregue        │
│                   ( ) Cancelar pedido                                     │
│ #420 aguardando   ( ) Manter  ( ) Cancelar pedido                         │
│                                                                           │
│ ⚠ Cancelar #418 reduz o total para R$ 60,00, mas já foram pagos R$ 80,00. │
│   Registre antes um estorno de R$ 20,00 ou um ajuste.  [Estornar…]        │
│                                                                           │
│ Motivo * [ Cliente foi embora antes do prato sair            ]            │
│ [x] Confirmo que estas ações ficam registradas com meu nome               │
│                        [Voltar] [Aplicar] [Aplicar e fechar conta]        │
└───────────────────────────────────────────────────────────────────────────┘
```

### 13.7 Histórico da comanda

```
┌ Histórico · Balcão 128 · João ──────────────────────────────────────── × ┐
│ 19:02  Carla (atendente)   Abriu a comanda (senha 128)                    │
│ 19:03  Carla (atendente)   Lançou #412 — 2× X-Burguer, 1× Coca  R$ 42,90   │
│ 19:04  Cozinha             #412 recebido → preparando                     │
│ 19:14  Cozinha             #412 preparando → pronto                       │
│ 19:16  Carla (atendente)   #412 entregue no balcão                        │
│ 19:20  Carla (atendente)   Pagamento Dinheiro R$ 64,90 (recebido 100,00,  │
│                            troco 35,10)                                   │
│ 19:20  Carla (atendente)   Fechou a conta · total R$ 64,90                │
└───────────────────────────────────────────────────────────────────────────┘
  Fonte: eventos_auditoria (+ carimbos de 0078 para a cozinha). Mesma
  estrutura de lib/queries/conta.ts historicoDaConta/montarHistorico.
```

---

## 14. Compatibilidade com dados antigos

| Dado | Regra |
|---|---|
| `pedidos.pago` | Congelado como compatibilidade. Continua sendo gravado `true` pelo fechamento (como hoje) para relatórios antigos, mas **nenhuma decisão nova** depende dele. Delivery mantém a semântica atual (`pago` = Pix na criação). |
| `pedidos.forma_pagamento` | Delivery: continua sendo a forma do pedido. Mesa/balcão: ignorado (hoje é sempre `dinheiro` fixo, sem significado). Nenhum backfill. Telas novas mostram as formas de `pagamentos_comanda`. |
| Comandas antigas (todas `mesa`) | `tipo` default `'mesa'`; nada muda. As **fechadas pelo PDV legado** (sem registro em `pagamentos_comanda` e sem `total_final`) aparecem no histórico como "Fechada pelo PDV antigo — pagamento não registrado" e ficam fora de somatórios financeiros novos (entram como "legado sem pagamento"). |
| Comandas abertas no momento do deploy | Seguem abertas; passam a usar o motor novo no próximo pagamento/fechamento. Pedidos delas com `atendimento_status` NULL são tratados como legado (abaixo). |
| Pedidos de balcão sem comanda (legado) | Permanecem sem comanda (CHECK com corte temporal). Não aparecem na Central de Balcão; aparecem no Kanban e no histórico como hoje. Não recebem pagamento retroativo. |
| Pedidos já entregues | `atendimento_status` NULL + `status='entregue'` ⇒ lido como "atendimento realizado (legado)". Nenhum backfill. |
| Pedidos presenciais antigos em aberto (NULL + recebido/preparando/pronto) | Tratados pelas mesmas categorias de pendência (7.1) usando `status`; ao serem atendidos pelo PDV novo ganham `atendimento_status`. |
| Pagamentos já existentes (`pagamentos_comanda`) | Válidos como estão. `canal`/`origem` novos: backfill **aditivo e seguro** — `canal='mesa'` (única opção possível antes) e `origem='salao'` (antes só o salão gravava pagamentos). Não altera valores. |
| Fidelidade | Continua pulando `origem='pdv'` (`lib/fidelidade.ts:72`); balcão não entra em fidelidade (sem cadastro, decisão 4). |

---

## 15. Transição das rotas antigas do PDV para o serviço compartilhado

| Item | Plano |
|---|---|
| Rotas antigas | `/api/admin/pdv/comanda/[id]/pagar`, `/api/admin/pdv/comanda/[id]/fechar`, `/api/admin/pdv/pedido/[id]/cancelar`, e o balcão sem comanda em `/api/admin/pdv/pedido` |
| Feature flag | `restaurantes.pdv_v2 boolean not null default false` (por loja; protegida na trigger `restaurantes_protege_salao` para o navegador não ligar sozinho). Com `false`, o PDV funciona como hoje; com `true`, usa Central de Balcão e o motor novo. |
| Convivência | Mínimo **14 dias** com as duas versões no ar: 1ª semana só na loja MENUZIA (teste), 2ª semana em 1–2 lojas piloto, depois todas. |
| Endurecimento imediato das antigas (antes do v2) | `/pagar` passa a recusar (410) quando `pdv_v2` está ligado; `/fechar` passa a exigir saldo zero via `comanda_totais` e registrar autor/`total_final`; `/cancelar` exige motivo e checa status — reduz o risco enquanto convivem. |
| Telemetria | cada chamada às rotas antigas grava `eventos_auditoria` com `acao='pdv_legado.<rota>'` (loja, usuário, resultado); painel de acompanhamento = consulta por loja/dia. Nas rotas novas: contagem de 409 (conflitos), 4xx de validação e fechamentos bloqueados por pendência. |
| Critério para desligar | 14 dias corridos sem **nenhuma** chamada às rotas antigas em lojas com `pdv_v2 = true`; todas as lojas ativas com `pdv_v2 = true` há ≥ 7 dias; zero incidentes abertos de pagamento/fechamento. Então: rotas antigas retornam 410 e, na versão seguinte, são removidas. |
| Rollback | desligar `pdv_v2` na loja (volta ao fluxo antigo endurecido na hora, sem deploy). Os dados gravados pelo v2 (comandas de balcão, pagamentos) continuam válidos e visíveis no salão/histórico. |

---

## 16. Migrations

Todas aditivas e compatíveis com o código anterior (o deploy pode vir antes ou
depois de cada uma, salvo onde indicado).

| Nº | Conteúdo | Ordem vs. deploy |
|---|---|---|
| 0080 | **Segurança:** restringir `SELECT` de `restaurantes` para `authenticated` por coluna (espelho da 0055) ou policy de loja; token de agente só via rota do dono | antes do deploy que usa a rota nova do token; testar leitura do painel |
| 0081 | `pedidos`: trigger `pedidos_transicao_valida` (tabela de transições); `unique (restaurante_id, numero)` **somente após** corrigir duplicados existentes (a verificar; se houver, índice parcial a partir de um corte) | independente |
| 0082 | `comandas`: `tipo`, `mesa_id` nullable + CHECK, `senha`, `cliente_nome`, `cliente_telefone`, `aberta_por*`, `reaberta_*`; `restaurantes.balcao_seq`, `restaurantes.pdv_v2`; triggers `comanda_numerar_balcao` e `comanda_herdar_taxa` só para mesa | antes do deploy do v2 |
| 0083 | `pedidos`: `atendimento_status`, `atendido_*`, `concluido_em`, `resolvido_forcado`; trigger `pedido_atendimento_inicial`; trigger `pedidos_exige_comanda_aberta`; CHECK de balcão com comanda (corte temporal) | antes do v2 |
| 0084 | `pagamentos_comanda`: `canal`, `origem` + backfill aditivo | antes do v2 |
| 0085 | RPCs: `comanda_balcao_abrir`, `comanda_lancar`, `pedido_transicionar`, `pedido_atender`, `comanda_pendencias`, `comanda_fechar` v2, `comanda_resolver_pendencias`, `comanda_reabrir`, `comanda_registrar_pagamento` v2; grants só `service_role` | antes do v2 |
| 0086 | Realtime: `alter publication supabase_realtime add table comandas, pagamentos_comanda` | antes do v2 |
| 0087 (fase final) | revogar do `authenticated` o `UPDATE (status)` em `pedidos` (0061:61-70) quando nenhum código escrever status pelo navegador | só depois do critério da seção 15 |

---

## 17. Etapas de implementação (cada uma com validação sua antes da próxima)

| Etapa | Entrega | Validação |
|---|---|---|
| **0 — Segurança** | 0080; rotacionar tokens de agente; rota de cancelar checa canal; cancelamento PDV legado com motivo/status/`reimprimir`; corpo do PDV com campos fechados | teste de leitura entre lojas = 0; agentes das lojas reconfigurados |
| **1 — Transições seguras** | 0081; `pedido_transicionar`; Kanban e aceite automático usam a rota nova (sem mudança visual) | Kanban idêntico em screenshot; 409 em aba velha |
| **2 — Modelo presencial** | 0082–0084; `pedido_atender`; estados de atendimento no Kanban "Entregue" presencial (mesmo botão) | pedidos antigos inalterados; novos com atendimento |
| **3 — Serviço compartilhado** | `lib/servicos/conta-presencial.ts`; 0085/0086; rota do salão delega; `/api/admin/comandas/[id]` | salão funcionando igual (regressão) |
| **4 — PDV v2 mesa** | comanda de mesa no PDV (13.3), pagamento (13.4), pendências (13.5), histórico (13.7), atrás de `pdv_v2` | E2E mesa completa na loja teste |
| **5 — Balcão** | Central (13.1), nova comanda (13.2), lançamento por comanda | E2E balcão com 3 atendimentos simultâneos |
| **6 — Resolução e reabertura** | 13.6, `comanda_resolver_pendencias`, `comanda_reabrir` | E2E dos cenários forçados com efeito financeiro |
| **7 — Rollout e desligamento** | seção 15; 0087 | critério de desligamento atingido |

---

## 18. Testes

**Unitários (vitest, sem rede):** tabela de transições (cozinha, atendimento, comanda);
classificação de pendências (7.1) incluindo legado NULL; permissões por papel e
regras de loja (`podeNoSalao`) com as chaves novas; montagem do resumo financeiro;
saneamento do corpo do PDV (campos fechados); formatação do histórico.

**Integração (Supabase local — nunca produção):**
- RPCs com concorrência real: dois `comanda_fechar` simultâneos; lançamento durante
  fechamento; pagamento repetido com a mesma chave; chave reutilizada em outra
  comanda; transição concorrente cozinha × PDV; cancelar item pago sem ajuste
  (deve recusar); reabrir com mesa já ocupada (deve recusar).
- RLS/grants: leitura de `restaurantes` entre lojas; atendente tentando cancelar
  pedido de mesa; garçom tentando pagar sem `salao_garcom_recebe`.
- Trigger de transição: todas as transições proibidas recusadas.

**E2E (Playwright, loja de teste, ambiente de homologação):**
- Balcão: 3 atendimentos simultâneos, pagamentos em formas diferentes, troco, fechamento.
- Mesa: 3 lançamentos em momentos distintos, pagamento dividido, pendência "pronto
  não servido", servir, fechar; mesa volta a livre só depois do fechamento.
- Resolução forçada com estorno.
- Kanban: screenshot comparado antes/depois (visual congelado) e conflito 409.
- Impressão: fila recebe pedidos de balcão/mesa; nenhum pedido cancelado imprime.

---

## 19. Rollout

1. Etapas 0–3 vão a produção sem flag (não mudam fluxo visível; só endurecem).
2. Etapas 4–6 atrás de `restaurantes.pdv_v2`: MENUZIA (teste) → 1–2 lojas piloto
   com salão ativo → todas.
3. Acompanhamento diário pela telemetria (seção 15) durante a convivência.
4. Deploy no padrão atual (Coolify, Redeploy manual), migrations aplicadas antes do
   deploy correspondente conforme a tabela da seção 16.

---

## 20. Rollback

| Camada | Como voltar |
|---|---|
| Fluxo do PDV | desligar `pdv_v2` por loja (imediato, sem deploy) |
| Código | reverter o commit/deploy; como as migrations são aditivas, o código anterior funciona com o banco novo |
| Trigger de transição (0081) | `drop trigger pedidos_transicao_valida` (uma linha) se bloquear algum fluxo não mapeado |
| Revogação de `status` (0087) | `grant update (status) on pedidos to authenticated` |
| Dados | nenhuma migration converte formato de dado existente; nada a desfazer em dados |

---

## 21. Impacto por módulo

| Módulo | Impacto |
|---|---|
| **Delivery** | status e fluxo iguais; trigger de transição precisa cobrir Logística, Nexta (`lib/nexta-estados.ts`), entregador e `saiu-entrega` — todos já fazem transições válidas |
| **Cozinha (estações)** | telas iguais; transições passam pela trigger; expedição marca `entregue_balcao` via `pedido_atender` |
| **Impressão** | layout intocado; só gatilhos de fila (seção 12) |
| **Salão (garçom)** | mesmas telas; rota da conta delega ao serviço comum; ganha "Servido" e pendências no fechamento |
| **Logística** | nenhum: filtros por `tipo='entrega'` (`listarPedidosLogistica`) mantêm balcão/mesa fora |
| **Kanban** | sem mudança visual; conflitos 409; botão "Entregue" presencial passa a registrar atendimento |
| **Dashboard** | sem mudança agora; futuramente passa a ler pagamentos reais do salão/balcão |

---

## 22. Preparação para o futuro módulo Receitas

Com este spec, cada pagamento presencial já registra: restaurante, comanda, canal,
origem, forma normalizada, valor, recebido, troco, operador, data/hora, chave e
estorno (autor, data, motivo). O delivery continua com a forma no pedido.

Quando o módulo Receitas for autorizado, recomenda-se **não** somar a partir do
estado atual dos pedidos (que muda com cancelamento, transferência e reabertura), e
sim criar:
- `movimentos_financeiros` append-only (tipo: pagamento, estorno, sangria,
  suprimento, ajuste; canal; forma; valor; referência; sessão de caixa; autor;
  chave única), alimentado pelas mesmas RPCs;
- `sessoes_caixa` (abertura, valor inicial, fechamento, contado, divergência);
- registro do pagamento efetivo do delivery (hoje só existe o `pago` do Pix na
  criação) e custo dos itens para lucro.

Nada disso é criado agora (decisão 7).

---

## 23. Decisões que ainda exigem sua aprovação

1. **Autorizar a Etapa 0 (segurança) antes de tudo**, incluindo a rotação dos
   tokens de agente das lojas (os agentes instalados precisarão receber o token novo).
2. **Senha de balcão no recibo impresso:** mostrar ou não. Mostrar muda o conteúdo
   impresso (§7 do CLAUDE.md exige pedido explícito).
3. **Contador da senha:** separado das comandas de mesa (proposto: `balcao_seq`,
   senha 1, 2, 3…) ou compartilhado com `comandas.numero`.
4. **Formas de pagamento do balcão:** usar a mesma lista da loja
   (`formas_pagamento_mesa`) ou uma lista própria.
5. **Taxa de serviço no balcão:** proposto sempre 0 na abertura, ajustável só por
   gerente/dono.
6. **Pedido pronto sem impressão:** incluir na fila (mudança só de gatilho).
7. **Cancelamento pelo atendente:** proposto "solicita, gerente decide" para
   presencial (igual ao garçom); alternativa é permitir cancelar pedido **não pago**
   diretamente.
8. **Janela de convivência:** 14 dias propostos.
9. **Unicidade de `pedidos.numero`:** autorizar a verificação de duplicados
   existentes (somente leitura) antes de propor o índice.
