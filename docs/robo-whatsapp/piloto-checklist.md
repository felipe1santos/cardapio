# Piloto do robô WhatsApp v1 — checklist operacional

Preparado em 2026-09-27. **Nada disto foi executado.** Cada passo marcado 🔒 só com
autorização explícita do dono.

## 0. Estado conferido (2026-09-27, só leitura)

- `main` = `origin/main` = `30e5313`; produção em `0103_whatsapp_robo_e_fila.sql`.
- 8 lojas com configuração do robô, **0 ligadas**; 0 conversas, mensagens, envios, eventos.
- Evolution 2.3.7: 10 instâncias; webhooks idênticos à foto de antes da publicação; só
  `nr13-leads` tem webhook (outro sistema); nenhuma aponta para o robô.
- Integrações (Menuzia): robô DESLIGADO, "não liberado", botão de ligar desabilitado,
  WhatsApp conectado, webhook mascarado `••••ffc6`.

## 1. Loja piloto: **menuzia**

- Loja de testes; instância `menuzia-824468ae-a16a-43d6-ab82-37e23fbecb38`, **open**.
- **Sem webhook** configurado hoje → nada a sobrescrever.
- Número conectado na instância termina em **0804** (é o WhatsApp da loja). O número de
  teste NÃO pode ser esse: o robô ignora mensagens do próprio número da loja.
- Dados para os testes: grade 08:00–22:00 todos os dias; loja em "aberto manual"; 7
  bairros (inclui `Jaburuna` R$ 5,89 e `jardim colorado` R$ 2,50) e 1 faixa por raio (a
  resposta de taxa diz "pode sair menor, dependendo da distância").
- Pedidos existentes por telefone (mascarados): `5527*****9932` (último #127, cancelado),
  `5527*****4407` (último #99, 04/09).

## 2. Número autorizado (decisão do dono)

Um celular de teste que (a) não é o 0804, (b) pertence a quem vai testar e (c) de
preferência já tem pedido na Menuzia (para o teste de status). Candidatos: o final 9932
ou o 4407. Um **segundo** celular, fora da lista, para provar que é ignorado.

## 3. Variáveis no Coolify (app APP CARDAPIO) 🔒

| Variável | Valor | O que faz / risco que evita |
|---|---|---|
| `WHATSAPP_ROBO_LIBERADO` | `1` | Abre a trava do servidor. Sem ela nada é gravado nem enviado e o painel não deixa ligar. Global: vale para toda loja LIGADA (hoje nenhuma). |
| `WHATSAPP_ROBO_SOMENTE` | `55DDD9XXXXXXXX` (só dígitos; vírgula para mais de um) | Só esse(s) número(s) recebem resposta; qualquer outro é ignorado **sem gravar nada**. Evita responder cliente real da loja durante o piloto. |
| `CRON_SECRET` | (já existe, usado pelo cron de campanhas) | Protege `/api/cron/whatsapp`. Conferir que existe; não trocar. |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` | (já existem) | Envio real. Não mexer. |
| `MENUZIA_URL_PUBLICA` | opcional (padrão `https://app.menuzia.com.br`) | Link do cardápio nas respostas. |

**Nunca** definir em produção `WHATSAPP_PROVEDOR` nem `WHATSAPP_SIMULADO_ARQUIVO` (são só
dos testes). Variável nova só vale depois de **Redeploy**.

## 4. Cron 🔒

- Dá para testar sem cron: cada resposta é enviada na hora, dentro do próprio webhook.
- Mas sem cron: falha passageira da Evolution fica `pendente` para sempre (sem nova
  tentativa) e a retenção (90 dias / 12 meses) não roda. **Recomendado criar antes do piloto.**

| Campo | Valor |
|---|---|
| URL | `https://app.menuzia.com.br/api/cron/whatsapp` |
| Método | `POST` |
| Header | `x-cron-secret: <CRON_SECRET>` (sem ele: 401) |
| Frequência | a cada 1 minuto (`* * * * *`) |
| Faz | novas tentativas (30s/60s/120s/240s, até 5), marca como incerto o que caiu no meio do envio, recusa resposta de loja desligada/servidor não liberado, e roda `whatsapp_limpar_antigos`. |

Copiar o formato da tarefa agendada de campanhas que já funciona no Coolify (a de
campanhas já teve URL errada e erro de shell — conferir a URL e as aspas).

## 5. Webhook na Evolution — só a instância da Menuzia 🔒

1. **Instância certa:** `menuzia-824468ae-a16a-43d6-ab82-37e23fbecb38`. Conferir no banco
   (`select evolution_instance from restaurantes where slug='menuzia'`) e na Evolution
   (`GET /instance/fetchInstances?instanceName=<instância>` → `open`, dono final 0804).
   Qualquer outro nome — em especial `nr13-leads`, `disparos` ou `menuzia-<id>` de loja
   que não existe — **não tocar** (lista em `instancias-evolution.md`).
2. **Estado anterior:** `GET /webhook/find/<instância>` e salvar a resposta num arquivo
   (hoje: vazio, sem webhook).
3. **Segredo** (service role, não colar em chat):
   `select webhook_segredo from whatsapp_robo_config where restaurante_id = (select id from restaurantes where slug='menuzia');`
4. **Configurar:** `POST /webhook/set/<instância>`, header `apikey`, corpo:
   ```json
   {"webhook":{"enabled":true,"url":"https://app.menuzia.com.br/api/whatsapp/webhook/<segredo>","byEvents":false,"base64":false,"events":["MESSAGES_UPSERT"]}}
   ```
5. **Conferir:** `GET /webhook/find/<instância>` → enabled, host `app.menuzia.com.br`,
   eventos só `MESSAGES_UPSERT`; e as outras 9 instâncias com o mesmo hash de antes.
6. **Eventos:** só `MESSAGES_UPSERT`. **Não** habilitar `SEND_MESSAGE`, `MESSAGES_UPDATE`,
   `CONNECTION_UPDATE`, `QRCODE_UPDATED`, `CONTACTS_*`, `CHATS_*`, `GROUPS_*`,
   `PRESENCE_UPDATE` (geram tráfego inútil; o robô ignora e só registra evento).
   `base64: false` (não mandar mídia em base64).
7. **Desfazer:** `POST /webhook/set/<instância>` com o mesmo corpo e `"enabled": false`
   (como antes não havia webhook, desligado equivale ao estado anterior). Conferir com
   `GET /webhook/find`.

## 6. Ordem de ativação 🔒

1. Foto antes (pedidos, comandas, pagamentos, fila de impressão, webhooks por hash).
2. Coolify: cron + `WHATSAPP_ROBO_LIBERADO=1` + `WHATSAPP_ROBO_SOMENTE=<número>`; Redeploy.
3. Integrações da Menuzia: aviso "não liberado" some; **Ligar o robô** (confirmar).
4. Registrar o webhook (seção 5).
5. Roteiro de teste (seção 7).

## 7. Roteiro de teste (do número autorizado, salvo indicação)

| # | Enviar | Esperado |
|---|---|---|
| 1 | `oi` | Boas-vindas com nome da loja, link do cardápio e menu 1–5 |
| 2 | `0` | Menu de novo |
| 3 | `3` | Link do cardápio |
| 4 | `4` | "Estamos abertos agora" + grade 08:00–22:00 |
| 5 | `taxa Jaburuna` | R$ 5,89, "pode sair menor" + link |
| 6 | `taxa Marte` | "depende da distância" (sem valor inventado) |
| 7 | `taxa` | Pede o bairro |
| 8 | `1` | Status do último pedido deste número (ou "não encontrei") |
| 9 | `asdfgh` | "Não entendi" + menu (no máximo 1 a cada 10 min) |
| 10 | áudio, foto, localização | Resposta própria de cada tipo |
| 11 | `2` | "Vou chamar alguém…" |
| 12 | `oi` | **Nenhuma** resposta (em atendimento humano) |
| 13 | Integrações → "Devolver ao robô"; depois `oi` | Volta a responder |
| 14 | Da loja (celular 0804) responder à mão o teste | Robô silencia essa conversa |
| 15 | Do **segundo celular** (fora da lista): `oi` | **Nenhuma** resposta e nada gravado |
| 16 | Duplicidade: conferir no banco que cada mensagem recebida gerou no máximo 1 envio | |
| 17 | Integrações → **Desligar o robô**; do número autorizado `oi` | **Nenhuma** resposta |

Retorno automático (12h) não precisa esperar: é coberto pelo e2e; opcionalmente baixar o
tempo para 15 min em Integrações durante o piloto e voltar a 720 depois.

Consultas de conferência (service role, só leitura):
```sql
select estado, count(*) from whatsapp_envios where restaurante_id = <menuzia> group by 1;
select distinct telefone from whatsapp_envios where restaurante_id = <menuzia>;       -- só o autorizado
select m.wa_id, count(e.id) from whatsapp_mensagens m left join whatsapp_envios e on e.origem_mensagem_id = m.id
 where m.restaurante_id = <menuzia> group by 1 having count(e.id) > 1;                -- deve voltar vazio
select tipo, criado_em, resultado from whatsapp_eventos where restaurante_id = <menuzia> order by criado_em desc limit 30;
select acao, usuario_nome, criado_em from eventos_auditoria where restaurante_id = <menuzia> and acao like 'whatsapp.%' order by criado_em desc;
```

## 8. Critérios de sucesso

- Respondeu só ao número autorizado; segundo celular ignorado sem gravar nada.
- Uma resposta por mensagem (consulta de duplicidade vazia); nenhum envio `incerto`.
- Todos os fluxos da seção 7 com o texto esperado; nenhum preço inventado.
- Nenhum pedido criado ou alterado; comandas, pagamentos e fila de impressão iguais à foto.
- Avisos de pedido, campanhas e códigos do checkout seguem funcionando como antes.
- Eventos e auditoria registrados (atendente, devolução, configuração).
- Desligar o robô parou as respostas na hora; nada saiu depois (fila recusa).
- Outras 9 instâncias da Evolution com o mesmo hash de webhook.

## 9. Rollback do piloto (qualquer passo já para as respostas)

1. Integrações → **Desligar o robô** (efeito imediato; pendentes da fila são recusados).
2. Evolution: webhook da instância com `"enabled": false` (seção 5.7) e conferir.
3. Coolify: remover `WHATSAPP_ROBO_LIBERADO` (e `WHATSAPP_ROBO_SOMENTE`); remover a
   tarefa do cron; **Redeploy**.
4. Conferir: painel "não liberado"; `oi` do número autorizado sem resposta; nenhum envio
   novo em `whatsapp_envios`.
5. Código/banco só se houver defeito: ver `README.md` (redeploy de `27ac38e` + rollback
   da 0103).

## 10. Riscos

- O número da loja (0804) pode receber mensagens de clientes reais: a lista branca é o
  que impede resposta a eles — nunca rodar o piloto sem `WHATSAPP_ROBO_SOMENTE`.
- Primeira vez contra a Evolution real: o formato do evento `MESSAGES_UPSERT` da 2.3.7
  foi testado só com payload simulado equivalente.
- A chave global da Evolution abre também as instâncias de outros sistemas: todo comando
  `webhook/set` precisa do nome exato da instância da Menuzia.
- Os bairros de teste da Menuzia têm nomes fictícios; o teste de taxa usa `Jaburuna`.

## 11. Resultado do piloto — 2026-09-27 (13:13–13:37, horário de Brasília)

Ativação (autorizada): variáveis `WHATSAPP_ROBO_LIBERADO=1` e
`WHATSAPP_ROBO_SOMENTE=5527992534407` + Redeploy `q80844o8ggk8sgw0wg4s4ww8` (16:11 UTC);
cron "Robô WhatsApp (fila e retenção)" a cada minuto (mesmo formato da tarefa de
campanhas, com `$CRON_SECRET`); robô ligado só na Menuzia com retorno de 15 min (mínimo
do sistema — 2 min exigiria migration); webhook registrado só em
`menuzia-824468ae-…` (antes: sem webhook; estado salvo).

Números: 10 mensagens do 4407 → 9 respostas, todas `enviado` na 1ª tentativa; 0
duplicadas, 0 pendentes, 0 incertas; único destinatário o 4407. Ignorados sem gravar:
2 de grupo, 4 de número fora da lista.

| Fluxo | Resultado |
|---|---|
| Saudação (`Oi`) | ✅ boas-vindas + link + menu |
| Status (`1`) | ✅ #99 (04/09) Entregue |
| Horário (`4`) | ✅ aberto agora + grade |
| Taxa de bairro cadastrado (“Qual a taxa de Jaburuna”, “Taxa jaBUruna”) | ✅ R$ 5,89, “pode sair menor” |
| Taxa de bairro fora da lista (“Taxa gloria”, “Taxa jardim Marilândia”) | ✅ “depende da distância”, sem valor inventado |
| Taxa sem bairro | ✅ pede o bairro |
| Mensagem desconhecida | ✅ “Não entendi” + menu; a 2ª em seguida ficou sem resposta (limite de 1 a cada 10 min, esperado) |
| Grupo / número fora da lista | ✅ ignorados sem gravar |
| `0` menu, `3` cardápio (13:51) | ✅ menu completo; link do cardápio |
| Localização (13:51) | ✅ resposta própria de localização |
| `2` atendente (13:52:39) | ✅ "Vou chamar alguém…", evento `atendente`, conversa silenciada (cliente) |
| `Oi` durante o atendimento (13:52:48) | ✅ sem resposta |
| `Oi` depois de 15 min (14:08) | ✅ evento `retorno_robo` + boas-vindas |
| Áudio e foto | não enviados (mesmo caminho da localização; cobertos pelo e2e) |

**Veredito: PILOTO APROVADO** (encerrado 2026-09-27 ~14:08). Totais finais: 16 mensagens
do 4407 → 14 respostas, todas `enviado` na 1ª tentativa; 0 duplicadas, 0 pendentes, 0
incertas, 0 com erro; único destinatário o 4407. Ignorados sem gravar: 4 de grupo e 5 de
número fora da lista. As 2 sem resposta são as esperadas (limite do "Não entendi" e o
silêncio do atendimento). Estado final: robô ligado só na Menuzia, lista branca só com
o 4407, cron com última execução `success`, webhook ativo só na Menuzia, 7 lojas
desligadas (0 eventos, 0 envios).

Achado: “Qual minha último pedido” não foi reconhecido como status (a regra aceita “meu
pedido”, “cadê”, “status”…). Correção de uma linha + teste, a publicar depois.

Segurança (antes × depois): 0 pedidos criados/alterados; pagamentos, comandas, itens,
sessões de mesa e fila de impressão iguais em todas as lojas; campanhas com o mesmo hash;
outras lojas desligadas, 0 eventos e 0 envios; das 10 instâncias da Evolution só a da
Menuzia mudou (webhook do robô); `nr13-leads` e órfãs idênticas.

Prévia do link: o robô manda só texto; a imagem é a prévia automática do WhatsApp lendo
`og:image` da vitrine = banner da loja
(`…/cardapio/824468ae-…/perfil/banner-….webp`, 33 KB). Título da prévia = nome cadastrado
("Dayse Brandao Ferreira").
