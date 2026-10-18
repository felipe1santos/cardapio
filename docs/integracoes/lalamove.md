# Entregas Lalamove (0199, 18/10/2026)

Chamar um entregador da Lalamove direto do Kanban, para todas as lojas. A corrida é paga pela **conta Lalamove da
loja** (a Menuzia não cobra nada). O módulo "Entregas Lalamove" é ligado/desligado por loja no Super Admin (liberado em
todas por padrão).

## Para o lojista: como conseguir as chaves

1. Crie a conta em **partnerportal.lalamove.com** (país Brasil, e-mail da loja). Não precisa falar com vendedor.
2. Menu **Developers**. No canto superior direito há o seletor de ambiente:
   - **Sandbox** — para testar sem cobrança (chaves `pk_test_…` / `sk_test_…`);
   - **Production** — corridas de verdade (chaves `pk_prod_…` / `sk_prod_…`). Só aparece depois de colocar crédito na
     **Wallet** (carteira Lalamove). Sem saldo a Lalamove recusa a corrida.
3. No Menuzia: **Integrações › Lalamove › Conectar com minhas chaves**. Cole a API key e o Secret. O ambiente
   (Teste/Produção) segue a chave colada. As chaves ficam cifradas (AES-256-GCM) e a tela só mostra os 4 últimos.
4. **Testar conexão**: o Menuzia lista as cidades da conta, reconhece a cidade da loja, escolhe o veículo de moto e
   registra o webhook (aviso automático de status) sozinho.
5. **Ligar no Kanban**. Pronto: nos pedidos de entrega em "Pronto p/ Despacho" aparece o botão **Lalamove** ao lado do
   Despachar.

## Cidades atendidas (site da Lalamove BR, 18/10/2026)

São Paulo e Campinas, Rio de Janeiro, Belo Horizonte, Curitiba, Porto Alegre, Brasília, Goiânia, Salvador, Recife,
Fortaleza, Aracaju, Belém, Florianópolis, Ribeirão Preto, Maceió, São Luís, Manaus. Regiões metropolitanas (ex.:
Niterói → Rio) costumam entrar, mas só uma cotação confirma. Loja fora da área vê "Lalamove ainda não atende sua
cidade" em Integrações e no botão (a cotação é recusada pela API).

Das lojas de hoje, só a **W Lanches (São Luís)** está em cidade atendida; Villa Lanches (Niterói) depende da área do
Rio. Vila Velha, Baixo Guandu, Santos Dumont, Itabaiana e Boa Vista da Aparecida não são atendidas.

## Como funciona

| Passo | O que acontece |
|---|---|
| Botão **Lalamove** no card | `POST /api/admin/entregas/lalamove/cotacao` → `POST /v3/quotations` (loja → cliente, coordenadas gravadas). Mostra **preço e distância**; a cotação vale 5 min. A Lalamove não dá tempo estimado na cotação — ele aparece quando um entregador aceita. |
| Pagamento na entrega | Aviso amarelo antes de confirmar: o entregador da Lalamove **não cobra** do cliente. |
| **Confirmar R$ X** | `POST …/chamar` → `POST /v3/orders`. Linha em `entregas_provedor` (uma ativa por pedido, índice único). O pedido continua `pronto` até a coleta. |
| Webhook `POST /api/entregas/lalamove/webhook/<token>` | Token secreto da URL identifica a loja. O status **nunca** vem do corpo: o servidor consulta `GET /v3/orders/{id}` e aplica. Sem polling. |
| `ON_GOING` (entregador designado) | Busca nome/telefone/placa (`GET …/drivers/{id}`) e manda **WhatsApp ao cliente com o link de rastreio** (uma vez). |
| `PICKED_UP` | Pedido `pronto → em_rota` + aviso "saiu para entrega" (mesmos efeitos do despacho). Card vai para **Em trânsito**. |
| `COMPLETED` | Pedido `→ entregue` pela MESMA função do Kanban/menu Pedidos (`aplicarEfeitosStatusPedidoComTrava`: WhatsApp, Fidelidade; Financeiro recebe pelo fluxo normal). Custo da corrida lançado como **despesa da empresa** (`fin_lancamentos`, carteira `empresa`/`resultado`, `dados.provedor = 'lalamove'`), separado da taxa cobrada do cliente. |
| `CANCELED` / `REJECTED` / `EXPIRED` | Corrida encerra; pedido em rota volta para **Pronto p/ Despacho** com a etiqueta laranja/vermelha no card. |
| **Cancelar** no card | `DELETE /v3/orders/{id}`. A Lalamove só deixa em `ASSIGNING_DRIVER` ou até 5 min após o aceite; depois responde 409 e o painel explica. Aviso de possível taxa antes de confirmar. |
| **Atualizar** no card | Consulta manual (quando um webhook se perde). Nunca em intervalo. |

## Custo e guarda (Regra nº 1)

Toda chamada à Lalamove passa por `chamarApiPaga` (api `lalamove`, `lib/custo/lalamove.ts` — único arquivo que fala
com `rest.lalamove.com`; `scripts/custo/regra-1.mjs` barra qualquer outro). Limite diário `LIMITE_LALAMOVE_DIA`
(padrão 600 chamadas ≈ 100 corridas × 6). Estimativa por loja: cotação + corrida + 3–4 webhooks (1 GET cada) + 1
motorista ≈ 6–7 chamadas por entrega. Nenhum custo para a Menuzia; a corrida é cobrada na carteira Lalamove da loja.

## Variáveis no Coolify

Nenhuma nova obrigatória. Usa `PAGAMENTOS_CHAVE` (já existe, do Pix online) para cifrar as chaves das lojas.
Opcionais: `LIMITE_LALAMOVE_DIA` (padrão 600); `MENUZIA_URL_PUBLICA`/`APP_URL` para a URL do webhook (padrão
`https://app.menuzia.com.br`).

## Testes

- `lib/entregas/lalamove-regras.test.ts`: assinatura HMAC, cotação/pedido, leitura das respostas, webhook, cidades,
  mensagens de erro, cobertura.
- `lib/custo/lalamove.test.ts`: cliente pela guarda (headers, sandbox, fora da área, limite diário, cancelar 409).
- Sandbox real (só na Menuzia, endereços de São Paulo): precisa das chaves `pk_test/sk_test` da conta do dono coladas
  em Integrações › Lalamove. Ver `.medidas/e2e-lalamove-sandbox.mjs`.

## Banco

`supabase/migrations/0199_entregas_lalamove.sql` (tabelas `entregas_provedor_config`, `entregas_provedor`; módulo
`entregas_lalamove`). Rollback em `docs/rollback/0199_entregas_lalamove.down.sql`.
