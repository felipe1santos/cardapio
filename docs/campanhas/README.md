# Campanhas — disparo e métricas (0104)

## Fluxo

```
painel (/admin/campanhas) ─POST/PATCH─► campanhas + campanha_envios (1 por telefone, token próprio)
                                          │
cron 1/min (/api/cron/campanhas) ──► campanha_reservar_envios(5)   expira > 24h, trava vencida → incerto,
                                          │                        skip locked (dois crons nunca pegam o mesmo)
                                          ▼
                              provedor (Evolution; simulado nos testes) ──► cliente
                                          │  id da mensagem guardado
                                          ▼
                              campanha_concluir_envio   enviado | nova tentativa (transitório, até 3:
                                                        +1 min, +5 min) | erro | incerto (nunca reenvia)
webhook do robô (messages.update) ──► campanha_registrar_status   entregue / lido (idempotente)
cliente abre /c/<token> ──► campanha_registrar_clique ──► 302 para /loja/<slug>
painel (aba Métricas) ──► /api/admin/campanhas/metricas ──► campanhas_metricas / campanha_destinatarios
```

## O que é real e o que é estimado

| Métrica | Fonte | Observação |
|---|---|---|
| Enviadas, falhas, incertas, tentativas | fila (`campanha_envios`) | real |
| Entregues, lidas | evento `messages.update` da Evolution | só chega com o webhook da loja pedindo esse evento (hoje os webhooks do robô assinam só `MESSAGES_UPSERT`). “Lida” é um **piso**: quem desliga a confirmação de leitura nunca aparece |
| Respondidas | `whatsapp_mensagens` (entrada) do mesmo telefone em até 12h | só em lojas com o robô ligado (é ele que grava a mensagem) |
| Cliques | `/c/<token>` | real; pré-visualização do WhatsApp, robôs e HEAD não contam; toque repetido em 10s não conta |
| Pedidos em 12h | `pedidos` não cancelados do mesmo telefone (`telefone_chave`) nas 12h após o envio | com clique antes do pedido = **confirmado**; sem clique = **provável**. Cada pedido conta para um envio só (o mais recente antes dele) |
| Faturamento | soma do `total` desses pedidos | segue a atribuição acima |
| Conversão | clientes que pediram ÷ enviadas | |
| Duplicidades barradas | telefone repetido na lista, status repetido do webhook, clique repetido | |

Nada é gravado em `pedidos`: a atribuição é calculada na leitura.

## Link

`https://app.menuzia.com.br/c/<24 hex>` — aleatório por destinatário, sem telefone, nome ou
id da campanha. Na mensagem: `{link}` vira o link; sem o marcador, ele vai no fim. Só
com a opção “Incluir link do cardápio” (nasce ligada nas campanhas novas; as antigas
ficaram com ela desligada). Áudio não leva link.

## Travas contra envio indevido

- Nada sai com mais de 24h de atraso sobre o horário agendado (vira `expirado`).
- Campanha que já começou a sair não é editada nem redisparada (409).
- Cancelar marca a fila como `cancelado` (dá para cancelar em “Enviando”).
- Telefone repetido (com/sem 55, com/sem o 9) é barrado na lista e no banco.
- O eco da campanha no WhatsApp da loja não silencia o robô para aquele cliente.
- 0104 encerrou SEM enviar as 4 campanhas da Estância paradas desde 15/08 e 15/09
  (95 envios), combinado com o dono em 2026-09-27.

## Testes

`scripts/seguranca/e2e-campanhas-metricas.mjs` (60 verificações; provedor simulado, lojas
`camp-e2e-*`). Servidor local com `WHATSAPP_PROVEDOR=simulado`,
`WHATSAPP_SIMULADO_ARQUIVO`, `CRON_SECRET`, `WHATSAPP_ROBO_LIBERADO=1` e
`CAMPANHA_INTERVALO_MS=20`.

## Rollback

1. Código: redeploy do commit anterior.
2. Banco (depois do código): `docs/rollback/0104_campanhas_metricas.down.sql`. Não reabre as
   campanhas encerradas.
