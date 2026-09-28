# Central de atendimento do WhatsApp no painel (fase 2) — plano e decisões

Interface própria, estilo WhatsApp Web, dentro do painel admin. **Sem iframe do
web.whatsapp.com.** Usa a instância que o sistema já tem (Evolution API, `lib/mensageria/
provedor.ts`), o webhook já recebido (`/api/whatsapp/webhook/<segredo>`) e o envio do
provedor.

## Levantamento (o que já existia)

- **Provedor:** Evolution API (Baileys), uma instância por loja (`restaurantes.evolution_instance`).
  Envio: `sendText`, `sendMedia`, `sendWhatsAppAudio`. Webhook `MESSAGES_UPSERT` (e
  `MESSAGES_UPDATE` para campanhas), registrado **à mão** por loja (ver README).
- **Mensagens salvas:** `whatsapp_conversas`, `whatsapp_mensagens` (0103) — mas só com o robô
  ligado; respostas do robô ficavam só em `whatsapp_envios`; avisos de pedido, fidelidade,
  campanhas e o código do checkout não eram salvos.
- **"Falar com atendente":** a conversa fica `silenciada` (motivo `cliente`) e o robô não
  responde nela; volta sozinho após o tempo da loja (12h). **"Pausar robô":** silenciada com
  motivo `painel`. Os dois em `whatsapp_alterar_conversa`.
- **Tempo real:** Supabase Realtime (`postgres_changes`, RLS) já usado no layout e no PDV.

## Modelo de dados (0107)

- `whatsapp_conversas` + `atendimento` (`robo` | `aguardando` | `humano` | `encerrada`),
  atendente (id, nome, desde), `nao_lidas`, prévia/origem/hora da última atividade.
  `estado` (robo/silenciada) continua sendo a trava do robô; `atendimento` é o estado que a
  pessoa vê — os dois mudam juntos nas funções do banco.
- `whatsapp_mensagens` + `origem` (`cliente` | `atendente` | `robo` | `automatico` |
  `disparo` | `loja`), autor, `status_envio`, erro, `midia_url`, `texto_hash`.
  Saída é registrada ANTES de enviar (`local:<uuid>`), e o id do provedor entra depois:
  o eco que volta pelo webhook é reconhecido (id ou hash do texto) e não vira "a loja
  respondeu pelo celular" — antes, um aviso de pedido silenciava o robô por 12h.
- O código de verificação do checkout é gravado **sem o código** ("Código de verificação
  enviado"); o eco dele é reconhecido pelo hash.
- `whatsapp_tags` (nome + cor, por loja) e `whatsapp_conversa_tags` (várias por cliente).
- Leitura: dono e gerente da própria loja (RLS, como 0103); escrita só pelo servidor.
  Realtime: `whatsapp_conversas` e `whatsapp_mensagens` na publicação.
- Retenção igual à 0103 (texto 90 dias, metadado 12 meses) + a prévia da conversa.

## Fluxo

| Evento | atendimento |
|---|---|
| cliente pede "Falar com atendente" | aguardando |
| robô da loja desligado e o cliente escreve | aguardando (atendimento humano direto) |
| "Assumir atendimento" ou o atendente responde | humano (robô parado na conversa) |
| "Pausar robô" | humano |
| "Encerrar e devolver ao robô" | robo (com o robô desligado: encerrada) |
| "Retomar robô" | robo |
| loja responde pelo celular | humano |
| robô volta sozinho (tempo da loja) na próxima mensagem | robo |

## Interface

- `components/atendimento/lancador.tsx` — botão redondo no canto inferior direito, com o
  número de conversas aguardando + não lidas. Fica no layout do admin (dono e gerente).
  Fechado: uma assinatura Realtime em `whatsapp_conversas` da loja que só dispara uma
  contagem (com atraso de 800 ms); sem Realtime, contagem a cada 25 s, parada com a aba
  escondida. Contador no título da aba; som opcional (desligável).
- `components/atendimento/central.tsx` — carregado **sob demanda** (`import()` no clique).
  Janela 960×640 (redimensionável, maximizar, minimizar, fechar; tela cheia no celular):
  lista à esquerda (busca, filtros Aguardando / Em atendimento / Todas / tag, paginação
  por cursor, lista em janela), conversa à direita (balões, rótulos de robô / automático /
  disparo, Enter envia, Shift+Enter quebra linha, emoji, imagem), aba do cliente (tags,
  últimos pedidos, fidelidade).
- APIs em `/api/admin/whatsapp/atendimento/*` (loja SEMPRE da sessão; `whatsapp.atender`).

## Depende do provedor / pendente

- Mensagens só chegam das lojas com o webhook registrado na Evolution (passo manual).
- Mídia recebida (foto/áudio do cliente): mostrada sob demanda pelo
  `chat/getBase64FromMediaMessage` da Evolution — se a versão da instância não tiver, o
  balão mostra o tipo ("📷 Foto") sem a imagem.
- Envio de imagem pelo atendente: `sendMedia` com URL pública (Storage da loja).

## Resultado (2026-09-28)

- Testes: `e2e-atendimento-whatsapp.mjs` 71/71 · `e2e-robo-whatsapp.mjs` 106/106 ·
  `e2e-integracoes-fase1.mjs` 21/21 · vitest 1605 · tsc limpo.
- Peso: o painel é um pedaço à parte (`import()` no clique) — 34,5 KB / 10,1 KB gzip, fora
  do carregamento inicial. O botão flutuante soma ~1,3 KB gzip em cada tela do admin:
  Pedidos 241,4 → 242,8 KB · Integrações 225,1 → 226,4 · Cardápio 261,9 → 263,2 (gzip,
  primeira visita; `scripts/seguranca/tamanho-bundle-admin.mjs`).
- Fechado: uma assinatura Realtime (só `whatsapp_conversas` da loja, contagem com 800 ms
  de folga) ou, sem Realtime, contagem a cada 25 s; nada com a aba escondida.
- O número do botão conta CONVERSAS: aguardando + em atendimento com mensagem nova.
- Mensagens da central não acendem o "Salvando…" global (a central tem retorno próprio).

## Para publicar

1. Aplicar a **0107** no banco de produção (rollback em
   `docs/rollback/0107_whatsapp_central_atendimento.down.sql`) — ANTES do deploy: o
   webhook passa a chamar `whatsapp_registrar_entrada` com `p_robo_ativo`.
2. Deploy. Sem mais nada: lojas sem webhook registrado mostram só o que a Menuzia envia
   (avisos, fidelidade, disparos, atendente); as com webhook, a conversa inteira.
