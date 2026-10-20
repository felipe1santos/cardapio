# Foody Delivery — como a loja conecta (Open Delivery › Logistics)

Conferido em 20/10/2026 na central de ajuda da Foody. **O próprio lojista gera as credenciais** no painel da Foody; não
depende de parceria homologada. Fontes: [Open Delivery API e Webhooks v1.3.0](https://help.foodydelivery.com/knowledge-base/open-delivery-api-webhooks-v1-3-0/),
[Foody Delivery Webhooks](https://help.foodydelivery.com/knowledge-base/foody-delivery-webhooks/),
[Foody para Developers](https://foodydelivery.com/developers/).

## O que a loja faz (passo a passo da tela Integrações › Foody)
1. No painel da Foody: **Menu ➡ Minha conta ➡ APIs e Hooks ➡ Criar credencial**. Dê um nome (ex.: "Menuzia") e em **Tipo**
   escolha **Open Delivery**.
2. Na lista de credenciais, no menu **Ações** (três pontos), copie **clientId**, **clientSecret** e **baseUrl**.
3. No Menuzia, em **Integrações › Foody Delivery**: cole a URL base, o Client ID e o Client Secret; **Salvar**; **Testar conexão**
   (o Menuzia pede um token em `{baseUrl}/oauth/token`; o token vale 6 h e é reaproveitado).
4. De volta à Foody: **Menu ➡ Minha conta ➡ APIs e Hooks ➡ Criar gatilho**, escolha a credencial criada e cole a **URL do webhook**
   mostrada no card do Menuzia. A Foody manda um `hook_test` na hora: o Menuzia responde 200 e o gatilho fica salvo.
5. Ligue "Chamar pelo Kanban". No Painel de Pedidos, em **Pronto p/ Despacho**, aparece o botão **Foody**: cotação (preço e prazo)
   → **Confirmar** → corrida criada. O entregador aparece no card; coletou = pedido em rota; entregou = pedido entregue e custo
   da corrida no Financeiro (quando a loja tem o Financeiro).

## Detalhes técnicos (para o suporte)
- API paga pela loja → só `lib/custo/foody-logistica.ts` fala com a Foody (regra nº 1; limite diário `LIMITE_FOODY_DIA`, padrão 600).
- Endpoints usados: `POST /v1/logistics/availability` (cotação, não cria nada), `POST /v1/logistics/delivery` (cria),
  `POST /v1/logistics/cancel/{orderId}`, `POST /v1/logistics/readyForPickup/{orderId}` (disponível, não usado por padrão).
- Planos "Foody Delivery" (frota própria) usam sempre o endereço de **Dados da empresa** da Foody como coleta; planos
  "Delivery Company" usam coleta e entrega para a taxa. `returnToMerchant` fica `false`.
- Webhook `app/api/entregas/foody/webhook/[token]`: 200 sempre (a Foody desativa o gatilho depois de 10 erros seguidos);
  `hook_test` aceito; aceita payload Open Delivery (`deliveryId`, `event.type`) e o nativo (`uid`, `status`); assinatura
  `X-App-Signature` só é conferida se vier. Segurança = token aleatório da URL (como na Lalamove).
- Status normalizado para o vocabulário da Lalamove (`ASSIGNING_DRIVER → ON_GOING → PICKED_UP → COMPLETED | CANCELED`).

## Pendente de confirmar no primeiro teste real
- O formato exato do payload do gatilho da credencial Open Delivery (a Foody não publica exemplo). O webhook aceita os dois
  formatos conhecidos; se vier um terceiro, o evento entra no histórico da corrida (`entregas_provedor.eventos`) para ajuste.
- Se a cotação da Foody precisar de `vehicle` diferente de moto (`MOTORBIKE_BAG/BOX`, térmico).
