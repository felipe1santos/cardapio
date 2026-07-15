# Plano de Integração — Nexta Delivery (Open Delivery) × Menuzia

> **Status:** plano aprovado para implementação. Escrito em 2026-07-15 após: leitura da spec
> oficial Open Delivery v1.7.0, engenharia reversa do swagger real do Nexta (Xano),
> testes reais no sandbox (auth ✅, cotação ✅, criação ⚠️ pendência) e exploração do
> painel web do lojista Nexta.
>
> **Público-alvo deste documento:** o modelo (Sonnet/Opus) que vai implementar. Cada fase
> tem arquivos, rotas, payloads e critérios de aceite. Implementar **fase por fase, na ordem**.

---

## 1. Contexto e o que é o Nexta

- **Nexta Delivery** (nextadelivery.com) é um **operador logístico** (frota de motoboys
  terceirizada). O restaurante solicita uma entrega, o Nexta aloca um entregador da rede
  dele, cobra por corrida e o lojista acompanha tudo.
- O Nexta implementa o padrão **Open Delivery** (ABRASEL) — módulo **Logistics** — com
  algumas divergências (documentadas na seção 4). Spec oficial:
  `https://abrasel-nacional.github.io/opendelivery/` (v1.7.0).
- **Modelo de integração:** nós (Menuzia) chamamos a API REST do Nexta para cotar/criar/
  cancelar entregas; o Nexta nos chama de volta via **webhook** para eventos de status
  (aceito, entregador a caminho, coletado, entregue...). Não existe polling de eventos no
  módulo logístico — o `GET delivery/{orderId}` existe mas a spec proíbe uso como tracking
  (risco de bloqueio); usar só como fallback/reconciliação.
- **Conceito-chave:** o pedido continua 100% dono do fluxo Menuzia (kanban → logística).
  O Nexta entra como **um "entregador virtual" adicional** no painel de despacho, com
  preço e ETA cotados em tempo real. O lojista escolhe: entregador próprio OU Nexta.

### 1.1 Credenciais e identificadores (regras do padrão)

| Item | O que é | Quem gera |
|---|---|---|
| `client_id` / `client_secret` | Credencial OAuth2 **por estabelecimento** (1 par por loja!) | Nexta emite |
| `merchant.id` | ~~ID estável do estabelecimento, formato `CNPJ-UUID` (min 36 chars), gerado por nós~~ **CORRIGIDO 2026-07-15 na implementação:** o Nexta resolve o estabelecimento por este campo e **só aceita o `client_id` que eles emitiram**. Qualquer outro valor (UUID nosso, `CNPJ-UUID`, o ID interno `1112`) devolve `ERROR_FATAL "Unable to locate var: integracaoEstabelecimento1.estabelecimento_id"`. Guardamos em `nexta_config.merchant_id`, com default = `client_id` e campo editável | Nexta (= client_id) |
| AppId do Nexta | `2037180933127` — vem no header `X-App-Id` dos webhooks | fixo |
| ID Nexta da loja | nº interno do painel deles (sandbox = `1112`) | Nexta |
| URL base | fornecida pelo Nexta por estabelecimento. Sandbox: `https://bck.nextadelivery.app/api:84_dGPfI` | Nexta |
| Webhook URL | nossa URL pública de eventos — **registrada manualmente com o suporte Nexta** (não há endpoint de registro) | Menuzia informa ao Nexta |

Sandbox atual (guardar em env/config de teste, **não** commitar em código):
- `client_id: c7bf871d-e0d9-4d15-b816-8f91af9cfbf9`
- `client_secret: cdadb4c9-6bbb-46f2-86c1-9538922bb3f8`
- Swagger real: `https://bck.nextadelivery.app/apispec:84_dGPfI?type=json`
- No painel Nexta a integração aparece como plataforma **"deliveryVip"**, com flags
  `Ativo`, `Aceitar Auto` e `Delay` (400) — ou seja, o sandbox **auto-aceita** entregas
  após um delay.

---

## 2. API do Nexta — endpoints confirmados (testados em 2026-07-15)

Base: `{NEXTA_BASE_URL}` (por loja). Todos JSON.

### 2.1 `POST /oauth/token` ✅ TESTADO OK
```json
// request
{ "client_id": "...", "client_secret": "...", "grant_type": "client_credentials" }
// response 200
{ "access_token": "eyJ...", "token_type": "bearer" }
```
- Nexta **não retorna `expires_in`** (divergência da spec). Estratégia: cachear o token
  em memória por 50 min e, em qualquer resposta 401, renovar 1× e repetir a chamada.
- Demais chamadas: header `Authorization: Bearer {token}`.

### 2.2 `POST /v1/logistics/availability` — cotação ✅ TESTADO OK
Não cria nada; retorna preço e ETAs. Payload mínimo que **funcionou de verdade** no sandbox:
```json
{
  "merchant": { "id": "<merchantId>", "name": "<nome da loja>" },
  "pickupAddress": {
    "country": "BR", "state": "BR-SP", "city": "Sao Paulo", "district": "Moema",
    "street": "Avenida Ibirapuera", "number": "100", "postalCode": "04029-000",
    "complement": "Loja 1", "latitude": -23.6015, "longitude": -46.6664
  },
  "deliveryAddress": {
    "country": "BR", "state": "BR-SP", "city": "Sao Paulo", "district": "Moema",
    "street": "Alameda dos Maracatins", "number": "500", "postalCode": "04089-001",
    "complement": "Ap 12", "latitude": -23.6100, "longitude": -46.6600
  },
  "returnToMerchant": false,
  "canCombine": true,
  "vehicle": { "type": ["MOTORBIKE_BAG"], "container": "THERMIC", "containerSize": "MEDIUM" },
  "limitTimes": { "pickupLimit": 30, "deliveryLimit": 60, "orderCreatedAt": "2026-07-15T18:00:00Z" },
  "totalOrderPrice": { "value": 40, "currency": "BRL" },
  "orderDeliveryFee": { "value": 8, "currency": "BRL" },
  "totalWeight": 1500
}
```
Resposta real do sandbox:
```json
{
  "deliveryPrice": { "price": { "value": 9.4, "currency": "BRL" }, "pricingList": "NORMAL" },
  "ETAs": {
    "updateMethod": "ONLINE",
    "pickupEtaInMinutes": 7.53, "pickupEtaDatetime": "2026-07-15T12:07:33Z",
    "deliveryEtaInMinutes": 4.04, "deliveryEtaDatetime": "2026-07-15T12:07:04Z",
    "returnToMerchantEtaInMinutes": 0, "returnToMerchantEtaDatetime": 0,
    "maxDeliveryTime": "2026-07-15T12:07:36Z"
  }
}
```
Observações de robustez (backend Xano é frágil):
- Enviar **sempre** os campos opcionais de endereço (`complement`, e na criação também
  `reference`, `instructions`) mesmo vazios (`""`) — a ausência causa `ERROR_FATAL
  "Unable to locate var"`.
- `vehicle.type` é **array** (`["MOTORBIKE_BAG"]`); mandar como string quebra o parse
  (`Invalid value for param "modal.title"`).
- `totalWeight` em **gramas**; `totalOrderPrice.value` decimal em reais.

### 2.3 `POST /v1/logistics/delivery` — criar entrega ✅ RESOLVIDO NA IMPLEMENTAÇÃO (2026-07-15)
Payload da spec = o da cotação **mais**: `orderId` (UUID gerado por nós), `orderDisplayId`
(nº curto do pedido), `customerName`, `customerPhone`, `payments`, e opcionais
(`pickupCode`, `notifyReadyForPickup`, `items`, `confirmationCodeRequired`...).

Resposta esperada (spec): **202** `{ "deliveryId", "event": "PENDING", "completion": { "estimate", "rejectAfter" } }`.
Aceite/rejeição chega **depois, via webhook** (`ACCEPTED`/`REJECTED`).

**Diagnóstico final (testado com o código real de `lib/nexta.ts` contra o sandbox):**

A causa do `fatal` **não era** o formato de `limitTimes` — era o `merchant.id` errado
(ver 1.1). Com `merchant.id = client_id`:

| Payload | Resultado |
|---|---|
| `limitTimes` em **minutos** (spec) | ✅ **202** `{"deliveryId":"1a75ea84-…","event":"PENDING","completion":{"estimate":"…","rejectAfter":"…"}}` |
| `limitTimes` como **datetime ISO** | ❌ `500 "fatal"` |

➡ **A spec está certa: mandar minutos.** A flag `limit_times_as_datetime` fica no código
como escotilha de emergência, **default `false`**, e hoje sabe-se que ligá-la quebra.

➡ **Resta para a homologação (Fase 4):** apenas o **registro da nossa webhook URL** com o
suporte (`tecnologia@nextadelivery.com`) — não há endpoint de auto-registro. As perguntas
sobre `limitTimes` e sobre o erro `fatal` foram respondidas pelos testes acima.

> ⚠️ O teste acima **criou entregas reais no sandbox** (estabelecimento 1112, que tem
> aceite automático com delay 400). Elas aparecem no Monitor de Entrega deles.

### 2.4 Demais endpoints (confirmados no swagger; corpo conforme spec)

| Endpoint | Uso | Corpo |
|---|---|---|
| `GET /v1/logistics/delivery/{orderId}` | detalhes/reconciliação (NUNCA tracking em loop) | — |
| `POST /v1/logistics/readyForPickup/{orderId}` | avisar "pedido pronto p/ coleta" (só se enviamos `notifyReadyForPickup: true`) | vazio |
| `POST /v1/logistics/orderPicked/{orderId}` | confirmar coleta (só se `notifyPickup: true`) | `{ "pickupDate", "volumePicked", "observation" }` |
| `POST /v1/logistics/finishDelivery/{orderId}` | confirmar conclusão (só se `notifyConclusion: true`) | `{ "finishDate", "observation" }` |
| `POST /v1/logistics/cancel/{orderId}` | cancelar | `{ "reason": "PROBLEM_AT_MERCHANT" \| "CONSUMER_CANCELLATION_REQUESTED" \| "NO_SHOW" \| "HIGH_ACCEPTANCE_TIME" \| "INCORRECT_ORDER_OR_PRODUCT_PICKUP" \| "PROBLEM_RESOLUTION" \| "DISCOMBINE_ORDER" \| "OTHER", "action": "RETURN_TO_STORE" \| "CANCEL_DELIVERY", "message": "..." }` → 202 `{ "additionalCharges": bool }` |
| `POST /v1/logistics/handleProblem/{orderId}` | responder problema reportado via webhook | `{ "reason", "action": "RETURN_TO_STORE" \| "DELIVER_PRODUCT" \| "CANCEL_DELIVERY", "message" }` |

Regra de retry: só é permitido **reenviar o mesmo `orderId`** se o último evento foi
`REJECTED`. Para nova tentativa após cancelamento, gerar **novo `orderId`** (guardar
ambos vinculados ao pedido).

### 2.5 Webhook (nós hospedamos; Nexta chama)

`POST {nossa-url}` — registrada com o suporte. Headers de segurança **em toda chamada**:

| Header | Conteúdo |
|---|---|
| `X-App-Id` | `2037180933127` (AppId do Nexta) |
| `X-App-MerchantId` | nosso merchantId da loja |
| `X-App-Signature` | HMAC-SHA256 (hex minúsculo) do **corpo bruto**, chave = `client_secret` da loja |

Corpo (`DeliveryOrderEvent`): `deliveryId, orderId, orderDisplayId, merchant{id,name},
event{type,message,datetime,rejectionInfo?}, problem[]?, customerName, vehicle?,
deliveryPrice?, eta?, deliveryPerson{id,name,pictureURL,phone}?, geoLocalization?,
externalTrackingURL?, combinedOrdersIds?`.
`vehicle/deliveryPrice/eta/deliveryPerson` vêm sempre que `event.type` ∉
{PENDING, REJECTED, CANCELLED}. Responder **200 corpo vazio**; qualquer não-200 → Nexta reenvia.

**Enum de eventos (ordem típica do ciclo):**
```
PENDING → ACCEPTED → PICKUP_ONGOING → ARRIVED_AT_MERCHANT → ORDER_PICKED
        → DELIVERY_ONGOING → ARRIVED_AT_CUSTOMER → ORDER_DELIVERED → DELIVERY_FINISHED
(desvios: REJECTED, CANCELLED, RETURNING_TO_MERCHANT, RETURNED_TO_MERCHANT)
```
`REJECTED` traz `rejectionInfo.reason`: `PRICE_EXCEEDED, VEHICLE_NOT_AVAILABLE,
NO_DELIVERYPERSON_AVAILABLE, DOES_NOT_MEET_REQUESTED_TIMES, REGION_NOT_SERVED,
INVALID_ADDRESS, OTHER`.
Eventos de movimento (`PICKUP_ONGOING`, `DELIVERY_ONGOING`, `RETURNING_TO_MERCHANT`)
**repetem periodicamente** com `geoLocalization` atualizada — tratar como upsert, não como
transição nova (idempotência!).

Existe um segundo webhook opcional (`confirmationCode`) — só se usarmos
`confirmationCodeRequired: true`. **Fora do escopo** desta primeira versão.

---

## 3. Insights do painel do lojista Nexta (para UX)

Explorado logado (estabelecimento "menuzia", ID 1112, `nexta-est.flutterflow.app`):

- **Menu:** Dashboards · Solicitar Entrega · Monitores (Entrega, Diária) · Financeiro
  (Faturas, Extrato Financeiro, Relatórios) · Gestão (Ocorrências, Dia/Hora Funcionamento)
  · Integrações (Externas).
- **Monitor de Entrega** (referência principal): chips de status com contador —
  `Em Andamento · Pedidos Prontos · Aguardando Delay · Localizando Entregador ·
  Aguardando Entregador · A caminho do Estabelecimento · Em Processo · Finalizado ·
  Cancelado` — e tabela `ID Entrega | Valor Total | Data/hora | Status | Volta? | Bairro |
  Cliente | Código de Coleta | Entregador`. Filtros por período, ID da entrega e
  **ID da Integração** (nosso `orderId` — bom para suporte cruzado).
- **Dashboard deles:** total de entregas, finalizadas, canceladas, canceladas em delay,
  buckets por distância (0–3/3–6/6–9/9+ km), entregas por plataforma, SLA (no prazo ×
  atrasadas por faixa de minutos), tempos médios (aceite, percurso até coleta, espera,
  preparo, entrega).
- **Solicitar Entrega manual:** endereço por CEP/rua/número (com mapa) ou lat/long,
  "validação por código (WhatsApp)" opcional, entrega única ou múltipla.
- **Conceito "Diária":** contratação de entregador por diária — **fora do escopo** (não
  há endpoint na API); se o lojista quiser, usa o painel do Nexta.
- **Extrato financeiro:** não há endpoint de financeiro na API ⇒ na nossa página de
  integração exibimos custos **que nós registramos** (soma de `deliveryPrice` por período)
  e linkamos o painel Nexta para fatura/extrato oficial.

O visual deles (verde neon/dark) **não** será copiado — tudo na identidade Menuzia
(paleta ciano `#0688D4`, Inter, radius 3px, cards brancos, badges).

---

## 4. Arquitetura da integração no Menuzia

### 4.1 Princípios
1. **Nada muda no fluxo atual** se a integração estiver desligada (feature 100% aditiva,
   por trás de `nexta_config.ativo`).
2. Nexta = **opção de despacho** ao lado dos entregadores próprios, no mesmo painel.
3. Estado espelhado localmente: cada solicitação vira uma linha em `nexta_entregas`;
   webhooks atualizam essa linha e (nos marcos certos) o `pedidos.status`. O realtime
   existente (Supabase `postgres_changes`) já propaga para as telas — **não criar novo
   mecanismo de realtime**.
4. Segredos (`client_secret`) só transitam no servidor (API routes/route handlers).
   O browser nunca vê a chave nem chama o Nexta direto.

### 4.2 Banco de dados (migration `0042_nexta.sql`)

> **Ajustes feitos na implementação** (o esquema abaixo é o do plano; o aplicado tem estes
> extras, porque o schema atual não tinha os dados que o Open Delivery exige):
> - `nexta_config` ganhou `cnpj` e o **endereço de coleta estruturado**
>   (`pickup_rua/numero/complemento/bairro/cidade/uf/cep/latitude/longitude`) —
>   `restaurantes.endereco` é texto livre e não há cidade/UF separados no cadastro da loja.
> - `pedidos` ganhou `entrega_latitude`/`entrega_longitude` (nullable): o checkout nunca
>   persistiu o geocode do cliente e o payload pede lat/lng. A 1ª cotação de cada pedido
>   geocodifica e cacheia aqui, então recotação não repaga o Google. **O enum de status do
>   pedido não foi tocado**, como manda o plano.
> - `nexta_config` **não tem policy de RLS para `authenticated`** (só service_role a lê),
>   já que guarda o `client_secret` — em vez da view `nexta_config_publica` sugerida, o
>   painel usa exclusivamente o route handler, que devolve `temSecret: bool`.

```sql
-- Config por loja (1:1 com restaurantes)
create table nexta_config (
  restaurante_id uuid primary key references restaurantes(id) on delete cascade,
  ativo boolean not null default false,
  base_url text not null default '',
  client_id text not null default '',
  client_secret text not null default '',          -- ver nota de segurança abaixo
  merchant_id text not null default '',            -- CNPJ-UUID gerado 1x
  merchant_name text not null default '',
  webhook_token text not null,                     -- slug aleatório da URL do webhook
  vehicle_type text not null default 'MOTORBIKE_BAG',
  container text not null default 'THERMIC',
  container_size text not null default 'MEDIUM',
  pickup_limit_min int not null default 30,
  delivery_limit_min int not null default 60,
  limit_times_as_datetime boolean not null default false,  -- flag de compat (seção 2.3)
  peso_padrao_g int not null default 1500,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Entregas solicitadas ao Nexta (N:1 com pedidos — retentativas geram novas linhas)
create table nexta_entregas (
  id uuid primary key default gen_random_uuid(),   -- = orderId enviado ao Nexta
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  pedido_id uuid not null references pedidos(id) on delete cascade,
  delivery_id text,                                -- id do Nexta (vem no 202/webhook)
  status text not null default 'PENDING',          -- enum de eventos Open Delivery
  preco numeric(10,2),
  cotacao jsonb,                                   -- resposta da availability usada
  eta_coleta timestamptz,
  eta_entrega timestamptz,
  entregador_nome text,
  entregador_telefone text,
  entregador_foto_url text,
  tracking_url text,
  rejeicao_motivo text,
  problema jsonb,
  eventos jsonb not null default '[]'::jsonb,      -- histórico append-only de webhooks
  cancel_additional_charges boolean,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on nexta_entregas (restaurante_id, criado_em desc);
create index on nexta_entregas (pedido_id);
create unique index nexta_entregas_ativa_por_pedido
  on nexta_entregas (pedido_id)
  where status not in ('REJECTED','CANCELLED','DELIVERY_FINISHED','ORDER_DELIVERED','RETURNED_TO_MERCHANT');
```

- Em `pedidos`: **não** mexer no enum de status. Adicionar apenas coluna
  `nexta_entrega_id uuid null` (aponta a solicitação ativa) para o painel saber que o
  pedido está "com o Nexta".
- RLS: as duas tabelas com policy por `restaurante_id` (mesmo padrão das demais).
  `nexta_config.client_secret` nunca é lido no client: criar **view** `nexta_config_publica`
  (sem secret) para o admin UI, ou expor via route handler.
- Nota de segurança: secret em coluna text (padrão atual do projeto p/ Evolution API).
  Se quiser endurecer depois: `pgcrypto`/Vault. Não bloqueia esta entrega.

### 4.3 Cliente da API — `lib/nexta.ts` (server-only)

```ts
// Superfície pública (tudo recebe config da loja, nada global):
obterToken(cfg): Promise<string>                    // cache Map<restauranteId,{token,exp}>
cotarEntrega(cfg, pedido, loja): Promise<CotacaoNexta>      // availability
criarEntrega(cfg, pedido, loja, cotacao): Promise<{orderId, deliveryId, rejectAfter}>
avisarPronto(cfg, orderId): Promise<void>           // readyForPickup
cancelarEntrega(cfg, orderId, reason, action, message?): Promise<{additionalCharges}>
consultarEntrega(cfg, orderId): Promise<DetalhesNexta>      // uso pontual
montarPayloadEntrega(...)                           // exportada p/ testes
validarAssinaturaWebhook(rawBody, signature, clientSecret): boolean  // HMAC-SHA256 hex
```

Regras de implementação:
- Timestamps UTC RFC3339 sem milissegundos (`.toISOString().replace(/\.\d{3}Z$/, 'Z')`).
- Endereço Menuzia → `AddressLogistics`:
  `bairro→district`, `cep→postalCode`, `rua→street`, `numero→number`,
  `complemento→complement` (`""` se nulo), `reference: ""`, `instructions: observações`,
  `state: 'BR-' + UF da loja`, `city` da loja, lat/lng do **geocode já existente** do
  checkout (pedido) e da loja (config de entrega). Sem lat/lng do cliente → cotar mesmo
  assim (endereço completo) e logar aviso.
- Pagamento → `payments`:
  - pedido `pago === true` (pix pago/cartão online) → `{ method: "ONLINE" }`
  - senão → `{ method: "OFFLINE", offlineMethod: [{ type: mapa[formaPagamento], amount: total }] }`
    com mapa `dinheiro→CASH`, `cartao→CREDIT_DEBIT`, `pix→PIX`
  - `trocoPara` ≠ null → `payments.change = { value: trocoPara, currency: 'BRL' }`
    (é assim que o motoboy do Nexta sabe o troco — espelha o nosso fluxo atual).
- `orderDisplayId` = `#numero` do pedido; `items` = nome+quantidade dos itens;
  `notifyReadyForPickup: true` (vamos usar o botão "Pronto p/ coleta");
  `notifyPickup: false`, `notifyConclusion: false`, `confirmationCodeRequired: false`.
- Tolerância a enum desconhecido: qualquer `event.type` fora da lista → gravar em
  `eventos` e ignorar transição (spec permite valores novos sem major version).

### 4.4 Rotas HTTP (App Router)

| Rota | Método | Auth | Função |
|---|---|---|---|
| `app/api/nexta/webhook/[token]/route.ts` | POST | HMAC + token da URL | Receber eventos. Fluxo: ler **raw body** → achar loja por `webhook_token` (param) → validar `X-App-Signature` com o secret da loja → localizar `nexta_entregas` por `orderId` → append em `eventos` + atualizar colunas espelho → transições de `pedidos.status` (tabela da seção 4.5) → `200` vazio. Idempotente (evento repetido não re-transiciona). 401 se assinatura inválida. |
| `app/api/admin/nexta/config/route.ts` | GET/PUT | sessão admin | Ler (sem secret; `temSecret: bool`) e salvar config. No 1º save gera `merchant_id` (`CNPJ-UUID` ou `uuid` se sem CNPJ) e `webhook_token` (`crypto.randomUUID()`). PUT com `client_secret` vazio preserva o atual. |
| `app/api/admin/nexta/testar/route.ts` | POST | sessão admin | "Testar conexão": obterToken + availability com endereço da própria loja → `{ ok, preco?, erro? }`. |
| `app/api/admin/nexta/cotacao/route.ts` | POST | sessão admin | Body `{ pedidoId }` → cotarEntrega → `{ preco, etaColetaMin, etaEntregaMin }`. Usada pelo painel de despacho. |
| `app/api/admin/nexta/despachar/route.ts` | POST | sessão admin | Body `{ pedidoId }` → recotiza (preço fresco) → cria linha `nexta_entregas` → `criarEntrega` → grava `delivery_id` → seta `pedidos.nexta_entrega_id`. **Não muda `pedidos.status` ainda** (segue `pronto` até ORDER_PICKED). Erro do Nexta → apaga a linha e retorna erro legível. |
| `app/api/admin/nexta/pronto/route.ts` | POST | sessão admin | Body `{ pedidoId }` → `avisarPronto` (readyForPickup). |
| `app/api/admin/nexta/cancelar/route.ts` | POST | sessão admin | Body `{ pedidoId, reason?, message? }` → `cancelarEntrega` (default `PROBLEM_AT_MERCHANT`/`CANCEL_DELIVERY`) → status local `CANCELLED`, limpa `pedidos.nexta_entrega_id`, retorna `additionalCharges`. |
| `app/api/admin/nexta/reconciliar/route.ts` | POST | sessão admin | Body `{ pedidoId }` → `consultarEntrega` 1× e sincroniza (botão manual "Atualizar" p/ webhook perdido; também chamado automaticamente se entrega ativa sem evento há >10 min quando o painel carrega). |

Webhook URL a registrar com o Nexta (por loja):
`https://app.menuzia.com.br/api/nexta/webhook/{webhook_token}`
(token na URL identifica a loja e é 2ª camada além do HMAC).

### 4.5 Máquina de estados — evento Nexta → Menuzia

| Evento Nexta | `nexta_entregas.status` | Efeito no pedido / UI | Alerta sonoro |
|---|---|---|---|
| `PENDING` (202) | PENDING | badge "Nexta: aguardando aceite" | — |
| `ACCEPTED` | ACCEPTED | badge "Nexta: aceito" | — |
| `REJECTED` | REJECTED | limpa `nexta_entrega_id`; pedido volta a "aguardando despacho" com aviso do motivo | 🔔 tom de erro |
| `PICKUP_ONGOING` | PICKUP_ONGOING | badge "Entregador a caminho da loja" + nome/foto/tel | 🔔 **tom dedicado** (pedido do usuário: apitar quando entregador vier pegar) |
| `ARRIVED_AT_MERCHANT` | ARRIVED_AT_MERCHANT | badge "Entregador na loja" | 🔔 |
| `ORDER_PICKED` | ORDER_PICKED | **`pedidos.status → 'em_rota'`** + `notificarPedido(id,'em_rota')` (WhatsApp do cliente, já existe) | — |
| `DELIVERY_ONGOING` | DELIVERY_ONGOING | atualiza ETA/geo (upsert; evento repete) | — |
| `ARRIVED_AT_CUSTOMER` | ARRIVED_AT_CUSTOMER | badge "No cliente" | — |
| `ORDER_DELIVERED` / `DELIVERY_FINISHED` | idem | **`pedidos.status → 'entregue'`** (via `marcarPedidoEntregue` semantics) | — |
| `RETURNING_TO_MERCHANT` / `RETURNED_TO_MERCHANT` | idem | badge de retorno; pedido fica `em_rota` até decisão manual | 🔔 |
| `CANCELLED` | CANCELLED | limpa `nexta_entrega_id`; pedido **volta para `pronto`** (reaparece no despacho) com aviso | 🔔 tom de erro |
| `problem[]` presente | (mantém) | card de ocorrência com `needMerchantAction`; ação via handleProblem (v2) — v1 mostra aviso + telefone | 🔔 |

Transições de `pedidos.status` idempotentes: aplicar só se o status atual for o anterior
esperado (não rebaixar `entregue`).

### 4.6 Realtime e alertas sonoros

- `nexta_entregas` entra na publicação realtime do Supabase (como `pedidos`).
- Painel logística assina `postgres_changes` de `nexta_entregas` filtrado por
  `restaurante_id` (mesmo padrão de `app/admin/logistica/page.tsx:159-172`).
- Som: reutilizar o padrão Web Audio de `app/admin/pedidos/page.tsx:109-133`
  (`playNewOrderSound`), criando `playNextaSound(kind: 'indo_coletar' | 'erro' | 'aviso')`
  com timbres distintos (ex.: indo_coletar = 2 notas ascendentes; erro = 2 descendentes).
  Toggle "som" próprio no painel logística, persistido em
  `localStorage['menuzia:logistica-som']` (mesmo padrão do kanban).
- Disparo: no handler do realtime, comparar status anterior × novo por
  `nexta_entregas.id` (map em ref) e tocar conforme a tabela 4.5.

---

## 5. UX / Design (identidade Menuzia — ver CLAUDE.md §3)

> O Nexta aparece nos **dois pontos de despacho** do sistema: (a) página **Logística**
> (que será reorganizada em abas — 5.1) e (b) **Painel "Despacho de rotas"** do kanban
> (`components/pedidos/rota-panel.tsx` — 5.2). Mesmas rotas de API nos dois lugares.

### 5.1 Página Logística (`app/admin/logistica/page.tsx`) — reorganização em abas

A página hoje empilha coluna de entregadores + listas de pedidos. Com o Nexta ela ficaria
carregada demais ⇒ **refatorar em abas** (mesmo padrão visual de abas do Ajustes: barra
horizontal no topo do conteúdo, pill ativa com `--primary`):

| Aba | Conteúdo |
|---|---|
| **Despacho** (default) | Seções verticais full-width: 1) "Prontos para despachar" (cards atuais + cotação Nexta), 2) **"Com o Nexta"** (nova — ver abaixo), 3) "Em rota" (própria + Nexta com badge). Contador de pendentes no título da aba (`Despacho · 3`). |
| **Concluídos** | O que já existe na aba "Concluídos" atual (entregues/cancelados do dia). |
| **Entregadores** | A coluna de entregadores vira aba própria: cards da frota (status online/ocupado/offline, X em rota), CRUD (adicionar, perfil, foto), toggle "despacho aberto". Ganha respiro para crescer (não disputa espaço com pedidos). |

- Estado da aba em query param (`?tab=`) para deep-link e para o realtime não resetar.
- Realtime/refetch continuam globais à página (contadores das abas sempre corretos).
- Migração sem retrabalho: os blocos JSX existentes são movidos para dentro das abas
  praticamente intactos (mudam contêineres/grid, não a lógica).

**Card de pedido aguardando despacho** (na aba Despacho) ganha bloco Nexta:
- Ao entrar em "Prontos para despachar" (e a cada refetch), se `nexta_config.ativo`,
  buscar cotação (`/api/admin/nexta/cotacao`) com cache em memória por pedido (TTL 2 min,
  refresh em foco). Enquanto carrega: skeleton "Cotando Nexta…".
- Exibir chip: logo/nome **Nexta** + `R$ 9,40` (verde `--text-price` sobre `--bg-price`)
  + `~12 min p/ coleta` em `--text-subtle`. Falha na cotação → chip cinza "Nexta
  indisponível" com tooltip do erro (não bloqueia despacho próprio).
- **Dropdown "Atribuir entregador"** (hoje em `page.tsx:671-689`): primeira opção vira
  `⚡ Nexta — R$ 9,40 · coleta ~12 min` (borda esquerda `--primary`), seguida do divisor
  "Meus entregadores" e a lista atual. Selecionar Nexta → `POST /despachar` → botão vira
  estado "Enviado ao Nexta" (badge `--bg-alert`).
- Despacho em lote (checkboxes + "Atribuir N selecionados"): o dropdown de lote também
  ganha a opção Nexta — implementado como **loop sequencial** de `POST /despachar`
  (1 corrida por pedido; sucesso parcial reportado por card). Mesma mecânica do
  rota-panel (5.2). `canCombine: true` deixa o próprio Nexta combinar corridas.

**Nova seção/coluna visual "Com o Nexta"** entre "Prontos" e "Em rota" (mesmo padrão de
card com borda esquerda, cor `--primary`): pedidos com `nexta_entrega_id` ativo e status
< ORDER_PICKED. Cada card mostra:
- timeline compacta de chips: Aguardando aceite → Aceito → Indo coletar → Na loja;
- quando houver `deliveryPerson`: foto redonda, nome, telefone (link `tel:`), placa se vier;
- botão `PRONTO P/ COLETA` (chama `/pronto`; some após uso), botão-ghost `CANCELAR`
  (confirm dialog: avisar que pode ter cobrança — mostrar `additionalCharges` retornado),
  link "Rastrear" se `tracking_url`.
- `REJECTED`/`CANCELLED`: card ganha fundo `--bg-danger`, motivo traduzido
  (ex. `NO_DELIVERYPERSON_AVAILABLE` → "Sem entregador disponível agora") e botão
  "Tentar de novo" (nova cotação + despacho) — e o pedido continua/volta na lista de
  despacho normal.

**"Em rota"**: pedidos Nexta aparecem como hoje, mas com badge `Nexta` ao lado do nome do
entregador (dados do webhook) e ETA de entrega quando disponível. Botões "Entregue/Não
entregue" manuais continuam funcionando como override (fonte da verdade local).

### 5.2 Painel "Despacho de rotas" (`components/pedidos/rota-panel.tsx`)

É o overlay de mapa aberto pelo kanban (`/admin/pedidos`) — screenshot de referência:
lista "Pedidos" à esquerda (cards marcáveis/arrastáveis), mapa ao centro, coluna
**"Entregadores"** à direita (cards `Jose · 0`, `pedro · 1`, contador "2 online").
O despacho em lote acontece aqui também (`despachar()` em `rota-panel.tsx:278-295`).

Integração — o Nexta entra como **primeiro card fixo da coluna Entregadores**:

- Card `⚡ Nexta` no topo da lista da direita (visual distinto: borda esquerda
  `--primary`, fundo branco, logo pequena), sempre visível quando `nexta_config.ativo`
  — independe de ter entregador próprio online. Abaixo dele, divisor fino e os
  entregadores normais.
- O card mostra estado vivo: sem pedidos marcados → `Nexta · selecione pedidos`;
  com pedidos marcados → busca cotação de **cada pedido marcado** (`/api/admin/nexta/cotacao`,
  cache de 2 min compartilhado com a página Logística via módulo util) e exibe
  `R$ 23,80 total · 3 corridas`. Cotação falhou p/ algum pedido → mostra
  `2 de 3 cotados` e tooltip com o motivo.
- **Seleção:** o card Nexta é selecionável exatamente como um motoboy (mesmo state
  `motoboyId`, valor sentinela `'nexta'`). Com Nexta selecionado:
  - cada card de pedido marcado ganha chip verde com o preço individual cotado
    (`--bg-price`/`--text-price`);
  - a barra de confirmação do despacho mostra o total e o texto muda para
    `DESPACHAR 3 PEDIDOS VIA NEXTA · R$ 23,80`;
  - a ordenação por arrasto fica **desabilitada/ignorada** (cada pedido é uma corrida
    independente do Nexta — quem combina é o operador logístico, via `canCombine`).
- `despachar()` com Nexta: loop sequencial `POST /api/admin/nexta/despachar` por pedido
  (não usar `atribuirEntregadorEmLote`). Sucesso parcial é reportado: pedidos aceitos
  somem da lista "Pedidos"; falhas permanecem marcadas com aviso vermelho no card.
  `notificarPedido(id,'em_rota')` **não** é chamado aqui — o WhatsApp dispara no evento
  `ORDER_PICKED` (webhook), como na seção 4.5.
- Pedidos já enviados ao Nexta (`nexta_entrega_id` ativo) aparecem na lista/mapa com
  pin e chip `Nexta` + status curto ("aguardando aceite", "indo coletar"), e não são
  marcáveis para novo despacho. No filtro de topo eles contam em "Aguardando" até
  `ORDER_PICKED` (vira "Em rota"), mantendo os contadores atuais coerentes.
- Alertas sonoros: o rota-panel já vive dentro do kanban, que terá a assinatura realtime
  de `nexta_entregas` (4.6) — nenhum som extra aqui.

### 5.3 Sidebar: item **Integrações** (novo)

- `app/admin/layout.tsx` `NAV_ITEMS` + ícone em `components/layout/sidebar.tsx`
  (ícone plug/share, estilo dos existentes): item **Integrações** → rota
  `/admin/integracoes` (redirect para `/admin/integracoes/nexta` por enquanto).
- Página `app/admin/integracoes/nexta/page.tsx` com sub-nav horizontal (padrão de abas do
  ajustes) — "sub-botão nexta" que o usuário pediu; futuras integrações (iFood etc.)
  entram como novas abas ao lado.

**Conteúdo da página Nexta** (tudo vocabulário visual Menuzia — cards brancos, borda
`--border-color`, radius 3px, Inter):

1. **Card Status da conexão**: dot verde/vermelho + "Conectado como {merchant_name}
   (ID Nexta {id})", botão `TESTAR CONEXÃO` (rota `/testar`, mostra preço de cotação de
   teste), toggle Ativo. Campos: URL base, client_id, client_secret (write-only,
   placeholder "••••• salvo"), merchant_id (read-only, botão copiar), **webhook URL**
   (read-only + copiar — "envie esta URL ao suporte Nexta").
2. **Card Preferências de despacho**: veículo (select dos enums), container/tamanho,
   limites de coleta/entrega (min), peso padrão; flag avançada `limit_times_as_datetime`.
3. **Cards de métricas (período: hoje/7d/30d)** — dados de `nexta_entregas`:
   entregas solicitadas, concluídas, canceladas/rejeitadas, **custo total** e custo médio
   (verde `--text-price`), tempo médio até coleta. Grid 3×2, números grandes (padrão
   dashboard Menuzia).
4. **Monitor Nexta**: tabela `Pedido #, Data/hora, Status (badge colorido por evento),
   Entregador, Preço, Ações (Atualizar → /reconciliar, Rastrear)` com filtro por status —
   inspirado no monitor deles, com realtime.
5. **Card Links do painel Nexta**: "Fatura e extrato oficiais ficam no painel do Nexta" +
   botão-outline abrindo `https://nexta-est.flutterflow.app` (financeiro não tem API).

### 5.4 Ajustes → aba Integrações (existente)

Adicionar card compacto "Nexta Delivery" (mesmo padrão do card WhatsApp em
`app/admin/ajustes/page.tsx:1350+`): status Conectado/Inativo + botão "Configurar" →
`/admin/integracoes/nexta`. (A config completa mora na página nova; o card é atalho.)

---

## 6. Fases de implementação (para o modelo implementador)

> Regra geral: cada fase compila, passa lint e é commitável isolada. Convenções do repo:
> queries em `lib/queries/*`, tipos junto, componentes de página inline (padrão atual),
> textos PT-BR, Tailwind com tokens do design system.

### Fase 0 — Fundação (migration + config + cliente API)
1. Migration `0042_nexta.sql` (seção 4.2) + RLS + realtime publication. Aplicar no remoto
   (padrão do projeto: MCP/`psql` conforme memória do projeto).
2. `lib/nexta.ts` (seção 4.3) — sem UI. Unit-testável: `montarPayloadEntrega` e
   `validarAssinaturaWebhook` puros.
3. `lib/queries/nexta.ts` — CRUD tipado de `nexta_config` (sem secret no client) e
   `nexta_entregas` (listar por restaurante/pedido).
4. Rotas `config` e `testar` (seção 4.4).
5. Página `app/admin/integracoes/nexta/page.tsx` **mínima**: card status + form config +
   testar conexão + webhook URL copiável. Sidebar item Integrações.
**Aceite:** salvar credenciais sandbox, "Testar conexão" retorna preço real da cotação.

### Fase 1 — Reorganização da Logística + cotação
1. **Refatorar `app/admin/logistica/page.tsx` em abas** (Despacho / Concluídos /
   Entregadores — seção 5.1). Sem Nexta ainda: só mover os blocos existentes. Commit
   próprio (é refactor visual independente e testável sozinho).
2. Rota `cotacao` + util de cache de cotações (`lib/nexta-cotacao-cache.ts`, client-side,
   TTL 2 min, compartilhado entre Logística e rota-panel).
3. Aba Despacho: chip de cotação no card + opção Nexta no dropdown "Atribuir entregador"
   (desabilitada com tooltip "configure em Integrações" quando `!ativo`).
**Aceite:** Logística navegável em 3 abas sem perda de função; pedido em "Prontos" mostra
`Nexta — R$ x,xx · ~N min` real (sandbox).

### Fase 2 — Despacho, webhook, estados e sons
1. Rotas `despachar`, `pronto`, `cancelar`, `reconciliar` + webhook handler (HMAC!).
2. Seção "Com o Nexta" na aba Despacho + badges/timeline + botões (seção 5.1).
3. **Rota-panel (Despacho de rotas):** card fixo `⚡ Nexta` no topo da coluna
   Entregadores, seleção sentinela `'nexta'`, chips de preço por pedido marcado, total na
   barra de confirmação, loop de despacho com sucesso parcial (seção 5.2).
4. Máquina de estados (4.5) + realtime em `nexta_entregas` + `playNextaSound`.
5. WhatsApp do cliente nos marcos (reusar `notificarPedido` em `em_rota`/`entregue` —
   já é disparado pelas transições de status existentes; conferir que a transição via
   webhook também passa por elas).
**Aceite (sandbox tem aceite automático com delay):** despachar pela Logística **e** pelo
rota-panel → card muda para "aguardando aceite" → eventos chegam → som toca em
PICKUP_ONGOING → ORDER_PICKED move pedido p/ Em rota → DELIVERY_FINISHED entrega o
pedido. Cancelamento funciona e mostra `additionalCharges`.

### Fase 3 — Página Nexta completa
Métricas, monitor com filtros, preferências de despacho, card na aba Ajustes→Integrações.
**Aceite:** números batem com `nexta_entregas`; monitor atualiza em realtime.

### Fase 4 — Homologação com o Nexta (bloqueia produção, não o código)
1. Enviar ao suporte: webhook URL de produção + perguntas da seção 2.3 (formato
   `limitTimes`, erro `fatal` no create, confirmação dos campos opcionais obrigatórios).
2. Rodar ciclo completo no sandbox após retorno deles; ajustar flag
   `limit_times_as_datetime` se necessário.
3. Testar assinatura HMAC com evento real (logar header + hash calculado em modo debug).
4. Só então habilitar para loja real (credenciais de produção são **por estabelecimento**).

---

## 7. Riscos e decisões registradas

| Risco/decisão | Mitigação |
|---|---|
| Backend Nexta (Xano) diverge da spec (campos opcionais obrigatórios, `limitTimes`, erros 500 crus) | Payload sempre completo; flag de compat; erros do Nexta exibidos com texto amigável + raw no console/log |
| Webhook não registrado/perdido | Botão + auto "reconciliar" via GET details (pontual, nunca loop — spec ameaça bloqueio) |
| Duplicidade de solicitação | unique index parcial (1 entrega ativa por pedido) + `orderId` novo só após REJECTED/CANCELLED |
| Replay/foreign webhook | HMAC obrigatório + token secreto na URL + checar `X-App-Id` |
| Loja sem lat/lng do cliente | Cotação segue por endereço; logar; homologar precisão com Nexta |
| Preço muda entre cotação e despacho | Despachar sempre re-cota na hora; `additionalPricePercentual` não enviado (default: rejeita se exceder) — decisão: preferimos rejeição a surpresa de preço |
| Custo de cancelamento | Dialog de confirmação mostra `additionalCharges` retornado |
| Sandbox ≠ produção (spec diz "não há ambiente de produção do padrão"; produção = URL da loja real) | `base_url` é config por loja, nada hardcoded |

---

## 8. Referências

- Spec Open Delivery v1.7.0: `https://abrasel-nacional.github.io/opendelivery/` (YAML raw:
  `https://raw.githubusercontent.com/Abrasel-Nacional/opendelivery/gh-pages/openapi.yaml`)
- Swagger real do Nexta: `https://bck.nextadelivery.app/apispec:84_dGPfI?type=json`
- Perfil do Nexta no diretório Open Delivery (AppId, contato):
  `https://aderentes.opendelivery.com.br/companies/6879b7b02a937a13817fe421`
- Validador de payloads da comunidade:
  `https://programmersit.github.io/opendelivery-api-schema-validator/`
- Painel do lojista (sandbox): `https://nexta-est.flutterflow.app`
- Código Menuzia relevante: `app/admin/logistica/page.tsx` (despacho),
  `lib/queries/pedidos.ts` (status/entregadores), `app/admin/ajustes/page.tsx:1239`
  (aba Integrações), `app/admin/pedidos/page.tsx:109` (som), `lib/evolution.ts` +
  `lib/whatsapp.ts` (padrão de integração externa existente).
