# Robô de atendimento pelo WhatsApp — auditoria (2026-09-25)

Branch `feat/robo-whatsapp-auditoria` (a partir da main `a074f3f`). Só leitura em produção:
nenhuma mensagem enviada, nenhuma instância, sessão, webhook ou configuração alterada.
Impressão não foi tocada.

## Conclusão

**Não existe robô de atendimento.** Nem no código, nem no banco, nem no servidor Evolution:

| Onde procurei | Resultado |
|---|---|
| Código (app, lib, scripts, middleware) | Nenhuma rota que RECEBE mensagem do WhatsApp. Só conexão da instância (`/api/admin/whatsapp/conectar`, `desconectar`, `status`) e envios de saída. |
| Histórico git (todas as branches) | Nenhum commit de robô, chatbot, webhook de mensagens (`messages.upsert`). |
| Banco de produção | Nenhuma tabela de conversa, mensagem, atendimento ou bot. Única coluna: `restaurantes.evolution_instance`. |
| Evolution (GETs) | Nenhuma instância das lojas com webhook configurado. Nenhum bot nativo (OpenAI, Typebot, EvolutionBot, Dify, n8n, Flowise) em nenhuma instância. Chatwoot desligado. |
| IA/LLM | Nenhuma chave, SDK ou prompt no projeto. |

Hoje, mensagem que um cliente manda para o número da loja fica só no WhatsApp da loja (e no
banco da Evolution). Ninguém responde automaticamente e o sistema da Menuzia não a lê.

## Os três sistemas (e um quarto)

1. **“Dúvidas?”** (`components/admin/modal-suporte.tsx`, `lib/suporte.ts`): link `wa.me` para o
   suporte da Menuzia. Não usa a Evolution.
2. **Campanhas** (`app/api/cron/campanhas`, `lib/queries/campanhas.ts`): disparos de saída pela
   instância da loja. Fora do escopo.
3. **Robô de atendimento**: **inexistente**.
4. **Avisos de pedido** (não pedido nesta lista, mas também usam o WhatsApp da loja):
   `lib/whatsapp.ts › notificarPedido` (aceito, pronto, saiu, entregue), fidelidade
   (`lib/fidelidade.ts`) e código de verificação do checkout (`lib/queries/clientes.ts`).
   Todos são SAÍDA, disparados por ação no sistema.

## Como o WhatsApp funciona hoje

- **Provedor:** Evolution API self-hosted (`evolution.menuzia.com.br`), integração Baileys
  (WhatsApp Web não oficial). URL e chave globais no servidor (`EVOLUTION_API_URL`/`KEY`).
- **Conexão por loja:** Ajustes/Integrações → QR code → instância `menuzia-<id-da-loja>`
  gravada em `restaurantes.evolution_instance`. Rotas conferem a sessão; o middleware exige
  `integracoes.gerenciar`.
- **Envio:** `POST /message/sendText|sendMedia|sendWhatsAppAudio/<instância>`, sem fila, sem
  retentativa e sem chave de idempotência. Falha vira `console.error` com o corpo da resposta.

### Estado por loja (sem números)

| Loja | Instância | Estado | Observação |
|---|---|---|---|
| belgas | sim | desconectada | nunca trocou mensagem |
| estancia-burger | sim | desconectada desde 21/09 | ~15 mil mensagens guardadas na Evolution |
| mama-pizza | não | — | — |
| menuzia | sim | **conectada** | ~112 mil mensagens guardadas |
| pizza-do-rosa | não | — | — |
| ponto-400-hamburgueria | não | — | — |
| teste | não | — | — |
| villa-lanches | sim | desconectada | ~3,6 mil mensagens guardadas |

Nenhuma com webhook, bot ou Chatwoot ligado.

## Riscos encontrados (sem correção nesta etapa)

1. **Retenção na Evolution:** a Evolution guarda todo o histórico das conversas das lojas
   (dezenas de milhares de mensagens, contatos e chats), sem política de expiração. Dados
   pessoais de clientes das lojas, fora do banco da Menuzia e sem regra de retenção ou
   exclusão.
2. **Instâncias órfãs:** 6 das 10 instâncias não estão ligadas a nenhuma loja. Quatro seguem o
   padrão `menuzia-<id>` (lojas apagadas ou recadastradas), duas com ~9 mil e ~14 mil
   mensagens retidas; duas são de outro sistema.
3. **Servidor Evolution compartilhado com outro projeto** (uma instância aponta webhook para
   `n8n.nr1sistema.com.br`). A mesma chave global dá acesso a todas as instâncias dos dois
   projetos: um vazamento dela expõe as conversas de todas as lojas.
4. **Envio sem fila nem idempotência:** um aviso de pedido chamado duas vezes (duplo clique,
   retentativa) é enviado duas vezes; falha do provedor não é registrada para nova tentativa.
5. **Log de erro com o corpo da resposta da Evolution** (`console.error(... res.text())`),
   que pode conter o número do cliente.

Itens 4 e 5 são do fluxo de saída (avisos, campanhas), fora do escopo do robô, mas o robô
reutilizaria o mesmo envio.

## Arquitetura mínima recomendada (a decidir antes de construir)

Construir o robô é um módulo novo, não uma correção. Proposta mínima e segura:

1. **Entrada:** `POST /api/whatsapp/webhook/<segredo-por-instância>` (evento
   `MESSAGES_UPSERT`), segredo aleatório por loja guardado no banco e registrado na Evolution
   (`/webhook/set`). A loja vem SÓ do segredo/instância, nunca do corpo. Ignora grupos, status,
   mensagens enviadas pela própria loja (`fromMe`).
2. **Banco (migration nova, aditiva):**
   - `whatsapp_conversas` (loja, telefone normalizado, estado `robo | aguardando_humano |
     humano | encerrada`, quem assumiu, última atividade, opt-out);
   - `whatsapp_mensagens` (conversa, id da mensagem no WhatsApp **único por instância** →
     idempotência, direção, tipo, texto truncado, horário do WhatsApp, estado de envio);
   - RLS por `restaurante_id` e papel; `service_role` só no webhook e no worker;
   - retenção: apagar conteúdo após N dias (a definir) e anonimizar telefone depois.
3. **Processamento:** fila no próprio Postgres (linha `pendente` travada com
   `for update skip locked`), processada pela mesma rota ou por cron. Uma resposta por
   mensagem recebida (chave única resposta→mensagem de origem). Envio com chave de
   idempotência e registro de falha para nova tentativa.
4. **Resposta — sem IA na primeira versão:** menu por intenção simples (horário/aberto, link
   do cardápio, taxa/bairro, status do último pedido DESTE telefone, falar com pessoa), usando
   as mesmas funções da vitrine (`lojaEstaAberta`, `listarCardapioPublico`, frete de
   `lib/frete`). Sem preço inventado: link do cardápio para o resto. Áudio, imagem, figurinha
   e localização → resposta padrão e opção de humano.
5. **Humano:** “falar com pessoa” ou palavra-chave muda o estado para `aguardando_humano`; o
   robô silencia. A loja responde pelo próprio WhatsApp; volta ao robô por botão no painel ou
   após X horas sem conversa. Central de atendimento completa no painel fica para depois.
6. **IA (opcional, fase 2):** só com ferramentas fechadas (as mesmas consultas do item 4),
   loja fixada no servidor, limite de tokens e de interações por conversa, prompt sem dados
   internos e testes de prompt injection.
7. **Painel:** em Integrações, ligar/desligar o robô, horário, mensagem inicial, estado da
   conexão e último sinal, conversas aguardando humano.

**Impacto:** 1 migration, ~3 rotas, 1 fila/worker, telas em Integrações, suíte de testes com
provedor simulado. Toca a instância da Evolution (registrar webhook) — exige autorização por
loja. Número oficial (API do WhatsApp Business/Meta) evitaria o risco de bloqueio do Baileys,
mas muda de provedor e custo.

## Roteiro de teste real controlado (depois de construído)

1. Loja de teste com instância própria, conectada a um número de teste autorizado.
2. Um único telefone autorizado (lista branca no servidor; todo o resto é ignorado).
3. Robô ligado só nessa loja; demais lojas sem webhook.
4. Roteiro: “Oi” → “Vocês estão abertos?” → “Entrega no bairro X?” → “Cadê meu pedido?” →
   “Quero falar com uma pessoa” → confirmar silêncio → devolver ao robô no painel.
5. Conferir no banco: uma resposta por mensagem, nenhuma mensagem para outro número.
6. Desligar o robô e remover o webhook ao fim.
