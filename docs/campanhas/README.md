# Campanhas — disparo, cards recorrentes e métricas (0104 → 0248)

Desenho dos cards recorrentes: `docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md`.

## Fluxo

```
Agendamentos (/admin/campanhas?aba=agendamentos) ─POST/PATCH─► campanhas + campanha_envios (1 por telefone, token próprio)
Cards recorrentes (?aba=campanhas, 3 por loja) ──► campanha_recorrentes (programação; proximo_disparo_em por trigger)
                                          │
cron 1/min (/api/cron/campanhas)          │  a cada 10 min no máximo: campanha_recorrentes_gerar_rodadas()
   ├─► card vencido vira UMA campanha comum (+ fila) — agenda avança na mesma transação, skip locked
   └─► campanha_reservar_envios(5)   expira (agendamento > 7 dias; rodada de card: fim da janela do dia),
                                          │  trava vencida → incerto, 1 envio por loja por chamada,
                                          │  próxima mensagem da loja em 60–150 s, 2 dias por cliente, teto diário
                                          ▼
                              provedor (Evolution; simulado nos testes) ──► cliente
                                          ▼
                              campanha_concluir_envio   enviado | nova tentativa (transitório, até 3: +1 min, +5 min) | erro | incerto
freio (erro > 5% ou SAIR > 3% a partir de 20)  ──► pausa a campanha; rodada de card também DESLIGA o card
webhook do robô (messages.update) ──► campanha_registrar_status   entregue / lido (idempotente)
cliente abre /c/<token> ──► campanha_registrar_clique ──► 302 para /loja/<slug>
painel (Visão geral) ──► /api/admin/campanhas/visao-geral ──► campanhas_visao_geral (72 h)
painel (detalhado)   ──► /api/admin/campanhas/metricas     ──► campanhas_metricas / campanha_destinatarios (72 h desde a 0245)
```

## Cards recorrentes (0245 → 0248)

Base de público (0248): quem tem **conversa** com a loja no WhatsApp (inclui quem recebeu aviso de pedido); nunca quem
pediu SAIR; nunca quem já entrou em rodada hoje; 1 por `telefone_chave`.

| Card | O que guarda | Público |
|---|---|---|
| Recuperação de clientes | 1 agenda; até 5 copies em rodízio (`mensagens`, `mensagem_indice`); até 6 imagens em rodízio (grade 3 × 2) | já pediu e o último pedido foi há 30 dias ou mais |
| Disparo personalizado (chave interna `nunca_compraram`) | até 5 anúncios (`campanha_recorrente_anuncios`), cada um com cor, copy, até 5 imagens em rodízio, dias, horário e públicos | união dos públicos escolhidos (13 opções em `campanha_publico_bate`) |
| Promoções | até 5 anúncios, cada um com 1 foto, copy, dias e horário | a base inteira |

- Nascem **desligados**. Só ligam prontos (trigger): Recuperação com imagem e copy; Promoções/Personalizado com pelo
  menos 1 anúncio e todos completos. Anúncio que ficar incompleto com o card ligado fica **sem agenda** (não sai).
- Agenda: Recuperação no card; Promoções/Personalizado em cada anúncio (`proximo_disparo_em`, índice parcial).
- Aquecimento (0247): 15/dia nos 3 cards juntos, +5 a cada 5 dias. A cota que resta é **dividida** entre os disparos
  que ainda saem hoje (`campanha_recorrente_pendentes_hoje`): 2 promoções no mesmo dia com 15 de cota = 8 + 7.
- Prioridade no mesmo minuto: Recuperação → Personalizado → Promoções; ninguém entra em duas rodadas no dia.
- Rodada só enfileira o que cabe na janela com 105 s por mensagem (média de 60–150 s), nunca acima do teto da loja;
  quem nunca recebeu vai primeiro, depois quem recebeu há mais tempo. O resto expira no fim da janela.
- Copy: editor visual (negrito/itálico/riscado e variáveis como etiquetas), gravado no formato do WhatsApp
  (`*negrito*`, `_itálico_`, `~riscado~`, `{nome}`, `{loja}`, `{link_cardapio}`, `{ultimo_item}` só na Recuperação).
- Freio numa rodada desliga o card (`desligado_motivo`); religar é decisão da loja.
- Módulo `disparos` desligado no Super Admin = o card nem é lido pelo cron.

## O que é real e o que é estimado

| Métrica | Fonte | Observação |
|---|---|---|
| Enviadas, falhas, incertas, tentativas | fila (`campanha_envios`) | real |
| Entregues, lidas | evento `messages.update` da Evolution | só lojas com webhook; "lida" é um **piso** (quem desliga a confirmação de leitura nunca aparece) |
| Respondidas | `whatsapp_mensagens` (entrada) do mesmo telefone em até 72 h | só em lojas com o robô ligado |
| Cliques | `/c/<token>` | real; pré-visualização, robôs e HEAD não contam; toque repetido em 10 s não conta |
| Pedidos | `pedidos` não cancelados do mesmo telefone (`telefone_chave`) em até **72 h** após o envio | com clique antes = **confirmado**; sem clique = **provável**. Cada pedido conta para um envio só (o mais recente antes dele) |
| Receita gerada | soma do `total` desses pedidos | segue a atribuição acima |
| Recorrentes / recuperados | último pedido anterior ao envio: < 30 dias / ≥ 30 dias | |
| Sucesso (%) | enviadas ÷ tentadas | |

Nada é gravado em `pedidos`: a atribuição é calculada na leitura. Visão geral e detalhado usam a mesma janela (72 h) desde a 0245.

## Link

`https://app.menuzia.com.br/c/<24 hex>` — aleatório por destinatário, sem telefone, nome ou id da campanha. `{link}` vira o
link; sem o marcador, ele vai no fim. Só com "Incluir link do cardápio". Áudio não leva link.

## Travas contra envio indevido

- Agendamento com mais de 7 dias de atraso vira `expirado`; rodada de card expira no fim da janela do próprio dia.
- Janela global 09:00–21:30 (Brasília); teto diário por loja (`disparo_limite_dia` ≤ `disparo_teto_dia`); 60–150 s entre
  mensagens da mesma loja; 1 mensagem por pessoa a cada `disparo_frequencia_dias` (2).
- Campanha que já começou a sair não é editada nem redisparada (409). Cancelar marca a fila como `cancelado`.
- Telefone repetido (com/sem 55, com/sem o 9) é barrado na lista e no banco.
- WhatsApp da loja desconectado pausa e retoma sozinho; freio (erro/SAIR) pausa e não retoma sozinho.
- Rodada dupla é impossível por construção: a agenda do card avança na mesma transação que cria a rodada.

## Testes

- Unitários: `lib/mensageria/recorrentes.test.ts`, `campanhas-envio.test.ts`, `campanhas-freio.test.ts`, `lib/queries/recorrentes.test.ts`,
  `components/admin/campanhas/*.test.tsx`, `supabase/migrations/0245_*.test.ts`.
- `scripts/seguranca/e2e-campanhas-metricas.mjs` (provedor simulado, lojas `camp-e2e-*`; seção 12 = cards recorrentes).
  Servidor local com `WHATSAPP_PROVEDOR=simulado`, `WHATSAPP_SIMULADO_ARQUIVO`, `CRON_SECRET`, `WHATSAPP_ROBO_LIBERADO=1`,
  `CAMPANHA_INTERVALO_MS=20` e `CAMPANHA_CHECAGEM_CARDS_MS=0` (a checagem dos cards a cada 10 min vira "a cada chamada").

## Rollback

1. Código: redeploy do commit anterior.
2. Banco (depois do código): `docs/rollback/0245_disparos_recorrentes.down.sql` e, se preciso, `0104_campanhas_metricas.down.sql`.
