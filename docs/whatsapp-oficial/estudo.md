# WhatsApp oficial (Cloud API) para o Menuzia — estudo

Data: 2026-10-05. Só leitura do repositório e pesquisa na web pública. Nada foi
cadastrado, enviado, executado ou publicado.

## Resumo

1. Hoje tudo sai pela Evolution API (Baileys, protocolo do WhatsApp Web, não oficial): um número por loja, conectado por QR. Isso viola os Termos do WhatsApp e o número pode ser banido sem aviso. Também cai sozinho ("Connection Closed").
2. O código já tem a interface `ProvedorWhatsapp` (`lib/mensageria/provedor.ts`). Ligar a Cloud API significa escrever uma segunda implementação dela, sem refazer o robô nem a central.
3. Caminho recomendado: a Menuzia vira **Tech Provider** da Meta, usa **Embedded Signup com Coexistência** e cada loja segue usando o app WhatsApp Business no celular, com o mesmo número.
4. Cada loja tem a própria WABA e paga a Meta direto, em reais, com um meio de pagamento próprio. A Menuzia não paga mensagem nem taxa de BSP.
5. Preço no Brasil (tabela em BRL desde 01/07/2026), por mensagem entregue: marketing R$ 0,3217; utility e authentication R$ 0,0350.
6. **Mudança de 01/10/2026:** a Meta passou a cobrar mensagens de serviço (1.000 grátis por número/mês) e utility dentro da janela de 24 h.
7. Os avisos de pedido viram templates utility (cerca de R$ 0,035 cada), o OTP vira authentication e as campanhas viram marketing (cerca de R$ 0,32 cada). O robô e a central viram mensagens de serviço.
8. Migração loja a loja, sem trocar número e sem parar o atendimento. Esforço total estimado: **22 a 32 dias de desenvolvimento**, mais 2 a 6 semanas de espera pela Meta (verificação e App Review).

---

## 1. Como funciona hoje no Menuzia

**Infraestrutura.** O servidor Evolution é próprio, configurado com `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`, e a chave global é a mesma para todas as instâncias. Cada loja tem uma instância (`restaurantes.evolution_instance`) pareada por QR (rotas `app/api/admin/whatsapp/conectar|desconectar|status`). O inventário em `docs/robo-whatsapp/instancias-evolution.md` mostra instâncias `close` e `connecting` há semanas, e órfãs.

| Recurso | Onde | Como sai hoje |
|---|---|---|
| **Avisos de pedido** | `lib/whatsapp.ts` (`notificarPedido`, `montarMensagemStatus`) | Texto livre via `/message/sendText`: recebido (inclui o agendado), pronto, saiu para entrega e entregue. O cancelamento também passa por `notificarPedido`, inclusive o do **Pix expirado** (`lib/pagamentos/pix-online.ts` → `expirarPedido`). Também há gancho de push. |
| **Código de confirmação (OTP)** | `lib/queries/clientes.ts` (`enviarCodigoVerificacao`) | 6 dígitos, validade de 5 min, 5 tentativas, 1 envio por minuto. Sai do **número da loja** para qualquer telefone digitado no checkout. Se o WhatsApp da loja estiver fora, o pedido segue sem verificação (`podeFallback`, migration 0031). |
| **Robô (sem IA)** | `lib/mensageria/robo.ts`, `entrada.ts`, `fila.ts` | O webhook `/api/whatsapp/webhook/[segredo]` recebe `MESSAGES_UPSERT` e o robô decide entre menu, status, cardápio, horário, taxa e atendente. Fila idempotente com novas tentativas. Três travas: env, loja e webhook. |
| **Campanhas** | `lib/mensageria/campanhas.ts`, `campanhas-envio.ts` | Texto, imagem ou áudio com `{nome}` e `{link}` rastreável `/c/<token>`, e rodapé "responda SAIR". Os envios saem em lote com intervalo entre um e outro e pausam quando a loja cai. Entrega e leitura chegam por `MESSAGES_UPDATE`. |
| **Central de atendimento** | `components/atendimento/*`, `app/api/admin/whatsapp/atendimento/*`, `lib/mensageria/atendimento.ts` | Painel no estilo WhatsApp Web, com tempo real via Supabase, tags, mídia e estados robô, aguardando, humano e encerrada. Reconhece o eco (`fromMe`) das saídas pelo id ou pelo hash. |
| **Fidelidade / alertas financeiros** | `lib/fidelidade.ts`, `lib/financeiro/alertas.ts` | Envio direto com `enviarWhatsapp`. |

**Riscos atuais**

- **Termos de uso:** o WhatsApp declara que conectar a conta a apps não oficiais viola os Termos e pode levar a banimento temporário ou permanente, ou a restrições como perder a capacidade de vincular aparelhos ([FAQ "About unofficial apps"](https://faq.whatsapp.com/1217634902127718), consultado em 2026-10-05).
- **Banimento:** o perigo é maior no OTP, que manda mensagem a números que nunca falaram com a loja, e nas campanhas, que vão para muitos números de uma vez e geram denúncias. Se o número for banido, a loja perde o canal inteiro, inclusive o atendimento manual pelo celular.
- **Instabilidade:** o erro "Error: Connection Closed" já foi visto em produção e está tratado em `erroDeDesconexao`. Quando o número cai, os avisos não saem, o OTP passa para o fallback (pedido não verificado) e as campanhas pausam.
- **Operação:** um servidor Evolution compartilhado com outros sistemas, com uma chave global que abre todas as instâncias e histórico de conversas guardado lá (LGPD).

## 2. Caminhos oficiais

### 2a. Cloud API direta, com a Menuzia como Tech Provider (Embedded Signup)

- **Como é:** um app da Menuzia na Meta. O dono clica em "Conectar WhatsApp" no painel, abre-se a janela da Meta (Embedded Signup) e, ao final, recebemos um *business token* da WABA da loja. Tech Providers usam só tokens de negócio ([Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/), consultado em 2026-10-05).
- **Requisitos:** verificação do negócio da Menuzia e 2FA no Business Manager, App Review com acesso avançado a `whatsapp_business_management` e `whatsapp_business_messaging`, e Access Verification. Com isso o limite fica em 200 novos clientes por 7 dias ([guia Twilio do Tech Provider Program](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide); [visão geral de parceiros, Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview), ambos consultados em 2026-10-05).
- **Cobrança:** o Tech Provider **não** compartilha linha de crédito. "Clients onboarded by Tech Providers must provide their own payment method… Meta will then bill these clients for API usage, and the Tech Provider will bill for other services." Só o **Solution Partner** (BSP) estende linha de crédito e fatura o uso ao cliente (mesma fonte Meta acima).
- **Prós:** custo zero de intermediário; só o preço da Meta, pago pela própria loja. Controle total. Sem dependência de terceiro. Coexistência disponível.
- **Contras:** burocracia e espera da Meta. Somos nós que operamos webhooks, templates, tokens e suporte de onboarding. Não podemos pagar pela loja (cada loja precisa cadastrar o próprio meio de pagamento).

### 2b. Parceiros / BSP

| Parceiro | Custo além da Meta (consultado em 2026-10-05) | Observações |
|---|---|---|
| **360dialog** | €49 por número/mês (Regular). Plano para parceiros ISV a partir de €250/mês + €49 por canal. "No markup on Meta fees" ([preços](https://360dialog.com/pricing)) | API muito próxima da Cloud API; suporta Coexistência ([docs](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence)) |
| **Gupshup** | cerca de US$ 0,001 por mensagem e markup extra em marketing (cerca de US$ 0,0038 no Brasil, segundo terceiro) ([getmacha](https://www.getmacha.com/blog/gupshup-ai-complete-guide)). **Fonte não oficial, conferir** | Forte na Índia e na América Latina |
| **Twilio** | US$ 0,005 por mensagem, **de entrada ou de saída**, + US$ 0,001 por falha ([preços](https://www.twilio.com/en-us/whatsapp/pricing)) | Caro para o nosso volume: o robô e a central recebem muito |
| **Zenvia** | planos a partir de cerca de US$ 20/mês + taxa por conversa, segundo blog de terceiro ([zenvia.com/en/prices](https://zenvia.com/en/prices/)). **Valores não confirmados** | Brasileira, foco em CX |
| **Blip (Take)** | mínimo de cerca de R$ 1.000/mês, contratação consultiva ([comparachatbot](https://comparachatbot.com.br/take-blip-zenvia-pequenas-empresas/)). **Fonte não oficial** | Pensado para empresas grandes |
| **Infobip** | sob consulta | Também tem um programa de Tech Provider ([docs](https://www.infobip.com/docs/whatsapp/tech-provider-program/setup-and-integration)) |

**Conta para nós:** com 10 lojas, a 360dialog custaria cerca de €490/mês, ou €250 + €490 no plano de parceiro. Na Twilio, uma loja com 3.000 mensagens trafegadas por mês pagaria cerca de US$ 15 só de taxa. Pela Cloud API direta, isso é zero. Um BSP faz sentido **só** se quisermos pular a burocracia de Tech Provider no curto prazo ou se precisarmos de linha de crédito para pagar pela loja.

## 3. Coexistência (app WhatsApp Business + API no mesmo número)

Fonte principal: [Meta, "Onboard WhatsApp Business app users"](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users), consultado em 2026-10-05.

- **Requisitos:** o parceiro precisa ser Tech Provider ou Solution Partner, usar a Cloud API e o Embedded Signup. A loja precisa do app **WhatsApp Business** versão 2.24.17 ou maior. O número **não pode** estar em outra configuração da Cloud API. Terceiros recomendam que o número tenha uso real no app há pelo menos 7 dias ([chakrahq](https://chakrahq.com/article/whatsapp-coexistence-live-eu-uk-europe-whatsapp-business-for-api-live/)).
- **Países:** o Brasil já estava liberado. Segundo terceiros, desde 2026 a liberação é global; os últimos foram África do Sul e Nigéria, em abril de 2026 (mesma fonte, não oficial).
- **Manutenção:** o app precisa ser **aberto pelo menos a cada 13 a 14 dias** e **não pode ser desinstalado** ([360dialog](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence)).
- **O que deixa de funcionar:** grupos, mensagens temporárias, visualização única, localização em tempo real, **listas de transmissão**, ligações de voz e vídeo pelo app e ferramentas de negócio do app (catálogo, pedidos, status). Também não há selo azul (OBA) nem Calling API. Os aparelhos vinculados são desconectados no onboarding, e WhatsApp para Windows e WearOS não são suportados.
- **Histórico:** temos 24 h para pedir a sincronização. Vêm os **últimos 6 meses** de conversas em três fases (0–1, 1–90 e 90–180 dias), mas a mídia só vem das mensagens dos últimos 14 dias. Os contatos também sincronizam. Webhooks envolvidos: `history`, `smb_app_state_sync` (contatos) e `smb_message_echoes` (o que a loja digitou no celular).
- **Vazão:** 20 mensagens/s por número, segundo a Meta. Terceiros citam 5/s ([chakrahq](https://chakrahq.com/article/whatsapp-coexistence-live-eu-uk-europe-whatsapp-business-for-api-live/)). Qualquer um dos dois basta para nós.
- **Preço:** o que a loja manda **pelo app** continua grátis. O que sai **pela API** paga a tarifa da Cloud API.
- **Para nós:** o `smb_message_echoes` substitui o `fromMe` da Evolution. A regra "loja respondeu pelo celular → silencia o robô" continua funcionando.

## 4. Templates que precisaremos aprovar

Regras ([Template categorization, Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization), consultado em 2026-10-05):

- **Utility:** não promocional **e** ligado a uma transação ou pedido do usuário. Qualquer conteúdo promocional misturado faz o template virar **marketing**. Desde 09/04/2025 a recategorização é automática e, para quem já foi advertido, acontece sem aviso. Templates aprovados podem ser revisados até 60 dias depois.
- **Authentication:** é a **única** categoria que pode levar OTP. Usa texto fixo da Meta, botão "copiar código" ou one-tap, e **não aceita URL, mídia nem emoji**; o parâmetro tem até 15 caracteres.
- **Marketing:** promoções, recuperação de cliente e novidades.
- **Service:** não é template. É a resposta livre dentro da janela de 24 h.
- **Penalidades por uso indevido:** advertência, depois limitação de envio por 7 dias ou mais, suspensão de utility por 7 a 30 dias e, por último, restrição do portfólio.

| Template (pt_BR) | Categoria | Variáveis | Observação |
|---|---|---|---|
| `pedido_recebido` | utility | loja, número, (agendado: data/hora) | Sem emoji promocional e sem link de cardápio |
| `pedido_pronto_retirada` / `pedido_pronto_entrega` | utility | número | |
| `pedido_saiu_entrega` | utility | número | Botão opcional com URL de acompanhamento |
| `pedido_entregue` | utility | número | **Não** pedir avaliação nem oferecer cupom (vira marketing) |
| `pedido_cancelado_pix_expirado` | utility | número, loja | Pode ter botão "refazer pedido" com URL do pedido; evitar texto de oferta |
| `codigo_verificacao` | authentication | código | Botão copiar código; validade de 5 min (o template tem campo próprio de expiração) |
| `campanha_*` (uma por campanha ou genérica com mídia) | marketing | nome, link | Cada campanha nova precisa de aprovação, o que muda o fluxo da tela de Campanhas |
| `fidelidade_premio` | **marketing** (provável) | nome, prêmio | O texto atual tem tom promocional |

Os templates são criados **na WABA de cada loja**, via API (`message_templates`). Precisamos do envio automático para aprovação no onboarding e de um painel com o status. O nome da loja entra como variável, o que deixa um único conjunto padrão servir para todas.

## 5. Janela de 24 h, preços e quem paga

**Modelo vigente.** A cobrança é **por mensagem entregue** desde 01/07/2025 (antes era por conversa). Vale por categoria e pelo país do destinatário, com descontos por volume em utility e authentication ([Pricing, Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), consultado em 2026-10-05).

**⚠️ Mudança recente, de 01/10/2026** ([Meta, non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages); [360dialog](https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/), consultados em 2026-10-05):

- **As mensagens de serviço** (respostas livres dentro da janela de 24 h), que eram grátis desde 01/11/2024, **passaram a ser cobradas** com o mesmo preço de utility e authentication do país. Cada número tem **1.000 grátis por mês**, sem acumular para o mês seguinte.
- **Utility dentro da janela**, que era grátis desde 01/07/2025, passou a ser cobrado a partir da primeira mensagem.
- Quem não tinha meio de pagamento até 30/09/2026 só recebe a entrega das 1.000 mensagens grátis.
- Template enviado na janela de 72 h aberta por anúncio Click-to-WhatsApp continua grátis.
- *Divergência:* a página principal de preços da Meta ainda diz que as mensagens de serviço são "free". A página específica e os parceiros confirmam a mudança de 01/10. **Conferir na fatura do primeiro mês.**

**Preço no Brasil.** Desde 01/07/2026 há uma tabela própria em BRL, faturada pela Facebook Brasil. Contas com "Sold-To = Brasil" precisam migrar **todas** as WABAs para BRL até 30/06/2027; depois disso a Meta para de entregar ([Meta Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)). Os valores abaixo vêm de parceiros que reproduzem a tabela, porque a planilha da Meta não abriu no fetch:

| Categoria | BRL (01/07/2026; mantido em 01/10/2026) | USD (tabela anterior) |
|---|---|---|
| Marketing | R$ 0,3217 | US$ 0,0625 |
| Utility | R$ 0,0350 (−5% acima de 250 mil por mês) | US$ 0,0068 |
| Authentication | R$ 0,0350 | US$ 0,0068 |
| Service | R$ 0,0350 depois das 1.000 grátis | US$ 0,0068 (360dialog) |

Fontes: [zappy.chat](https://www.zappy.chat/whatsapp-business-api-brasil-outubro-2026/), [whautomate](https://whautomate.com/whatsapp-business-api-pricing-brazil), [messagecentral](https://www.messagecentral.com/blog/whatsapp-business-api-pricing-in-brazil), todas consultadas em 2026-10-05. **Confirmar no rate card oficial (CSV/PDF da Meta) antes de passar preço a qualquer loja.**

**Exemplo:** uma loja com 1.500 pedidos por mês, 3 avisos por pedido e OTP em metade dos pedidos manda 4.500 utility + 750 authentication, cerca de R$ 184/mês. Se a loja quiser economizar, dá para cortar o "pronto" e o "recebido" de retirada. Uma campanha para 2.000 clientes custa cerca de R$ 643. O robô e a central somam, em geral, menos de 1.000 mensagens de serviço por mês por loja pequena (grátis).

**Como a loja paga.**

- No modelo Tech Provider, cada loja é dona da própria WABA, criada no Embedded Signup. Ela cadastra o meio de pagamento no **Billing Hub / WhatsApp Manager** e a Meta cobra a loja direto.
- **Não há compartilhamento da linha de crédito** do Tech Provider; só o Solution Partner compartilha.
- Quais meios a Facebook Brasil aceita em BRL (cartão nacional, boleto, Pix?) **não confirmei**. Verificar no Billing Hub.
- Se quisermos cobrar pela loja e repassar, precisaríamos ser Solution Partner (difícil) ou usar a linha de crédito de um BSP, que é o que 360dialog, Gupshup e outros oferecem.

**Limite de envio.** O limite vale por portfólio: 250 contatos únicos por 24 h fora da janela. Ele sobe para 2.000 com a verificação do negócio e depois cresce sozinho até ilimitado ([Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)). Lojas sem verificação ficam travadas em 250, o que basta para avisos mas limita campanhas.

## 6. Impacto em cada recurso

| Recurso | Mudança | Custo | Ganho |
|---|---|---|---|
| **Avisos de pedido** | Texto livre passa a ser template utility por etapa. A janela costuma estar fechada (o cliente pediu pela vitrine, não pelo WhatsApp). | cerca de R$ 0,035 cada | Fim do risco de banimento; entrega confiável |
| **OTP** | Template authentication com botão copiar | R$ 0,035 cada | É o uso mais arriscado hoje e passa a ser 100% permitido; o fallback "sem verificação" quase deixa de acontecer |
| **Campanhas** | Template marketing **aprovado antes** (perde a liberdade de texto e o áudio). Opt-in explícito vira obrigação de política, e o "SAIR" continua. A Meta também limita quantas mensagens de marketing cada pessoa recebe. | cerca de R$ 0,32 cada | Escala sem banimento; mas sai cerca de 10× mais caro por contato |
| **Robô** | Igual por dentro (mensagem de serviço). Pode ganhar **botões e listas interativas** nativas no lugar de "digite 1–5". | grátis até 1.000 por mês por número | Melhora a UX |
| **Central de atendimento** | Responde livre dentro de 24 h. Fora da janela, só com template (precisamos de um template "retomar conversa"). Mídia vem por *media id* (baixar e guardar no nosso storage). | service | Sem queda de conexão; com coexistência o celular da loja continua funcionando |
| **Webhook** | Um endpoint único da Menuzia (app da Meta), com assinatura `X-Hub-Signature-256`. A loja é identificada por `phone_number_id`, não mais pelo segredo na URL. | — | Menos configuração manual |

## 7. Arquitetura proposta, migração e esforço

**Camada de provedor.** Estender `ProvedorWhatsapp` em `lib/mensageria/provedor.ts`:

- `enviarTemplate(conta, numero, nomeTemplate, idioma, parametros)`.
- `enviarInterativo(...)` (botões e listas).
- `janelaAberta(conta, numero)`: consultada a partir da última mensagem de entrada gravada em `whatsapp_mensagens`.
- `interpretarWebhook` para o formato da Meta: `messages`, `statuses` (entregue/lido, já mapeados para as métricas de campanha), `smb_message_echoes` e `history`.
- `conexao()`, que na Cloud API vira "número registrado e qualidade".

**Regra de roteamento central** (num lugar só), um `enviar(lojaId, intenção, dados)`: se a loja é `cloud` e a janela está fechada, usa template; senão, texto livre. A escolha de provedor é por loja, com `restaurantes.whatsapp_provedor = 'evolution' | 'cloud'`. Pela regra de default seguro, a coluna nasce `evolution` para as lojas existentes.

**Dados novos** (uma migration):

- `whatsapp_contas`: loja, `waba_id`, `phone_number_id`, token cifrado, status, qualidade, limite.
- `whatsapp_templates`: loja, nome, categoria, status, idioma.

O OTP, os avisos e as campanhas passam todos pela fila (`lib/mensageria/fila.ts`), e acabam os envios diretos de `lib/whatsapp.ts`.

**Webhook.** Rota nova `/api/whatsapp/meta`: GET para verificação e POST com checagem de HMAC, resolvendo a loja pelo `phone_number_id`. Reaproveita `entrada.ts`.

**Migração loja a loja.**

1. O dono clica em "Conectar WhatsApp oficial" no Embedded Signup em modo coexistência, com o mesmo número do app.
2. Na Evolution, o número aparece como aparelho vinculado. Ao entrar na coexistência os aparelhos são desconectados, então a instância Evolution cai sozinha nesse momento: **é o corte natural**.
3. Na mesma hora a loja passa para `cloud`. Os templates padrão já foram enviados à aprovação antes, assim que a WABA é criada.
4. Até os templates serem aprovados (minutos a horas), os avisos de pedido ficam em espera ou caem no fallback, que deve ficar atrás de um interruptor por loja.

Sugestão: criar a WABA e aprovar os templates **antes** de virar a chave. O celular da loja continua funcionando durante tudo isso.

**Esforço estimado**

| Fase | Conteúdo | Dias |
|---|---|---|
| 0 | Verificação do negócio Menuzia, app na Meta, App Review, Access Verification (calendário: 2 a 6 semanas de espera) | 2 de trabalho |
| 1 | Provedor Cloud API (envio de texto, mídia, template e interativo; webhook com HMAC; normalização; testes com o `simulado`) | 5–7 |
| 2 | Embedded Signup + coexistência no painel (Integrações), tokens, `whatsapp_contas`, sync de histórico e contatos | 4–6 |
| 3 | Templates: catálogo padrão, criação via API, status, roteamento janela/template, avisos e OTP na fila | 4–6 |
| 4 | Campanhas com template de marketing (seleção ou criação de template, aprovação, custo estimado na tela) | 3–5 |
| 5 | Central: janela de 24 h na UI, template "retomar conversa", mídia por media id, botões no robô | 3–4 |
| 6 | Piloto na Menuzia e depois loja a loja (runbook, acompanhamento de qualidade e fatura) | 2–3 |
| **Total** | | **≈ 22–32 dias** + espera da Meta |

**Riscos**

- Valores e regras de preço mudaram duas vezes em 2026 (BRL em 01/07, serviço cobrado em 01/10). É preciso mostrar o custo estimado no painel e conferir a primeira fatura.
- A loja precisa cadastrar o meio de pagamento; sem ele, só sai o que é grátis e os **templates não saem**.
- Templates rejeitados ou recategorizados (por exemplo, um utility com cupom vira marketing). Usar textos neutros e acompanhar o status.
- Lojas sem verificação ficam travadas em 250 contatos por dia fora da janela.
- O custo das campanhas sobe muito, o que pode reduzir o uso pelas lojas.
- A coexistência exige abrir o app a cada 13–14 dias e tira listas de transmissão e grupos do número da loja.
- Ficamos dependentes da aprovação do App Review da Menuzia. Plano B: começar por um BSP com coexistência (360dialog, €49 por número) enquanto a aprovação sai, já que a interface do provedor isola essa escolha.

**Recomendação final.** Migrar para a **WhatsApp Cloud API oficial com a Menuzia como Tech Provider**, usando Embedded Signup com coexistência: cada loja mantém o número e o app no celular, tem a própria WABA e paga a Meta direto em BRL, sem taxa de intermediário.

1. **Já:** iniciar a verificação do negócio e o App Review (é o caminho crítico) e implementar o provedor Cloud API atrás da interface existente.
2. **Prioridade de migração:** OTP e avisos de pedido primeiro (maior risco hoje, custo baixo), depois robô e central, e campanhas por último, com aviso claro de custo.
3. **Evolution:** fica só como legado durante a transição. Parar de usá-la no OTP e nas campanhas assim que cada loja migrar.

BSP só como ponte, se o App Review demorar.
