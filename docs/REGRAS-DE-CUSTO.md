# ⚠️ REGRAS DE CUSTO — APIs pagas (leia antes de mexer em mapa, frete, IA ou qualquer API externa)

## O incidente (03/10 a 09/10/2026)

- **O quê:** cerca de **20 mil chamadas à Geocoding API** do Google em 7 dias, cerca de **R$ 200** (R$ 166 + impostos), no projeto
  "PROJETO API MAPS" (projeto-api-maps-487406). O faturamento foi desativado em 09/10 pelo dono.
- **Causa:** o mapa do despacho (`components/pedidos/rota-map.tsx`, dentro do `RotaPanel`) geocodificava os pinos dos pedidos
  **no navegador** num `useEffect` que dependia de `stops`. `stops` era um array novo a cada render. A página re-renderizava
  **a cada 1 segundo** (relógio `setNow` em `app/admin/pedidos/page.tsx` e `app/cozinha/[token]/page.tsx`) e a cada 7 s (recarga).
  A resposta do Google chegava depois que o efeito tinha sido cancelado, então **nunca entrava no cache**; endereço não
  encontrado também não era guardado. Resultado: cada pino era consultado no Google de novo, todo segundo, enquanto o painel
  de rotas ficasse aberto.
- **Correção (10/10):**
  - nenhuma chamada paga no navegador: o mapa usa coordenadas gravadas no pedido;
  - geocodificação só no servidor, uma vez, com cache de sucesso e de falha (`geocode_cache`);
  - toda chamada paga passa pela guarda (`lib/custo/guarda.ts`): limite diário, trava de disparo e alertas;
  - o relógio foi isolado e os props do mapa memorizados;
  - o frete tem reserva (bairro / taxa fixa) quando o Google não responde;
  - chave de servidor separada da chave do navegador.

## Regras permanentes

a) **Toda chamada a API paga passa por `chamarApiPaga()` (`lib/custo/guarda.ts`).** Google Maps (Geocoding, Directions, Places,
   Routes, Distance Matrix), OpenAI, Gemini, Anthropic, SMS, WhatsApp pago, qualquer outra. Sem exceção.

b) **Nunca chamar API paga em render, em `setInterval`, em `useEffect` com dependência instável (objeto/array/função nova a cada
   render), em polling ou em retry sem limite.** O navegador não chama API paga: pede ao servidor (`/api/mapa/*`).

c) **Cache de sucesso E de falha é obrigatório.** Grava a resposta ANTES de qualquer `if (cancelado) return`. Falha também fica
   guardada (geocode "não encontrado": 24 h; recusa do Google: 1 h).

d) **Geocodificar uma vez e gravar as coordenadas.** O pedido de entrega é geocodificado no servidor ao ser criado
   (`gravarCoordenadasDoPedido`) e as coordenadas ficam em `pedidos.entrega_latitude/longitude`. Mapa, rota, QR e frete usam
   as gravadas; nunca geocodificam de novo. Loja: `restaurantes.latitude/longitude`.

e) **Chave de servidor nunca no navegador; chave de navegador sempre restrita por domínio.**
   - `GOOGLE_MAPS_SERVER_KEY` (só no Coolify, sem `NEXT_PUBLIC`): Geocoding e Directions, restrita pelo IP do servidor.
   - `GOOGLE_MAPS_BROWSER_KEY` (Coolify, Build time; vira `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` no `next.config.ts`): só Maps
     JavaScript API (desenhar o mapa), restrita a `https://app.menuzia.com.br/*`.
   - Nenhuma chave no código, no git ou no JavaScript do site além da de navegador restrita.

f) **Toda API paga nova precisa de limite diário e alerta antes de ir para produção** (novo tipo em `ApiPaga`, limite em
   `LIMITE_*_DIA` no Coolify, teste de unidade da reserva quando bloqueada).

g) **Antes de publicar qualquer coisa que use API paga, estimar o custo por dia e por loja e escrever no PR/commit.**

## Como funciona hoje

| Peça | Onde | O que faz |
|---|---|---|
| Guarda | `lib/custo/guarda.ts` | trava de disparo (mesma chamada > 20/min), contagem atômica por API/loja/dia (`api_uso_dia`, `api_uso_contar`), alerta aos 80% e aos 100% (`api_alertas`), banco fora = não chama |
| Geocodificação | `lib/geocode/geocodificar.ts` | cache compartilhado por endereço normalizado (`geocode_cache`), sucesso e falha, só com `GOOGLE_MAPS_SERVER_KEY` |
| Frete | `lib/frete.ts` | bairro primeiro (grátis); raio só com faixa cadastrada; BrasilAPI (grátis) antes do Google; Google indisponível → reserva (taxa fixa da loja ou a maior faixa) |
| Mapa | `/api/mapa/coordenadas`, `/api/mapa/rota`, `/api/mapa/geocodificar` | sessão do painel ou token da cozinha/motoboy, limite por IP (120/min) e por loja (300/min); rota com cache de 10 min |

Limites (Coolify): `LIMITE_GEOCODING_DIA` (300), `LIMITE_DIRECTIONS_DIA` (300), `LIMITE_PLACES_DIA` (100),
`LIMITE_IA_CENTAVOS_DIA` (500 = R$ 5). Ver o uso: `select * from api_uso_dia order by dia desc` e `api_alertas`.

## Estimativa de uso (10/10/2026)

- **Geocoding:** cerca de 1 por pedido de entrega novo, com cache entre lojas (cliente recorrente não paga). Hoje são cerca de
  60 a 80 por dia, e o limite é 300.
- **Directions:** só quando alguém abre a rota desenhada, com cache de 10 min por rota. Estimativa: 20 a 50 por dia.
- **Maps JavaScript (carregar o mapa):** 1 por abertura de tela com mapa. Fica no navegador, fora da guarda, mas não tem loop.
- Tudo isso cabe na cota gratuita mensal do Google.

## Limpeza total do Google e chaves novas (10/10/2026)

**Regra: NENHUM outro sistema usa a chave do Menuzia. Cada sistema tem a sua própria chave, no seu próprio projeto do
Google, com cota diária, e só recebe chave depois de verificado que não tem loop.**

- **Projetos:** só existe o projeto **"Menuzia"** (`projeto-api-maps-487406`). Os outros 11 foram desligados em 10/10
  (exclusão definitiva em 09/11): elite-campus-416321, gen-lang-client-0119433185, gen-lang-client-0983815639,
  integrated-ray-462820-u8, involuted-reach-416321, leadflow-local, leadgen-flow, midyear-clone-466921-k3,
  plano-ideal-finder, rising-goal-462820-t5, studio-7192778330-64f99. Todas as chaves antigas foram excluídas
  (inclusive a que NR13 e DISPAROS-LEAD usavam junto com o Menuzia).
- **Faturamento:** uma conta só, **"Menuzia - Google Maps"** (01456B-8C09EE-838D63), ligada só ao projeto Menuzia.
  Orçamento **R$ 50/mês** com alerta por e-mail em 50%, 90% e 100% (o orçamento avisa, não corta — quem corta são as cotas).
- **APIs ativas:** só Maps JavaScript, Geocoding e Directions (+ Service Usage/Service Management, que o console
  precisa, e Telemetry, que não tem botão de desligar e é gratuita). Todas as outras foram desativadas.
- **Cotas diárias no Google** (IAM → Cotas; o dia do Google vira à meia-noite do Pacífico, ~04h/05h de Brasília):
  Geocoding v3 **300/dia** (v4: 0), Directions **300/dia**, Maps JavaScript **150 carregamentos/dia**.
- **Chaves** (valores só no Coolify, nunca no código, chat, log ou commit):
  - `GOOGLE_MAPS_BROWSER_KEY` — "Menuzia navegador": só Maps JavaScript, só `https://app.menuzia.com.br/*`.
    No Coolify com **Build time ligado** (`next.config.ts` a expõe como `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`).
  - `GOOGLE_MAPS_SERVER_KEY` — "Menuzia servidor": só Geocoding e Directions, só os IPs do servidor
    (187.77.34.112 e 2a02:4780:6e:9dea::1). No Coolify **sem** Build time.
  - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` foi apagada do Coolify.
  - ⚠️ Abrir telas de onboarding do Maps no console (lista de APIs do Maps, "Começar") pode CRIAR sozinho uma
    "Maps Platform API Key" sem restrição — conferir Credenciais depois e excluir.
- **Custo máximo possível por mês:** 300 × 31 = 9.300 Geocoding e 9.300 Directions; 150 × 31 = 4.650 mapas.
  Tudo abaixo da franquia gratuita mensal de 10 mil por SKU (Essentials) → **R$ 0** no pior caso, se o Google
  mantiver a franquia. Mesmo sem franquia, o teto seria ≈ US$ 46 + US$ 46 + US$ 33 por mês, e o orçamento avisa antes.

## Contador no Super Admin

`/superadmin` mostra, por loja e no total do dia (São Paulo): Geocoding, Directions e mapas carregados, com barra até
o limite (verde ≤ 50%, amarela ≤ 80%, vermelha acima), chamadas bloqueadas pela guarda, alertas de disparo e um
gráfico de 7 dias por API. Lê `api_uso_dia`; os mapas carregados são avisados pelo navegador em `/api/mapa/carregou`
(uma vez por carregamento do script, só conta). Código: `lib/custo/uso.ts`, `components/superadmin/uso-apis.tsx`.

## IA de atendimento (ChatGPT) — contador preparado (10/10/2026)

A IA ainda não existe no sistema; o contador e o teto já estão prontos para quando ela entrar.

- **Toda chamada à OpenAI passa por `chamarIa()` (`lib/custo/ia.ts`)**, nunca direto. Ela:
  1. confere o **teto em dinheiro** do dia: `LIMITE_IA_USD_DIA` (US$ 5 no sistema todo) e `LIMITE_IA_USD_DIA_LOJA`
     (US$ 1 por loja). Passou → não chama, alerta em `api_alertas` e a conversa vai para a reserva (atendente humano);
  2. passa pela guarda comum (api `ia`): trava de loop (mesma conversa > 20/min) e `LIMITE_IA_CHAMADAS_DIA` (2000);
  3. grava os **tokens reais** (`usage` da resposta) e o custo em `ia_uso_dia` (0174), por loja, por modelo e no total.
- **Preço:** tabela `PRECOS_IA` (US$ por 1M tokens) — conferir em openai.com/api/pricing antes de ligar; `IA_PRECOS`
  (JSON no Coolify) sobrepõe. Modelo desconhecido é cobrado como o mais caro: o contador nunca subestima.
- **Super Admin:** bloco "IA de atendimento (ChatGPT)" (gasto de hoje × teto, respostas, tokens, mês em US$ e R$ pela
  `COTACAO_DOLAR`, por modelo, 7 dias) e coluna "IA (ChatGPT)" por loja (hoje e mês). Selo "Ainda não ligada" enquanto
  não houver `OPENAI_API_KEY` no Coolify.
- **Ao ligar:** chave da OpenAI própria do Menuzia (projeto próprio na OpenAI, com limite mensal lá também), só no
  Coolify sem Build time; estimar custo por conversa e por loja no commit.
