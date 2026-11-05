# Plano: Disparos pela API oficial do WhatsApp (Meta Cloud API)

Data: 04/11/2026. **Só plano — nada implementado.** Complementa o estudo geral de 05/10/2026
([estudo.md](estudo.md)), que cobre avisos de pedido, OTP, robô e central. Aqui o foco é **Disparos** (os 3 cards:
Recuperação, Promoções e Disparo personalizado, migrations 0245–0249).

## Respostas curtas (perguntas do dono)

**Quem paga as mensagens?** Recomendação: **cada loja paga a Meta direto**, no cartão dela. A Menuzia (dono do
sistema) **não paga** as mensagens de ninguém. É assim que funciona no modelo **Tech Provider**: a Meta não deixa o
Tech Provider pagar pela loja (só um *Solution Partner*/BSP com linha de crédito faz isso).

| Modelo | Quem paga a Meta | Prós | Contras |
|---|---|---|---|
| **A. Tech Provider (recomendado)** | A loja, direto, com o cartão dela no WhatsApp Manager | Zero risco financeiro para a Menuzia; zero taxa de intermediário; a fatura é da loja | A loja precisa cadastrar o pagamento na Meta (5 min); sem pagamento, nada de marketing sai |
| B. Via BSP com linha de crédito (360dialog, Gupshup…) | O BSP paga e cobra a Menuzia; a Menuzia repassa na mensalidade | A loja não mexe em nada na Meta | A Menuzia vira devedora da conta de todas as lojas (inadimplência é prejuízo nosso); taxa do BSP (ex.: €49 por número/mês na 360dialog) |
| C. Menuzia vira Solution Partner | A Menuzia | Controle total da cobrança | Exige volume e contrato com a Meta; fora de alcance hoje |

**Cada loja vai ter que ter uma integração?** Sim, mas é **um clique**: em Integrações, botão "Conectar WhatsApp
oficial" abre a janela da Meta (*Embedded Signup*), a loja entra com o Facebook dela, escolhe o número e cadastra o
pagamento. A Menuzia faz **uma única vez** o cadastro dela na Meta (app + verificação da empresa + aprovação). Não é
preciso o lojista mexer em token nem colar chave.

**É fácil?** A programação é média (o código já separa o provedor de WhatsApp numa interface só). O que demora é a
**burocracia da Meta**: verificação da empresa Menuzia e aprovação do app (2 a 6 semanas de espera). E muda o jeito de
usar: **cada copy precisa ser aprovada pela Meta antes** de disparar (minutos a 24 h).

**Quanto custa?** Marketing no Brasil: **≈ R$ 0,32 por mensagem entregue** (tabela em reais desde 01/07/2026, valor do
estudo de 05/10 — **conferir no rate card oficial antes de anunciar**). Uma rodada de 100 pessoas ≈ R$ 32. Hoje (QR
Code) é grátis, mas com risco de banimento.

## Contexto observado (código)

- O WhatsApp fica atrás de uma interface única `ProvedorWhatsapp` (`enviarTexto`, `enviarImagem`, `interpretarWebhook`,
  `conexao`…) — `lib/mensageria/provedor.ts:55`. Hoje existem `evolution` e `simulado`. A Cloud API seria a 3ª.
- Disparos: cron `/api/cron/campanhas` (60 s, uma rodada por vez — `app/api/cron/campanhas/route.ts`, `lib/saude/cron.ts`);
  rodadas dos cards por `campanha_recorrentes_gerar_rodadas()` no máximo a cada 10 min; fila em `campanha_envios`;
  reserva `campanha_reservar_envios` (janela 09:00–21:30, 60–150 s por loja, teto diário, frequência de 2 dias) —
  `supabase/migrations/0245_disparos_recorrentes.sql`; conclusão com 3 tentativas e pausa por conexão com espera
  crescente — `0249_campanhas_pausa_conexao_espera.sql`.
- O texto sai montado por `montarTextoCampanha` (`{nome}`, `{loja}`, `{link_cardapio}` → link rastreável `/c/<token>`,
  `{ultimo_item}`, rodapé "Responda SAIR") — `lib/mensageria/campanhas.ts`.
- Cards e anúncios: `campanha_recorrentes` (Recuperação: `mensagens` = até 5 copies, até 6 imagens) e
  `campanha_recorrente_anuncios` (até 5 por card, imagens, copy, dias, horário, públicos) — `0248_disparos_anuncios.sql`.
- O status "enviado" hoje = Evolution aceitou; **não há confirmação de entrega** confiável (visto no teste real de
  04/11: aceito e não chegou). `campanha_envios.entregue_em/lido_em` existem (0104) e são alimentados por
  `MESSAGES_UPDATE`.
- Credenciais de integração de loja já são guardadas cifradas: `lib/pagamentos/cripto.ts` (`cifrar`/`decifrar`).
- Webhooks externos existentes seguem o padrão `app/api/webhooks/<provedor>/route.ts` (Mercado Pago, Asaas).
- Toda API paga passa por `chamarApiPaga()` com limite diário e alerta (`lib/custo/guarda.ts`, regra nº 1 do CLAUDE.md).
  Mensagem de marketing da Meta **é API paga** → entra nessa regra.
- Liga/desliga por loja só pelo Super Admin (`loja_modulos`, `lib/modulos.ts`).

## Hipóteses a confirmar

| Hipótese | Como confirmar |
|---|---|
| Preço marketing BR ≈ R$ 0,3217 por mensagem entregue | Rate card oficial da Meta (CSV/PDF) no dia de ligar |
| Imagem do cabeçalho do template pode **mudar a cada envio** sem nova aprovação (a aprovação usa uma imagem de exemplo) — mantém o rodízio de imagens | Doc "Media header" da Cloud API + 1 teste no piloto |
| Botão de URL com sufixo dinâmico mantém o link rastreável `/c/<token>` por pessoa | Doc de botões de template + teste no piloto |
| Botão nativo "Parar de receber promoções" (opt-out de marketing) chega por webhook | Doc "Marketing opt-out" + teste |
| Coexistência desconecta aparelhos vinculados → a instância Evolution da loja cai | Estudo 05/10 §3; testar na Menuzia |
| Meios de pagamento aceitos em BRL (cartão nacional? Pix? boleto?) | Billing Hub da Meta |
| Limite de mensagens: 250 contatos/24 h sem verificação da loja, 2.000 com, sobe sozinho | Doc "Messaging limits" |
| A Meta limita quantas mensagens de marketing cada pessoa recebe de todas as empresas (erro 131049) | Doc de erros; tratar como "não entregue, não repetir" |

## Decisão central: o número da loja

A coexistência (app WhatsApp Business + API no mesmo número) **desliga os aparelhos vinculados** — e a Evolution é um
aparelho vinculado. Então, **no mesmo número, não dá para migrar só os disparos**: quando a loja conecta a API oficial,
robô, avisos e central também precisam ir para a API (é a migração completa do estudo de 05/10, 22–32 dias).

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **1. Número só de promoções (recomendado para começar)** | A loja conecta um **segundo número** na API oficial só para Disparos. Robô, avisos e central seguem no número de hoje (Evolution) | Entrega isolada e rápida (~10–14 dias de código); o número principal nunca corre risco por causa de campanha | O cliente recebe a promoção de um número diferente; a loja precisa de um chip/número a mais |
| 2. Migração completa do número | Tudo vai para a API oficial no mesmo número (coexistência) | Um número só; acaba o risco de banimento em tudo | 22–32 dias; avisos de pedido e OTP também passam a custar (≈ R$ 0,035 cada) |

Recomendação: **Opção 1 agora**, Opção 2 depois (o código do provedor e dos templates é o mesmo; nada se perde).

## Arquitetura proposta (Opção 1)

**Fluxo do disparo (onde roda cada parte):**
1. Painel (navegador): a loja escreve a copy do anúncio/copy da Recuperação → salva.
2. Servidor: transforma a copy em **template de marketing** (`{nome}` → `{{1}}`, `{loja}` → `{{2}}`, `{ultimo_item}` →
   `{{3}}`; imagem → cabeçalho de imagem; link do cardápio → **botão de URL** com sufixo `/c/{{1}}`; rodapé SAIR →
   botão "Parar de receber promoções") e envia à Meta para aprovação na WABA da loja.
3. Meta → webhook `message_template_status_update` → `whatsapp_templates.status` (pendente/aprovado/rejeitado + motivo).
4. Card só liga quando **todas** as copies dele estão aprovadas (mesma regra de pendência de hoje — `pendenciasDoCardV2`
   ganha "copy aguardando aprovação da Meta").
5. Cron (igual hoje): gera a rodada, reserva os envios. Na hora de enviar, se a loja tem `disparos_provedor = 'meta'`,
   chama `enviarTemplate` (Cloud API) com a imagem da vez e os parâmetros da pessoa.
6. Meta → webhook `statuses` → `campanha_envios`: `sent` / `delivered` (entregue_em) / `read` (lido_em) / `failed`
   (erro com código). **Passamos a saber o que foi entregue de verdade.**
7. Opt-out: clique em "Parar de receber" → webhook → `whatsapp_descadastros` (a mesma tabela do SAIR de hoje).

**O que muda nas regras de hoje:**
- **Mantém:** janela 09:00–21:30, 2 dias por pessoa, públicos, rodízio de imagens e copies, cota dividida no dia, freio.
- **Muda:** o intervalo de 60–150 s pode cair para alguns segundos (a API aguenta), mas manter moderado (ex.: 5–10 s)
  para não estourar o limite de qualidade. O "aquecimento" 15→+5 vira o **limite oficial da Meta** (250/2.000/…) lido
  da conta, mais um **teto de gasto** por loja (ver Custos).
- **Erros da Meta:** política/limite (131049 limite por usuário, 131047 fora da janela, 132xxx template) = definitivo,
  sem nova tentativa; 130429 (limite de vazão) e 5xx = transitório, com a espera crescente que já existe.
- **Freio:** passa a usar também a **qualidade do número** (webhook `phone_number_quality_update`): qualidade "baixa" →
  pausa os cards da loja e avisa.

**Isolamento por loja:** toda tabela nova com `restaurante_id`, RLS de gestor com `(select auth_restaurante_id())`,
grants explícitos; token da Meta só no servidor, cifrado com `lib/pagamentos/cripto.ts`, nunca devolvido ao navegador.

**Permissões:** conectar/desconectar WhatsApp oficial e ver custo = dono/gerente (mesmo `auth_e_gestor()` dos cards).
Ligar o módulo para a loja = Super Admin (chave nova "Disparos oficiais" em `loja_modulos`, padrão desligado para as
lojas existentes).

## Banco (uma migration, aditiva)

- `whatsapp_contas_oficiais`: `restaurante_id`, `waba_id`, `phone_number_id`, `numero`, `token_cifrado`, `status`,
  `qualidade`, `limite_mensagens`, `pagamento_ok`, `criado_em`. RLS gestor (sem o token: coluna fora do grant).
- `whatsapp_templates`: `restaurante_id`, `origem` (anúncio id / card + índice da copy), `nome_meta`, `idioma`,
  `categoria`, `status`, `motivo_rejeicao`, `texto_enviado`, `atualizado_em`.
- `restaurantes.disparos_provedor text default 'evolution'` (+ grant select). Lojas existentes seguem como hoje.
- `campanha_envios`: `erro_codigo` (código da Meta) e o custo estimado por envio (`custo_estimado numeric`).
- `clientes.aceita_promocoes` (opt-in no checkout — política da Meta exige consentimento para marketing; também LGPD).
- Rollback: `docs/rollback/02xx_whatsapp_oficial.down.sql` (drop das tabelas/colunas novas).

## Contratos de API

| Método e rota | Entrada | Saída | Erros / idempotência |
|---|---|---|---|
| `POST /api/admin/whatsapp-oficial/conectar` | `code` do Embedded Signup | conta conectada (sem token) | 400 code inválido; 409 já conectada. Troca o code por token no servidor |
| `DELETE /api/admin/whatsapp-oficial` | — | ok | só gestor |
| `GET /api/admin/whatsapp-oficial` | — | status, qualidade, limite, pagamento_ok, templates | — |
| `GET /api/whatsapp/meta` | `hub.challenge` | challenge | verificação da Meta |
| `POST /api/whatsapp/meta` | eventos (statuses, templates, qualidade, opt-out) | 200 sempre rápido | assinatura `X-Hub-Signature-256` obrigatória; **evento repetido descartado antes do banco** (id do status / id do evento em tabela com `unique`) — regra 2 das correções |
| `PUT /api/admin/campanhas/recorrentes/[tipo]/anuncios` (existe) | igual | igual + status dos templates | ao salvar, envia/atualiza templates; copy igual à aprovada não reenvia |

## Custos (regra nº 1 do CLAUDE.md)

- Quem paga é a loja, mas o sistema **não pode gerar conta surpresa**: teto de gasto por loja (`disparos_teto_reais_mes`,
  padrão sugerido R$ 100) e alerta ao atingir 80 %. Cada envio passa por `chamarApiPaga()` com o custo estimado.
- O card mostra "≈ R$ X por rodada" (pessoas × preço de marketing) e o total do mês.
- Volume de chamadas para nós: 1 envio = 1 chamada à Meta + 2–3 webhooks (enviado, entregue, lido). Zero polling.

## Etapas

### Etapa 0 — Cadastro da Menuzia na Meta (dono + Claude; caminho crítico)
- Mudanças: Business Manager da Menuzia com 2FA, **verificação da empresa** (CNPJ), app "Menuzia" com produto WhatsApp,
  configuração do Embedded Signup, **App Review** das permissões `whatsapp_business_management` e
  `whatsapp_business_messaging`, Access Verification (Tech Provider).
- Impacto no banco: nenhum.
- Verificação: app aprovado com acesso avançado; Embedded Signup abre em modo de teste.
- Depende do dono: documentos do CNPJ, login no Facebook do negócio, 2FA. Espera: 2 a 6 semanas.

### Etapa 1 — Banco e provedor Cloud API
- Mudanças: migration acima; `lib/mensageria/provedor-meta.ts` implementando `ProvedorWhatsapp` + `enviarTemplate`;
  mapa de erros da Meta → `transitorio`/`definitivo`; versão `simulado` do `enviarTemplate` para a e2e.
- Verificação: testes unitários com respostas reais gravadas da Meta (sucesso, 131049, 130429, 5xx); teste de RLS (dono
  de outra loja não lê `whatsapp_contas_oficiais` nem o token); `npm run checar`.

### Etapa 2 — Webhook da Meta
- Mudanças: `app/api/whatsapp/meta/route.ts` (GET verificação, POST com HMAC), descarte de evento repetido antes do banco,
  statuses → `campanha_envios`, templates → `whatsapp_templates`, qualidade → conta, opt-out → descadastros.
- Verificação: testes com payloads reais; mesmo evento 2× = 1 gravação; assinatura errada = 401.

### Etapa 3 — Conectar o número (Integrações)
- Mudanças: card "WhatsApp oficial (promoções)" em Integrações com o Embedded Signup; mostra número, qualidade, limite,
  pagamento ok/pendente (link para o WhatsApp Manager da loja); chave no Super Admin.
- Verificação: conectar o número de teste da Menuzia; desconectar; outra loja não vê.

### Etapa 4 — Copies viram templates
- Mudanças: conversor copy → template (variáveis, imagem de cabeçalho, botão URL rastreável, botão de opt-out); envio
  para aprovação ao salvar; selo no modal de cada anúncio/copy ("Aguardando Meta", "Aprovada", "Recusada: motivo");
  card só liga com tudo aprovado; editar uma copy aprovada cria nova versão (a antiga segue até a nova ser aprovada).
- Verificação: testes do conversor (negrito/itálico viram `*`/`_` aceitos pela Meta; `{ultimo_item}` só na Recuperação);
  template real aprovado na conta de teste.

### Etapa 5 — Envio pelos cards
- Mudanças: `campanhas-envio.ts` escolhe `enviarTemplate` quando `disparos_provedor = 'meta'`; intervalo menor; limite
  oficial + teto de gasto; custo estimado no card; erros sem nova tentativa conforme o mapa; freio por qualidade.
- Verificação: e2e com provedor simulado (mesma suíte de hoje, cenário "meta"); teste real com 1 número (script
  `scripts/seguranca/teste-disparo-real.mjs` ganha a opção `--meta`); confirmação de **entregue** vinda do webhook.

### Etapa 6 — Opt-in e piloto
- Mudanças: caixa "Quero receber promoções da loja pelo WhatsApp" no checkout (`clientes.aceita_promocoes`); público dos
  cards em modo oficial só com quem aceitou (ou conversou e não pediu para sair — a confirmar com a política da Meta);
  piloto na Menuzia por 2 semanas acompanhando qualidade, entrega e fatura.
- Verificação: primeira fatura da Meta bate com o custo estimado no painel (± 10 %).

**Esforço (Opção 1):** ≈ 10 a 14 dias de programação + a espera da Meta (Etapa 0). A migração completa (Opção 2) soma
as fases 3, 5 e 6 do estudo de 05/10.

## Riscos e decisões em aberto

1. **Decisão do dono:** Opção 1 (número só de promoções) ou Opção 2 (tudo no número principal)?
2. **Decisão do dono:** confirmar o modelo A (cada loja paga a Meta). Se quiser que a loja não lide com a Meta, só via
   BSP (modelo B), com risco financeiro para a Menuzia.
3. Custo ≈ 10× mais caro por contato que hoje (grátis): lojas podem usar menos. Mostrar o custo antes de ligar.
4. Copies passam a depender de aprovação (minutos a 24 h); copy com cara de spam é recusada ou recategorizada.
5. Sem verificação da empresa da loja, o limite fica em 250 pessoas por dia.
6. Opt-in: a política de marketing da Meta exige consentimento; a base de "quem conversou" pode não bastar.
7. Preços e regras da Meta mudaram 2× em 2026: conferir rate card e primeira fatura.
8. Até a Etapa 0 sair, nada disto vai para produção; o QR Code (Evolution) continua sendo o caminho de hoje.
