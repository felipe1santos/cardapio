# Pix online: como ligar numa loja piloto

Guia curto para o **dono da loja**. Leva uns 15 minutos. O dinheiro do Pix cai direto na conta
do Mercado Pago da loja; a Menuzia não toca no dinheiro.

## Antes de começar (feito pela Menuzia)

- A Menuzia libera o Pix online para a loja (chave por loja; hoje só a Menuzia está ligada).
- Não é preciso criar nada no painel de desenvolvedores do Mercado Pago: a loja usa a aplicação
  da Menuzia, só autoriza.

## 1. Conta no Mercado Pago

1. Baixe o app **Mercado Pago** e entre (ou crie a conta) com os dados da empresa — de
   preferência no **CNPJ** da loja.
2. Confirme a conta como o app pedir (documento, selfie, telefone).

## 2. Chave Pix (obrigatória)

Sem chave Pix o Mercado Pago **não gera o QR Code** e a vitrine não oferece o Pix online.

1. No app do Mercado Pago: **Pix › Minhas chaves › Cadastrar chave**.
2. Escolha o **CNPJ** (recomendado) ou outra chave e confirme.

## 3. Conectar no painel da Menuzia

1. Entre no painel como **dono** (atendente e gerente não conectam conta de pagamento).
2. Vá em **Integrações › Mercado Pago › Conectar Mercado Pago**.
3. O Mercado Pago abre pedindo autorização: confira que é a conta da loja e clique **Autorizar**.
4. Volta para a Menuzia com **"Conta do Mercado Pago conectada."**
   - Se aparecer o aviso amarelo **"Cadastre uma chave Pix no app do Mercado Pago"**: faça o
     passo 2 e toque em **Verificar de novo**.
5. Em **Prazo para pagar**, deixe **15 min** (o cliente tem esse tempo para pagar; depois o
   pedido é cancelado sozinho e nada é cobrado).

## 4. Testar com R$ 1,00

1. No **Cardápio**, crie um item "TESTE Pix R$ 1" de R$ 1,00.
2. Abra a vitrine da loja no celular, peça esse item **para retirada** e escolha
   **Pagar agora (Pix)**.
3. A tela mostra o QR, **"Pague até HH:MM (horário de Brasília)"** e o tempo que falta.
   Enquanto não paga, o pedido **não** aparece no Painel de Pedidos e não imprime.
4. Pague pelo app do banco. Em segundos:
   - a tela do cliente mostra **"Pagamento confirmado!"**;
   - o pedido aparece no Painel de Pedidos, toca o alarme e imprime com **PIX ONLINE - PAGO**;
   - no Financeiro entra a venda e a taxa do Mercado Pago.
5. Encerre o pedido de teste (retirada: **Entregue**) e **pause** o item de R$ 1,00.
6. Quer o dinheiro de volta? Integrações › Mercado Pago › Últimos Pix online › **Devolver**
   (precisa do PIN de um gerente ou do dono).

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| Aviso amarelo "Cadastre uma chave Pix" | Passo 2 e **Verificar de novo** |
| Card do Mercado Pago com **Reconectar** | Conecte de novo (a autorização venceu ou foi revogada) |
| Cliente diz que pagou e o pedido não entrou | Espere 1 minuto (a conferência roda a cada minuto); se continuar, fale com o suporte |
| Pix pago depois do prazo | O sistema avisa e marca "a devolver": devolva em Integrações › Mercado Pago |
