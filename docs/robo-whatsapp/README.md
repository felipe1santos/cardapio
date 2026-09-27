# Robô de atendimento do WhatsApp — v1 (sem IA)

Branch `feat/robo-whatsapp-auditoria`. Migration **0103** (só local; NÃO aplicada em produção).

## Como funciona

```
cliente ──WhatsApp──► Evolution ──POST /api/whatsapp/webhook/<segredo-da-loja>──► Menuzia
                                                     │  loja = segredo (nunca o corpo)
                                                     ▼
                         whatsapp_registrar_entrada (trava da conversa, wa_id único)
                                                     │  ação: boas_vindas | status | atendente | padrao | nada
                                                     ▼
                              whatsapp_envios (fila, 1 resposta por mensagem)
                                                     │  processada na hora; falhas pelo cron
                                                     ▼
                          ProvedorWhatsapp (Evolution hoje) ──► cliente
```

- **Boas-vindas:** primeira mensagem ou 12h sem conversa; nome da loja + link do cardápio +
  menu (1 status, 2 atendente). Texto próprio da loja em Integrações.
- **Status:** último pedido DESTE telefone NESTA loja (com/sem 55 e com/sem o 9), com o
  mesmo rótulo da vitrine (`lib/status-pedido-cliente.ts`).
- **Atendente:** “2”, “atendente”, “falar com uma pessoa”… silencia a conversa; volta
  sozinho após 2h sem mensagens ou pelo botão “Devolver ao robô”.
- **Mídia e texto não reconhecido:** resposta padrão (link + opção de atendente), no
  máximo uma a cada 10 minutos por conversa.
- **Nunca responde:** grupo, status/broadcast/canal, número da própria loja, contato sem
  número identificável (@lid) e mensagens da loja (fromMe). A loja escrevendo à mão pelo
  celular silencia a conversa; o eco do que o próprio robô mandou é ignorado.
- **Não faz (v1):** taxa por bairro, aberto/fechado, pedido, preço, IA.

## Avisos de etapa do pedido

Mesmos textos; agora pela fila, chave `pedido:<id>:<etapa>` (duplo clique = 1 envio),
nova tentativa em falha transitória (30s, 60s, 120s, 240s; até 5 tentativas). Tempo
esgotado com o provedor = `incerto`, sem reenvio automático (pode ter saído).

## Arquivos

| Onde | O quê |
|---|---|
| `supabase/migrations/0103_whatsapp_robo_e_fila.sql` | tabelas, RLS, funções, retenção |
| `lib/mensageria/provedor.ts` | interface de provedor, Evolution, simulado |
| `lib/mensageria/robo.ts` | intenção e textos (puro) |
| `lib/mensageria/entrada.ts` | webhook → decisão → fila |
| `lib/mensageria/fila.ts` | enfileirar e processar |
| `lib/mensageria/mascara.ts` | telefone mascarado nos logs |
| `lib/whatsapp.ts` | avisos pela fila; envios diretos pelo provedor |
| `app/api/whatsapp/webhook/[segredo]` | entrada |
| `app/api/cron/whatsapp` | novas tentativas + retenção (CRON_SECRET) |
| `app/api/admin/whatsapp/robo` (+ `/reativar`) | painel (dono) |
| `components/admin/robo-whatsapp.tsx` | cartão em Integrações |

## Publicação (quando autorizado)

1. Aplicar 0103 (aditiva; robô nasce desligado em toda loja).
2. Deploy. Os avisos de pedido já passam pela fila (sem mudança de texto).
3. Cron no Coolify: `POST /api/cron/whatsapp` a cada 1 minuto com `x-cron-secret`.
4. Robô só funciona numa loja depois de: ligar em Integrações **e** registrar o webhook da
   instância (passo manual, ver teste real).

Rollback: código anterior + `docs/rollback/0103_whatsapp_robo_e_fila.down.sql`.

## Teste real controlado — só Menuzia, um número autorizado

Pré-requisito: 0103 aplicada e deploy feito, com autorização. Nada disto foi executado.

1. **Lista branca:** antes de registrar o webhook, definir no Coolify
   `WHATSAPP_ROBO_SOMENTE=<número autorizado, só dígitos>` e fazer Redeploy. Qualquer outro
   número é ignorado sem gravar nada (`numeroPermitido`, testado). Sem a variável,
   qualquer cliente da Menuzia que escrever recebe resposta.
2. Em Integrações (Menuzia), ligar o robô.
3. Pegar o segredo (só no banco, service role):
   `select webhook_segredo from whatsapp_robo_config where restaurante_id = '<id da menuzia>';`
4. Registrar o webhook **só na instância da Menuzia**:
   `POST {EVOLUTION_API_URL}/webhook/set/menuzia-824468ae-a16a-43d6-ab82-37e23fbecb38`
   corpo `{"webhook":{"enabled":true,"url":"https://app.menuzia.com.br/api/whatsapp/webhook/<segredo>","byEvents":false,"base64":false,"events":["MESSAGES_UPSERT"]}}`
   (conferir o formato na versão instalada; header `apikey`).
5. Do número autorizado: “Oi” → espera boas-vindas; “1” → status (ou “não encontrei”);
   foto → resposta padrão; “2” → aviso de atendente; “oi” → **nenhuma** resposta; no
   painel, “Devolver ao robô”; “oi” → responde de novo; alguém da loja responde à mão pelo
   celular → robô silencia.
6. Conferir no banco: uma resposta por mensagem, todos os envios para o número autorizado.
7. **Encerrar:** desligar o robô; `POST /webhook/set/<instância>` com `"enabled": false`;
   remover `WHATSAPP_ROBO_SOMENTE` só quando for liberar para todos.
