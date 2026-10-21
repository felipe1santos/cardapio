# Uber Direct — entregador da Uber pelo Kanban (21/10/2026)

**Estado:** liberada para todas as lojas em 21/10 (`ENTREGAS_UBER_LIBERADO=1` no Coolify). Sem a variável, o card
mostra "Em breve". Conector em `lib/custo/uber-direct.ts`.

## Como funciona
- Cada loja usa a **própria** conta Uber Direct (direct.uber.com, autoatendimento). Credenciais em
  Management › Developer: **Customer ID**, **Client ID**, **Client Secret** (teste e produção são diferentes).
- Token: `POST https://auth.uber.com/oauth/v2/token` (client_credentials, scope `eats.deliveries`, 30 dias, em cache).
- Cotação: `POST /v1/customers/{customer_id}/delivery_quotes` (preço em centavos) → o dono confirma →
  `POST /deliveries` com `quote_id` → corrida em `entregas_provedor` (mesmo fluxo da Lalamove/Foody).
- Conta de teste: a entrega vai com `test_specifications.robo_courier_specification.mode = auto` — o Robo Courier da
  Uber percorre a corrida sozinho (um passo a cada ~30 s), com webhooks de verdade.
- Webhook: `/api/entregas/uber/webhook/{token}` (URL no card). Configurar em Developer › Webhooks com os eventos de
  status e de entregador; a **Signing Key** (menu "…" › Edit) vai no card e o `x-uber-signature` (HMAC-SHA256 hex do
  corpo bruto) passa a ser conferido.
- Status: pending → procurando; pickup → a caminho; pickup_complete/dropoff → em rota; delivered → entregue (custo no
  Financeiro); canceled/returned → pedido volta para "pronto".
- **Não cobra na entrega**: só pedido já pago (Pix/cartão online). O Menuzia recusa a cotação de pedido a receber.
- Cobertura: principais cidades do Brasil (São Paulo, Rio de Janeiro, Goiânia, Curitiba e dezenas de outras, segundo a
  Uber). Fora da área, a cotação devolve `address_undeliverable` → "não atende este endereço ou esta cidade".
- Guarda de custo: api `uber`, `LIMITE_UBER_DIA` (padrão 600 chamadas/dia no sistema).

