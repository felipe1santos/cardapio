# Pix online (Mercado Pago) — plano

Versão 1, 2026-10-04. **Nada implementado ainda: este plano espera a revisão do dono.** Ele usa o
que existe hoje: o financeiro das fases 1 a 6 (livro-caixa `fin_lancamentos` com cadeia de hash,
turnos `caixa_turnos`, aprovações com PIN em `fin_aprovacoes`, alertas `fin_alertas`, auditoria
`eventos_auditoria`).

> Não havia plano anterior em `docs/`. A única menção era no plano do financeiro: "Pix online
> (quando existir) só é confirmado pela API do provedor". Este documento parte daí.

## 0. Como é hoje (o que muda o desenho)

- O pedido da vitrine nasce em `status='recebido'` (`lib/queries/pedidos.ts`, `criarPedido`) e, na
  mesma requisição, dispara tudo: Kanban/alarme (tempo real), cozinha, fila de impressão
  (`impressao_elegiveis` pega `recebido`), WhatsApp "recebido", Purchase do Meta CAPI e Pixel,
  e a atribuição do push.
- **O "Pix" da vitrine hoje é manual:** o cliente paga na chave da loja e o pedido nasce com
  `pago = true` sem conferência nenhuma. Nas lojas sem a flag isso **continua igual**.
- Os cupons e prêmios são reservados antes de gravar o pedido, e o cancelamento os devolve
  (`reverterBeneficiosPedidoCancelado`).
- Nenhum código lança `origem='online'` no livro-caixa. O check de `forma` **não** aceita um novo
  valor sem migration.
- Os segredos de integrações (token do Meta, secret da Nexta) ficam em texto puro em tabelas sem
  policy (só service role). **Não existe helper de criptografia**: este plano cria um.

## 1. Fluxo do pedido

```
cliente confirma "Pix online"
  └─ servidor cria o pedido em AGUARDANDO_PAGAMENTO (valor calculado só no servidor)
     └─ cria a cobrança no Mercado Pago (QR + copia e cola, validade N min, idempotente)
        ├─ PAGO (webhook OU verificação periódica, SEMPRE conferido na API)
        │    └─ pedido → RECEBIDO, pago = true  → aí sim: Kanban, alarme, cozinha, impressão,
        │       WhatsApp "recebido", Purchase do Meta, livro-caixa (se houver financeiro)
        └─ EXPIROU sem pagar
             └─ pedido → CANCELADO (motivo "Pix não pago no prazo", por "sistema"),
                cobrança cancelada no MP, cupons/prêmios devolvidos,
                WhatsApp ao cliente: "seu Pix expirou e o pedido foi cancelado; refaça quando quiser"
```

- **Estado novo `aguardando_pagamento`** em `status_pedido`. Quem filtra por status já o ignora
  sozinho: Kanban (`recebido/preparando/pronto`), cozinha, fila de impressão (`recebido`), contador
  do menu e alarme. Precisam de ajuste:
  - o Dashboard e as views do financeiro, que contam "tudo que não é cancelado", passam a
    excluir `aguardando_pagamento`;
  - o gatilho de transições (`pedidos_transicao_valida`) aceita só `aguardando_pagamento →
    recebido` (pelo servidor, com pagamento aprovado) e `→ cancelado`;
  - a notificação do navegador e o push do painel passam a avisar também na **mudança**
    `aguardando_pagamento → recebido`, e não só no INSERT.
- **O que sai da criação e vai para a confirmação:** WhatsApp "recebido", Purchase do Meta CAPI
  (mesmo `event_id`), atribuição do push. O Pixel do navegador dispara na tela de sucesso.
- **Tela do cliente (celular):** QR grande, botão "Copiar código Pix", contador regressivo,
  "Aguardando pagamento…" com detecção automática (consulta a cada 3 s, sem recarregar), depois a
  tela de sucesso de hoje. Expirou: aviso e o botão "Fazer o pedido de novo", que remonta a sacola.
- **Clique duplo:** a criação do pedido já é idempotente (`chave_idempotencia`). A cobrança usa
  `X-Idempotency-Key = pedido:<id>` e há no máximo **uma cobrança ativa por pedido** (índice único
  parcial).
- **Conta desconectada no meio:** a vitrine deixa de oferecer o Pix online (volta às outras formas).
  Um pedido que já esperava pagamento continua sendo verificado; se o token não renovar, ele fica
  "verificação pendente", o dono recebe alerta e, ao reconectar, a verificação periódica resolve.
  Ele **não** é cancelado às cegas, porque pode ter sido pago.

## 2. Pago depois de expirado ou cancelado

- O pedido **não volta** (o gatilho já impede sair de `cancelado`). O pagamento aprovado é registrado
  com a situação **"a devolver"**.
- Vai um **alerta grave ao dono** (painel + WhatsApp do alerta, como os alertas do financeiro de hoje):
  "Pix de R$ X do pedido #N caiu depois de cancelado: devolva".
- Em Financeiro › Pix online, a linha mostra o botão **"Devolver"**, com o mesmo fluxo de estorno
  (seção 4).
- No livro-caixa, entra o recebimento (o dinheiro está na conta da loja) e, ao devolver, o estorno.
  Assim o caixa nunca esconde um valor que entrou.

## 3. Financeiro (só lojas com `financeiro_ativo`)

- **Lançamento** no momento da confirmação pela API, num grupo idempotente com a chave
  `pixonline:<payment_id>`:
  1. `+bruto`: tipo `recebimento`, forma **`pix_online`** (valor novo), origem `online`, carteira
     **`online`** (nova: "saldo no Mercado Pago"), `pagamento_id` = id do MP, `pedido_id`,
     usuário "Mercado Pago (API)";
  2. `−taxa`: tipo `taxa`, mesma carteira, valor de `fee_details` do pagamento. Assim o líquido
     da carteira bate com o que caiu no MP.
- O fluxo de caixa e o Dashboard já contam como venda o `recebimento` fora de `empresa/resultado`:
  o Pix online aparece na coluna Pix e na origem Online sem regra especial. A taxa aparece como
  taxa.
- **Turno (proposta):**
  - **Com caixa aberto:** o lançamento leva o `turno_id` do turno aberto na hora da confirmação.
  - **Sem caixa aberto:** o lançamento entra com `turno_id` nulo e é **adotado pelo próximo turno
    que abrir**. No fechamento desse turno, aparece a linha "Pix online recebido com o caixa
    fechado: N, R$ X". No Fluxo de caixa, ele aparece no turno que o adotou (hoje uma linha sem
    turno cai na janela de horário que a contém, ou em "sem turno").
  - **Ele não entra na conferência da gaveta:** é dinheiro na conta do MP, não em espécie. O
    fechamento mostra o Pix online como **informativo** (bruto, taxa, líquido), e a diferença de
    caixa continua só gaveta e cartão.
- **Loja sem financeiro:** só o pedido fica `pago = true`, mais o registro em `pagamentos_online`
  (sem livro-caixa).

## 4. Estorno / devolução

- **Pela API do MP** (refund total; o parcial fica para depois).
- **Quem:**
  - o **dono** pode fazer direto;
  - o **gerente** com a permissão `estornar` precisa digitar o **PIN dele**;
  - o caixa/atendente pode **pedir**, e um gerente/dono **aprova com PIN** (pelo celular, como as
    aprovações de hoje, `fin_aprovacoes`).
  - Quem pede nunca aprova o próprio pedido (regra que já existe).
- **Registro:** auditoria `pix_online.estorno` (quem pediu, quem aprovou, motivo, id do refund).
  No livro-caixa entra o tipo `estorno` negativo na carteira `online`, com `referencia_id` do
  recebimento. A taxa do MP não volta: se o MP devolver a taxa, a resposta da API diz, e lançamos
  o que vier.
- Pedido ainda em preparo: o estorno não cancela o pedido sozinho. Cancelar é outra ação, com as
  regras de hoje.

## 5. Confirmação: nunca por palavra de ninguém

- **Webhook** `POST /api/webhooks/mercadopago`:
  1. valida a assinatura `x-signature` (HMAC-SHA256 do manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
     com o segredo do webhook) e o `ts` recente. Inválida → 401 e nada muda;
  2. com assinatura válida, **sempre consulta** `GET /v1/payments/{id}` com o token da loja dona da
     cobrança. Só aceita se tudo bater:
     - status `approved`;
     - `external_reference` = id do pedido;
     - **valor = total do pedido**;
     - moeda BRL;
     - `collector_id` = conta conectada **daquela** loja;
  3. o processamento é idempotente: tabela de eventos com `(provedor, payment_id, status)` único,
     e o livro-caixa pela chave.
- **Verificação periódica** (rede de segurança): `POST /api/cron/pix-online` a cada 1 min (Coolify,
  `x-cron-secret`). Ela consulta na API as cobranças pendentes, expira as vencidas e renova os tokens
  que vencem em menos de 30 dias.
- **Ninguém confirma Pix online "na mão":** não há botão, rota nem permissão para isso. A
  conferência manual de Pix de hoje (`pix_conferir`) continua só para o Pix manual.

## 6. Conexão da loja (OAuth)

- Integrações › "Mercado Pago" › **Conectar**: leva ao MP, a loja autoriza com a **própria conta**
  (o dinheiro cai na conta dela) e volta para
  **`https://app.menuzia.com.br/api/integracoes/mercadopago/retorno`**.
- `state` assinado (loja + usuário + validade de 10 min) contra CSRF, mais PKCE.
- Tokens (`access_token`, `refresh_token`) **criptografados** (AES-256-GCM, chave
  `PAGAMENTOS_CHAVE` só no ambiente) na tabela `pagamentos_contas` (sem policy: só o servidor lê).
  Nunca vão ao navegador nem ao log. A tela mostra só "Conectado à conta ••••1234 desde dd/mm",
  Desconectar e o status.
- **Renovação automática** pelo `refresh_token`. Se falhar, a conta vira "desconectada", o dono
  recebe alerta e a vitrine para de oferecer o Pix online.
- **Permissão nova `conectar_pagamentos`:** só o dono (mesmo padrão do `caixa_reabrir`).

## 7. Flag e o que muda para as outras lojas

- `restaurantes.pix_online_ativo` (padrão **falso**) e `pix_online_validade_min` (padrão 15). A
  flag será ligada **só na Menuzia**.
- **Lojas sem a flag: nada muda.** A vitrine mostra exatamente as mesmas formas de hoje (o Pix
  manual continua com `pago = true` como hoje), sem tela nova, sem estado novo e sem alteração no
  Kanban/impressão/WhatsApp. O estado `aguardando_pagamento` só é usado por pedido de loja com a
  flag. As únicas mudanças compartilhadas são os filtros que excluem um estado que, nelas, nunca
  existe.

## 8. Migrations previstas

| Nº | O quê |
|---|---|
| 0147 | `ALTER TYPE status_pedido ADD VALUE 'aguardando_pagamento'` (sozinha: `ADD VALUE` não roda na mesma transação que o usa) |
| 0148 | flag e validade em `restaurantes`; tabelas `pagamentos_contas` (tokens cifrados), `pagamentos_online` (cobrança: pedido, payment_id, valor, status, expira_em, situação a_devolver/devolvido, taxa), `pagamentos_eventos` (webhooks recebidos); gatilho de transição com o estado novo; `forma` `pix_online` e carteira `online` no check do livro-caixa; views do dashboard/fluxo excluindo `aguardando_pagamento`; permissão `conectar_pagamentos` |

(A 0146 fica com a parte do som: contagem de bloqueios e assinaturas de push do painel.) Antes de
cada migration, **backup**.

## 9. O que o dono precisa fazer

### No Mercado Pago (Developers: https://www.mercadopago.com.br/developers/panel)
1. **Criar a aplicação**: "Pagamentos online" → integração "Checkout Transparente / API" →
   produto Pix. Nome: Menuzia.
2. Na aplicação, em **URLs de redirecionamento** (OAuth), cadastrar exatamente:
   `https://app.menuzia.com.br/api/integracoes/mercadopago/retorno`
3. Em **Webhooks**, cadastrar nos modos teste e produção a URL
   `https://app.menuzia.com.br/api/webhooks/mercadopago`, com o evento **Pagamentos**. Depois,
   copiar a **assinatura secreta** gerada.
4. Em **Credenciais de produção**, ativar e copiar o **Client ID** e o **Client Secret**.
5. Em **Contas de teste**, criar dois usuários de teste: um **vendedor** (para conectar a Menuzia no
   teste) e um **comprador**.
6. Na conta do MP que a Menuzia vai conectar de verdade: ter uma **chave Pix cadastrada** (sem ela o
   MP não gera QR).

### No Coolify (variáveis do app, sem colar no código nem no chat)
| Variável | Valor |
|---|---|
| `MP_CLIENT_ID` | Client ID da aplicação |
| `MP_CLIENT_SECRET` | Client Secret |
| `MP_WEBHOOK_SECRET` | assinatura secreta do webhook |
| `PAGAMENTOS_CHAVE` | chave de criptografia dos tokens: gerar com `openssl rand -base64 32`. **Não trocar nunca** (trocar invalida as conexões) |

E uma **tarefa agendada** a cada minuto (mesmo formato das que já existem):
`curl -s -X POST -H "x-cron-secret: $CRON_SECRET" https://app.menuzia.com.br/api/cron/pix-online`

## 10. Testes (antes de publicar)

- **Local:** Mercado Pago **simulado** (como o WhatsApp simulado), cobrindo:
  - conectar e desconectar; token expirado renovando; conta desconectada no meio;
  - Pix pago; expirado; pago depois de expirar; webhook repetido; webhook com assinatura falsa;
  - webhook perdido (a verificação periódica resolve); clique duplo;
  - cozinha e impressão só depois de pago;
  - livro-caixa: lançamento, taxa, estorno com PIN, turno, fechamento e fluxo.
- **Antifraude:**

| Ataque | Esperado |
|---|---|
| valor alterado no navegador | ignorado: o valor vem do pedido no servidor |
| webhook com assinatura inválida | 401, nada muda |
| webhook válido de pagamento de **outra loja** | rejeitado: `collector_id` ≠ conta da loja |
| pagamento com valor ≠ total do pedido | não confirma, alerta |
| "confirmar Pix online" manual | não existe rota/botão; tentativa direta no banco barrada pelo gatilho |
| ler o token pela API/tela | nunca devolvido; só "conectado ••••1234" |

- **Sandbox do MP (credenciais de teste):** conectar a conta vendedora de teste, gerar o QR real e
  conferir assinatura e consulta. Limite conhecido: o Pix de teste do MP não tem um "pagar" de
  verdade, então a aprovação ponta a ponta fica para o **teste real de R$ 1,00 feito pelo dono**.
- Regressão em lotes pequenos: vitrine, checkout, Kanban, impressão, financeiro, PDV, robô WhatsApp,
  Pixel/CAPI, vitest.

## 11. Teste real de R$ 1,00 (feito pelo dono, depois do deploy)

Fica para o relatório de entrega: conectar a conta real da Menuzia, criar um item de R$ 1,00,
pedir na vitrine com Pix online, pagar pelo app do banco, conferir pedido/Kanban/impressão/
livro-caixa (bruto, taxa, líquido), estornar com PIN e conferir o estorno. Cada passo terá o que
ver na tela e no banco.
