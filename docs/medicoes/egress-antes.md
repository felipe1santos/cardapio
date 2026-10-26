# Egress do painel — linha de base (antes) — 25/10/2026

Branch `fix/egress-realtime` (a partir de `main` `ff4c9298`), antes de qualquer mudança de código.
Achados da auditoria: #5 (Kanban relê tudo), #6 (canais duplicados em `pedidos`), #7 (heartbeat do motoboy), #24 (canal do PDV).

## Como foi medido
- **Contagem de requisições**: `fetch` da página instrumentado (só URL e tamanho do corpo; nenhum dado lido), aba do Kanban
  aberta em `localhost` (loja de teste Menuzia) por 2,2 min sem nenhum pedido mudando.
- **Tamanho das respostas**: mesma instrumentação no painel de produção da Ponto 400 (sessão já aberta), disparando a recarga
  que a própria tela faz ao voltar a ficar visível. Só leitura; registrados apenas bytes e número de linhas.
- **Requisições por evento**: contadas no código (cada caminho abaixo cita o arquivo) e conferidas com a medição.
- Bytes = corpo **descomprimido** (o que o navegador entrega ao JS). O egress cobrado pelo Supabase é o tráfego comprimido,
  então os números absolutos ficam acima do cobrado; a **proporção** antes/depois é o que vale.
- Não foi possível ligar 2 motoboys reais: o custo por heartbeat foi calculado pelo caminho do código × tamanhos medidos.

## Tamanhos medidos (Ponto 400, 25/10 ~22h)
| Consulta | Linhas | Tamanho |
|---|---|---|
| Kanban ativos (`recebido/preparando/pronto`, `PEDIDO_SELECT`) | 6 | 13,8 KB |
| Logística (`pronto/em_rota`, entrega) | 3 | 6,3 KB |
| Concluídos do dia (`entregue/cancelado`) | 9 | 20,6 KB |
| Corridas, solicitações, alarme, `restaurantes` | — | < 0,5 KB |
| **Uma recarga do Kanban** | 18 | **41,5 KB** |

≈ **2,2 KB por pedido** no formato completo. Os concluídos crescem o dia todo: com 60 concluídos no fim do dia, uma recarga
passa de ~150 KB.

## Requisições por evento em `pedidos` (aba do Kanban)
| Quem reage | Caminho | Req |
|---|---|---|
| Contadores do menu | `app/admin/layout.tsx:283` → `contarBadgesNav` (corte + 2 contagens) | 3 |
| Alarme | `components/admin/alarme-global.tsx:83` → `listarRecebidosParaAlarme` (corte + pedidos + solicitações) | 3 |
| Kanban | `app/admin/pedidos/page.tsx:623` → `refetch` (ativos + logística + concluídos + corridas + solicitações) | 5 |
| **Total por evento** | 3 canais na mesma tabela | **11 req, ~42 KB** (Ponto 400 agora; ~150 KB no fim de um dia cheio) |
| + Despacho de rotas aberto | `components/pedidos/rota-panel.tsx:214` (rotas 12 h + entregadores ×2 + corridas) | +4 |

Sem debounce: um pedido gera ~5–7 UPDATEs no ciclo de vida (status, notificação, coordenadas, impressão, edição), cada um
com o custo inteiro acima.

## Requisições por heartbeat de motoboy (`UPDATE entregadores` a cada 30 s)
| Tela aberta | Caminho | Por heartbeat |
|---|---|---|
| Pedidos/Logística | `app/admin/lista-pedidos/page.tsx:290` → `refetchAgora` (logística + entregadores ×2 + concluídos) | 4 req, ~27 KB |
| Despacho de rotas | `rota-panel.tsx:215` → `refetch` (rotas 12 h + entregadores ×2 + corridas) | 4 req |
| Kanban sem Despacho | — | 0 |

**Com 2 motoboys online** (4 heartbeats/min) e a Logística aberta: **+16 req/min e ~108 KB/min** sem nenhum pedido mudar.

## Medição parada (Kanban, 2,2 min, nenhum evento)
| Origem | Req em 2,2 min |
|---|---|
| Alarme (`restaurantes` + `pedidos` + solicitações a cada 20 s) | 21 |
| Aprovações remotas (10 s) | 13 |
| Alarme do Assistente (15 s) | 9 |
| Kanban (heartbeat de 60 s: 5 req) | 10 |
| Alertas WhatsApp / impressão / sessão | 6 |
| **Total** | **59 → 26,8 req/min** |

## PDV (achado #24)
`app/admin/pdv/page.tsx:523` reage a **qualquer** evento de `pedidos` da loja (inclusive delivery, que não muda mesa nem
comanda) com `/api/admin/pdv/comanda` (+ a comanda aberta), sem debounce. Somado a contadores (3) e alarme (3): ~8 req por
evento de delivery numa aba do PDV, sem efeito na tela.

## Resumo da linha de base
| Cenário | Req | KB |
|---|---|---|
| 1 evento em `pedidos`, aba do Kanban | 11 | ~42 (hoje) → ~150 (fim de dia cheio) |
| 1 pedido no ciclo de vida (~6 eventos) | ~66 | ~250–900 |
| 2 motoboys online, Logística aberta, 1 min parado | +16 | +~108 |
| Kanban parado, 1 min | 26,8 | ~4 (Menuzia) |
