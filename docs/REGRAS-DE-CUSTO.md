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
   - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: só Maps JavaScript API (desenhar o mapa), restrita aos domínios da Menuzia.
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
