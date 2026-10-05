# Pix online (Mercado Pago) — relatório de entrega (2026-10-04)

O plano aprovado está em `plano.md`, com as três decisões do dono:
- o próximo turno adota o Pix confirmado com o caixa fechado;
- estorno só total, aprovado por gerente ou dono com PIN, nunca por quem pediu;
- validade padrão de 15 minutos.

## O que foi feito

| Peça | Onde |
|---|---|
| Estado `aguardando_pagamento` | `0147_status_aguardando_pagamento.sql` (sozinha: `ADD VALUE`) |
| Flag, validade, tabelas, livro-caixa, fluxo, transições | `0148_pix_online.sql` |
| Tokens cifrados (AES-256-GCM, `PAGAMENTOS_CHAVE`) | `lib/pagamentos/cripto.ts` |
| Assinatura do webhook (`x-signature`, ts ≤ 10 min) | `lib/pagamentos/assinatura-mp.ts` |
| Cliente do MP (real + simulado) | `lib/pagamentos/mercadopago.ts` |
| Conexão OAuth + PKCE + renovação | `lib/pagamentos/contas.ts`, `/api/integracoes/mercadopago/{conectar,retorno}` |
| Núcleo (cobrança, conferência, confirmação, expiração, devolução) | `lib/pagamentos/pix-online.ts` |
| Webhook | `POST /api/webhooks/mercadopago` |
| Verificação periódica | `POST /api/cron/pix-online` (agendamento a cada minuto) |
| Vitrine | opção Pix vira "Pague agora pelo app do banco" só na loja com a flag; tela `components/vitrine/tela-pix-online.tsx` |
| Painel | Integrações › **Mercado Pago**: conectar/desconectar (dono), prazo, últimos Pix, **Devolver** |
| Fechamento do caixa | linhas "Pix online no turno" e "Pix online recebido com o caixa fechado: N, R$ X" (informativo) |

### Regras que valem no código
- **Pedido "aguardando pagamento"** não aparece no Kanban, na cozinha, na impressão, no alarme, no Dashboard nem na lista do cliente. Também não manda WhatsApp nem compra ao Meta.
- **Pago** quer dizer conferido na API com o token da loja, e tudo tem de bater: aprovado, referência = pedido, **valor = total do pedido**, BRL, Pix e **coletor = conta da loja**.
- Só então o pedido vira "recebido" (um UPDATE condicional, idempotente) e saem o WhatsApp, o push do painel, a compra no Meta (mesmo `event_id`) e o livro-caixa.
- **Livro-caixa** (só loja com financeiro): `+bruto` (recebimento, forma `pix_online`, origem online, carteira `online`) e `−taxa`, com a chave `pixonline:<id do MP>`.
  - O turno é o aberto na hora da confirmação.
  - Sem caixa aberto, o lançamento fica sem turno e o **próximo turno adota**, no fluxo de caixa e no fechamento.
  - Não entra na conferência da gaveta.
- **Expirou:**
  - antes de cancelar, consulta o MP, porque pode ter sido pago no último segundo;
  - cancela no MP e cancela o pedido (motivo "Pix não pago no prazo");
  - devolve cupom e prêmio e avisa o cliente.
- **Pago depois de cancelado:**
  - o pagamento fica **"a devolver"**;
  - o recebimento entra no livro-caixa;
  - vai um alerta **grave** ao dono;
  - o botão Devolver aparece em Integrações › Mercado Pago.
- **Devolução:**
  - estorno total pela API;
  - aprovação por gerente ou dono com PIN, ou pelo celular, e quem pede nunca aprova;
  - o estorno entra no livro-caixa ligado ao recebimento;
  - a auditoria (`pix_online.devolvido`) registra quem pediu, quem aprovou e o motivo.
- **Conta caiu no meio:** o pedido fica "verificação pendente", e **não** é cancelado às cegas. A vitrine para de oferecer o Pix online, e ao reconectar a verificação resolve.
- **Ninguém confirma Pix online na mão:**
  - a rota de pagamento manual responde 409;
  - o gatilho do banco só deixa o servidor passar de "aguardando" para "recebido" com o pedido já pago.

### Loja sem a flag
Nada muda:
- a vitrine mostra as mesmas formas, e o Pix manual continua como hoje;
- o card do Mercado Pago não aparece;
- o estado novo nunca é usado.

As mudanças comuns a todas as lojas são filtros que excluem um estado que nelas não existe.

## Testes

| Suíte | Resultado |
|---|---|
| `e2e-pix-online` (MP simulado) | **53/53** |
| unitários `lib/pagamentos` | 11/11 |
| regressão | vitrine 51 + 11, regressão geral 52, Pixel 48, dashboard-banco 8, financeiro (fluxo 86, integrado 52, fase6 97, atômico 23, fase3 106, sem financeiro 6), Kanban 72 + 121, PDV 70, garçom 47, robô WhatsApp 106, impressão 40, alarme 27 |
| vitest | 2040 |

### Antifraude

| Ataque | Esperado | Resultado |
|---|---|---|
| valor alterado no navegador (total 0,01) | ignorado: a cobrança usa o total do servidor | ✅ |
| webhook com assinatura falsa | 401, nada muda | ✅ |
| webhook antigo reenviado (ts de 30 min) | 401 | ✅ |
| pagamento com valor ≠ total do pedido | não confirma, alerta | ✅ |
| pagamento de OUTRA conta/loja (coletor diferente) | não confirma | ✅ |
| webhook de pagamento que não é nosso | ignorado | ✅ |
| "marcar pago" manual sem a API | 409 | ✅ |
| marcar pago direto no banco (papel do painel) | barrado | ✅ |
| ler o token pela API do painel | nunca devolvido (só "••••final") | ✅ |
| resposta da tela do cliente | sem token nem dado pessoal | ✅ |

**Limite conhecido:** no ambiente de teste do MP não existe "pagar" um Pix de verdade. A aprovação ponta a ponta com o MP real fica para o teste de R$ 1,00 abaixo.

## Prints (celular 390 px, MP simulado)
`prints/`:
1. forma de pagamento;
2. Pague com Pix (QR, copiar, contador);
3. código copiado;
4. pagamento confirmado;
5. pedido feito;
6. expirou.

## Teste real de R$ 1,00 (feito pelo dono, na Menuzia)

**Antes:**
1. No Coolify, configure as variáveis `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET` e `PAGAMENTOS_CHAVE` e faça um **Redeploy**.
2. Crie a tarefa agendada "Pix online" (a cada minuto) e **ligue**.
3. O Gerente TESTE precisa estar **ativo e com PIN**, porque a devolução exige outra pessoa aprovando. Reative-o em Equipe e defina o PIN dele no primeiro acesso.

**Passo a passo:**
1. **Conectar:** no perfil "Menuzia teste", como Administrador, vá a Integrações › Mercado Pago › **Conectar Mercado Pago**. Entre com a conta **real** da Menuzia no MP e autorize.
   - Volta com "Conta do Mercado Pago conectada".
   - O card mostra "Conectado · ••••final".
2. **Item de R$ 1,00:** crie no Cardápio um item "TESTE Pix R$ 1" a R$ 1,00, disponível.
3. **Pedido:** na vitrine da Menuzia, pelo celular, peça só esse item **para retirada** (sem taxa de entrega) e escolha **Pix** ("Pague agora pelo app do banco").
   - Aparece a tela com QR, "Copiar código Pix" e o contador de 15:00.
   - No painel, o pedido **não** aparece no Kanban e não imprime.
4. **Pagar:** no app do banco, Pix › Copia e cola, e pague R$ 1,00. Em segundos:
   - a tela do celular mostra "Pagamento confirmado!" e depois "Pedido enviado!";
   - o pedido aparece no Kanban, toca o alarme e imprime;
   - o WhatsApp de "recebido" chega no seu número.
5. **Conferir o caixa:** em Financeiro › Caixa/Fluxo, a venda Pix de R$ 1,00 aparece na origem Online, com a taxa do MP lançada. Eu confiro só lendo: o lançamento `pixonline:<id>` e a auditoria `pix_online.pago`.
6. **Devolver:** em Integrações › Mercado Pago › Últimos Pix online › **Devolver**. Escreva o motivo "teste" e escolha o Gerente TESTE com o PIN dele (ou "Pedir pelo celular").
   - O status vira "Devolvido".
   - O R$ 1,00 volta para a conta que pagou (veja no app do banco).
   - No livro-caixa entra o estorno.
7. **Fim:** cancele o pedido de teste no Kanban (motivo "Pedido teste"), apague ou pause o item de R$ 1,00 e, se quiser, desconecte a conta.
