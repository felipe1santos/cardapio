# Robô de atendimento do WhatsApp — v1 (sem IA)

Migration **0103**. Publicado desligado; piloto aprovado na Menuzia e **liberado para todas
as lojas em 2026-09-27** (ver “Liberação geral” abaixo).

## Três travas (todas precisam estar abertas para uma mensagem sair)

1. **Servidor:** `WHATSAPP_ROBO_LIBERADO=1` no ambiente (Coolify). Sem ela o webhook não
   grava nem responde, a fila recusa respostas do robô e o painel não deixa ligar.
2. **Loja:** ligar em Integrações (dono). Toda loja nasce com `robo_ativo = false`.
3. **Webhook:** registrar na Evolution a URL com o segredo da loja (passo manual, abaixo).
   Nada disso foi feito na publicação.

Extra para o piloto: `WHATSAPP_ROBO_SOMENTE=<números>` restringe o robô a números
autorizados (os outros são ignorados sem gravar nada).

## Como funciona

```
cliente ──WhatsApp──► Evolution ──POST /api/whatsapp/webhook/<segredo-da-loja>──► Menuzia
                                                     │  loja = segredo (nunca o corpo)
                                                     │  instância do corpo ≠ da loja → ignora
                                                     ▼
                         whatsapp_registrar_entrada (trava da conversa, wa_id único)
                                                     │  ação: boas_vindas | status | cardapio |
                                                     │        horario | taxa | atendente | padrao | nada
                                                     ▼
                              whatsapp_envios (fila, 1 resposta por mensagem)
                                                     │  confere servidor + loja na hora de sair
                                                     ▼
                          ProvedorWhatsapp (Evolution; simulado nos testes) ──► cliente
```

- **Menu (0):** saudação + link do cardápio + opções 1–5. “Oi”, “bom dia”, “menu” também.
- **1 Status:** último pedido DESTE telefone NESTA loja (com/sem 55 e com/sem o 9), com
  o mesmo rótulo da vitrine.
- **2 Atendente:** conversa silenciada (modo humano), evento `atendente`; o robô não
  responde mais nela. Volta sozinho após **12h** sem mensagens (configurável 15 min–24h)
  ou pelo “Devolver ao robô” em Integrações. A loja respondendo à mão pelo celular também
  silencia (`loja_assumiu`).
- **3 Cardápio:** link da vitrine.
- **4 Horário:** aberto/fechado agora (inclui trava manual) e a grade da semana.
- **5 Taxa:** “taxa Centro” → valor do bairro CADASTRADO. Não geocodifica e não grava
  nada; com faixas por distância diz “pode sair menor”/“depende da distância”; fora da
  lista só a taxa padrão se a loja aceita. O valor final é sempre o do cardápio.
- **Mídia:** áudio, imagem, vídeo, figurinha, documento, contato e localização têm
  resposta própria (com link e menu). Texto não reconhecido: “Não entendi” + menu, no
  máximo uma a cada 10 min.
- **Nunca responde:** grupo, status/broadcast/canal, número da própria loja, contato sem
  número (@lid), mensagem da loja (fromMe) e o eco do que o próprio robô mandou.
- **Não faz:** criar, cancelar ou alterar pedido; receber pagamento; preço de item; IA.

## Duplicidade e segurança

- `wa_id` único por loja: reentrega e replay não geram segunda resposta; mensagens
  simultâneas do mesmo cliente são serializadas pela trava da conversa.
- Fila: chave de idempotência única por loja, no máximo uma resposta por mensagem,
  `for update skip locked` (dois crons nunca pegam o mesmo envio), tentativas com espera
  (30s, 60s, 120s, 240s; até 5), tempo esgotado = `incerto` (sem reenvio automático).
- Segredo de 48 hex por loja; o painel mostra só os 4 últimos e permite trocar (o antigo
  para na hora). Corpo limitado a 256 KB e nunca logado; logs com telefone mascarado.
- RLS: dono e gerente leem conversas, mensagens, envios e eventos da própria loja; a
  configuração (segredos) só o servidor. Escrita só pelo servidor.
- Retenção (`whatsapp_limpar_antigos`, pelo cron): texto e nome somem aos 90 dias;
  metadado (quando, tipo, estado) sai aos 12 meses.

## O que NÃO mudou

Avisos de etapa do pedido, campanhas, código do checkout e fidelidade seguem o envio
direto de `lib/whatsapp.ts` (igual à main). Levar os avisos para a fila é etapa futura.
**O interruptor do robô não mexe neles** — desligado, só param as respostas às mensagens
recebidas (provado em `lib/mensageria/robo-flag.test.ts` e nos e2e).

## Central de atendimento (0107, 2026-09-28)

Atendimento humano no próprio painel — ver `central-atendimento.md`. O que muda no robô:

- **Robô desligado agora grava** a mensagem recebida e a conversa entra direto como
  "aguardando atendente" (antes: nada era gravado). Resposta automática continua não saindo.
- Toda saída da Menuzia (robô, atendente, aviso de pedido, fidelidade, código do checkout,
  disparo) entra no histórico com a origem. O eco (fromMe) dessas saídas é reconhecido pelo
  id do provedor ou pelo hash do texto e **não** silencia mais a conversa como "a loja
  respondeu pelo celular" (isso acontecia com os avisos de pedido).

## Arquivos

| Onde | O quê |
|---|---|
| `supabase/migrations/0103_whatsapp_robo_e_fila.sql` | tabelas, RLS, funções, retenção |
| `lib/mensageria/robo.ts` | intenções e textos (puro) + trava do servidor |
| `lib/mensageria/entrada.ts` | webhook → decisão → fila (+ evento) |
| `lib/mensageria/fila.ts` | enfileirar e processar |
| `lib/mensageria/provedor.ts` | Evolution e simulado |
| `lib/mensageria/conversas.ts` | conversas para o painel |
| `app/api/whatsapp/webhook/[segredo]` | entrada |
| `app/api/cron/whatsapp` | novas tentativas + retenção (CRON_SECRET) |
| `app/api/admin/whatsapp/robo` | configuração (dono) |
| `app/api/admin/whatsapp/conversas` | devolver/pausar (dono e gerente) |
| `components/admin/robo-whatsapp.tsx` | cartão em Integrações |
| `supabase/migrations/0107_whatsapp_central_atendimento.sql` | central: estados, origem, tags, RPCs |
| `lib/mensageria/historico.ts` | registrar saída / reconhecer eco |
| `lib/mensageria/atendimento.ts` | consultas da central (paginadas) |
| `app/api/admin/whatsapp/atendimento/*` | central (dono e gerente) |
| `components/atendimento/lancador.tsx` + `central.tsx` | botão flutuante + painel (sob demanda) |

## Testar sem mensagem real

Servidor local (`scripts/seguranca/servidor-local.mjs`, que já apaga as variáveis da
Evolution) com `WHATSAPP_PROVEDOR=simulado WHATSAPP_SIMULADO_ARQUIVO=<arq>
CRON_SECRET=<x> WHATSAPP_ROBO_LIBERADO=1`, e:

```
ROBO_E2E_LOJA=robo-e2e-a ROBO_E2E_VIZINHA=robo-e2e-b ROBO_PROVEDOR=simulado \
WHATSAPP_SIMULADO_ARQUIVO=<arq> CRON_SECRET=<x> node scripts/seguranca/e2e-robo-whatsapp.mjs
```

Fase bloqueada (como produção): suba SEM `WHATSAPP_ROBO_LIBERADO` e rode com
`ROBO_E2E_FASE=bloqueado`.

Central de atendimento: mesmas variáveis, `node scripts/seguranca/e2e-atendimento-whatsapp.mjs`
(71 verificações). Tela Integrações: `E2E_LOJA=cantina-pdv2 E2E_VIZINHA=vizinha-pdv2
E2E_SUFIXO=pdv2 node scripts/seguranca/e2e-integracoes-fase1.mjs` (21).

## Ativação piloto (com autorização, uma loja)

1. Cron no Coolify: `POST /api/cron/whatsapp` a cada 1 minuto com `x-cron-secret`.
2. Coolify: `WHATSAPP_ROBO_LIBERADO=1` e `WHATSAPP_ROBO_SOMENTE=<número autorizado>`;
   Redeploy.
3. Integrações da loja piloto: ligar o robô.
4. Segredo (só service role):
   `select webhook_segredo from whatsapp_robo_config where restaurante_id = '<id>';`
5. Registrar o webhook **só na instância da loja piloto** (ver
   `instancias-evolution.md`; NUNCA nas instâncias órfãs nem nas do NR13):
   `POST {EVOLUTION_API_URL}/webhook/set/<instância>` corpo
   `{"webhook":{"enabled":true,"url":"https://app.menuzia.com.br/api/whatsapp/webhook/<segredo>","byEvents":false,"base64":false,"events":["MESSAGES_UPSERT"]}}`
   — conferir antes se a instância já tem webhook de outro uso (não sobrescrever sem ver).
6. Do número autorizado: “oi”, “1”, “3”, “4”, “taxa <bairro>”, foto, “2”, “oi” (silêncio),
   “Devolver ao robô”, “oi”, e a loja respondendo à mão.
7. Conferir: uma resposta por mensagem; tudo para o número autorizado.
8. Encerrar/rollback rápido: desligar em Integrações (a fila recusa o que estiver
   pendente) ou tirar `WHATSAPP_ROBO_LIBERADO`; webhook com `"enabled": false`.

## Liberação geral (2026-09-27)

- Coolify: `WHATSAPP_ROBO_SOMENTE` **removida**, `WHATSAPP_ROBO_LIBERADO=1` mantida;
  Redeploy de 08eb2e8 (17:45–17:48 UTC). Cron “Robô WhatsApp (fila e retenção)” segue 1/min.
- Robô ligado (retorno 12h): **menuzia** (instância `menuzia-824468ae…`, webhook desde o
  piloto) e **estancia-burger** (instância `menuzia-48ecbd08…`, conectada; não tinha
  webhook — registrado só `MESSAGES_UPSERT`, estado anterior guardado).
- Prontas, esperando o WhatsApp da loja conectar (robô desligado, sem webhook):
  villa-lanches (instância existe, desconectada), belgas (instância “connecting”),
  mama-pizza, pizza-do-rosa, ponto-400-hamburgueria e teste (sem instância). Para ligar:
  conectar o WhatsApp → passos 3–5 da ativação piloto → ligar em Integrações.
- Não tocados: instância do NR13 (webhook de outro sistema) e instâncias órfãs.
- Proteção contra loop (0105, 2026-09-27): se o robô já respondeu **8 vezes em 2 min**
  (ou **20 em 20 min**) na mesma conversa, ele sai dela — conversa silenciada com motivo
  `protecao` e evento `protecao_loop` com as contagens. A mensagem do outro lado segue
  gravada; a loja vê a conversa em Integrações (“pausada por proteção”) e pode devolver
  ao robô; volta sozinho pelo tempo de retorno da loja. Limites por loja em
  `whatsapp_robo_config.protecao_curta` / `protecao_longa`. O piloto teve no máximo 14
  respostas em ~17 min numa conversa humana.
- Webhooks da Menuzia e da Estância assinam também `MESSAGES_UPDATE` (entrega/leitura das
  campanhas). Status que não é de campanha não vira registro (um marcador por hora em
  `whatsapp_eventos`, `so_status: true`, prova que o provedor está mandando).

## Painel (Integrações) — cliente × suporte (2026-09-27)

- **Dono vê:** robô Ligado/Desligado (interruptor no canto do cartão), conexão do WhatsApp
  (conectado / não conectado / aguardando QR code / erro), mensagens recebidas e respostas
  nas últimas 24h, e quem está aguardando atendente (com “Devolver ao robô”). Ligar exige o
  WhatsApp conectado e a liberação do servidor; desligar sempre pode.
- **Só o suporte** (e-mail em `SUPERADMIN_EMAILS`, logado na loja): boas-vindas, tempos,
  webhook mascarado e troca do segredo, no bloco “Configurações avançadas”. A API só manda
  esses dados com `suporte: true` e recusa as alterações dos demais (403 `so_suporte`).
  Sem acesso de suporte: `update whatsapp_robo_config set boas_vindas=…, boas_vindas_horas=…,
  retorno_minutos=… where restaurante_id=…` (service role).
- **Próxima etapa (não feita):** aviso no canto inferior direito do painel quando uma
  conversa entrar em “aguardando atendente” e, depois, WhatsApp integrado dentro da
  Menuzia. Fonte: `/api/admin/whatsapp/conversas` (`emAtendimento`) e o evento `atendente`.

## Rollback

1. Rápido, sem deploy: desligar o robô da loja em Integrações (ou
   `update whatsapp_robo_config set robo_ativo=false where restaurante_id=…`); webhook da
   instância com `"enabled": false`. Com deploy: remover `WHATSAPP_ROBO_LIBERADO` (tudo
   para) ou recriar `WHATSAPP_ROBO_SOMENTE=5527992534407` (volta ao piloto) + Redeploy.
2. Código: redeploy do commit anterior.
3. Banco (depois do código): `docs/rollback/0103_whatsapp_robo_e_fila.down.sql` — apaga
   só dados do robô; pedidos, campanhas e avisos não dependem das tabelas.
