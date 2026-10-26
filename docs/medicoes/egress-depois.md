# Egress do painel — depois — 25/10/2026

Branch `fix/egress-realtime`, commits `7d414b0a` (#6), `336f95ae` (#5), `1e2751d6` (#7), `ad29c7fd` (#24).
Mesmo método da [linha de base](egress-antes.md): `fetch` instrumentado (URL + tamanho do corpo descomprimido), contagem
de requisições por caminho do código e tamanhos medidos na Ponto 400 (≈ 2,2 KB por pedido no formato completo).

## Comparação

| Cenário | Antes | Depois | Como foi obtido |
|---|---|---|---|
| Canais de `pedidos` numa aba do Kanban | 3 (4 com Despacho) | **1** | Medido: joins do Realtime depois de reconectar (`pedidos-<loja>`; o do Kanban só com corridas e solicitações) |
| 1 evento em `pedidos`, aba do Kanban | 11 req, ~42 KB (Ponto 400 às 22h) → ~150 KB no fim de dia cheio | **7 req, ~2,5 KB** (contadores 3 + alarme 3 + 1 busca do pedido que mudou) — não cresce com o dia | Contado no código; tamanho = 1 pedido |
| Rajada de eventos do mesmo pedido (status + notificação + coordenadas em < 400 ms) | 1 recarga completa por evento | 1 busca curta para a rajada | Teste `criarColetorEventos` |
| 1 pedido no ciclo de vida (~6 eventos) | ~66 req, ~250–900 KB | ~42 req, ~15 KB | Contado no código |
| Evento de corrida (Lalamove/Uber) ou de solicitação | recarga completa do Kanban | só a lista dela (< 0,5 KB) | Código |
| Heartbeat de motoboy com Logística aberta | 4 req, ~27 KB | **0 req** (linha aplicada pelo evento) | Teste `aplicarEventoEntregador` + código |
| Heartbeat com Despacho aberto | 4 req | **0 req** | Idem |
| 2 motoboys online, Logística aberta, 1 min | +16 req, +~108 KB | **+0** | Contado |
| Relógio de 60 s do Kanban | 5 req, ~42 KB (concluídos inteiros) | 5 req, ~21 KB (concluídos só o que mudou, margem de 2 min) | Código; a Menuzia não tem concluídos hoje, então a medição local não mostra o delta |
| Evento de delivery numa aba do PDV | `/api/admin/pdv/comanda` (+ comanda aberta) | **0** | Teste `reacaoDoPdv` |
| Kanban parado, 1 min (medido) | 26,8 req/min | 26,8 req/min | Medido 2,2 min em cada lado — o ritmo parado vem do alarme (20 s), aprovações (10 s) e Assistente (15 s), achado #22, fora deste escopo |

### Estimativa de um dia (Ponto 400, 1 aba do Kanban aberta 12 h, 200 pedidos, 2 motoboys)
| Origem | Antes | Depois |
|---|---|---|
| Eventos de pedido (200 × ~6, concluídos crescendo) | ~1.200 recargas × ~90 KB médio ≈ **108 MB** | ~1.200 × ~2,5 KB ≈ **3 MB** |
| Relógio de 60 s (720 ×) | ~720 × ~90 KB ≈ **65 MB** | ~720 × ~21 KB ≈ **15 MB** |
| Heartbeat com Logística aberta (2 motoboys, 12 h) | ~2.880 × ~27 KB ≈ **78 MB** | **0** |
| **Total por aba** | **≈ 250 MB/dia** | **≈ 18 MB/dia** |

Bytes descomprimidos; o egress cobrado é o comprimido, então o valor absoluto cobrado é menor nos dois lados. A proporção
(~93 % a menos nessas origens) é o que importa.

## Teste de ponta a ponta (25–26/10, autorizado pelo dono, loja Menuzia, servidor local na branch)
Duas abas: a **A** só observa (fetch instrumentado), a **B** age. A A só fica sabendo pelo Realtime.

| Passo (na aba B) | O que a aba A fez | Resultado na A |
|---|---|---|
| Aceitar #586 (recebido → preparando) | contadores 3 + alarme 3 + **1** `pedidos?id=in.(…)` 1,5 KB = **7 req, 1,6 KB** | #586 em Preparando, #587 em Recebido |
| #586 Pronto | idem, 1 busca de 1,5 KB | #586 em Pronto p/ Despacho; botão Despachar = 1 |
| Despachar #586 (motoboy de teste) | idem, 1 busca de 1,6 KB | #586 em Em trânsito |
| Entregue #586 | 2 eventos (status + processamento da entrega) → 2 buscas curtas, **3,6 KB no total** | Em trânsito 0, Concluídos 1, selo Entregue |
| Aceitar #587 (delivery) com a A no **PDV** | **nenhuma** chamada a `/api/admin/pdv/comanda` (só contadores e alarme) | #24 ok |
| Disponibilidade do motoboy de teste → Ocupado → Disponível, com a A na **Logística** | **nenhuma** requisição ao banco | A mostrou "ocupado" e depois "online" — #7 ok |
| #587 até entregue; A abre o Kanban do zero | relógio aos 56 s pediu concluídos `atualizado_em ≥ 03:11:48Z` (última leitura − 2 min), não `≥ 03:00Z` (início do dia) | #5 delta ok |
| Canais na aba do Kanban (reconexão forçada) | 1 canal de `pedidos` | #6 ok |

Efeitos reais do teste: os pedidos de teste #586 e #587 da Menuzia foram para **entregue** (motoboy "Teste Conferencia").
O WhatsApp da Menuzia estava desconectado, então nenhum aviso saiu; a impressão segue a configuração da loja.

## O que não deu para medir ou testar
- **App do motoboy aberto de verdade**: o heartbeat real não foi disparado (o link do app tem token, que não manipulei);
  testei o mesmo caminho — UPDATE em `entregadores` vindo de outra aba —, que é o que o heartbeat gera.
- **Tamanho comprimido** (o que o Supabase cobra): o navegador não expõe o tamanho transferido das respostas do Supabase.
