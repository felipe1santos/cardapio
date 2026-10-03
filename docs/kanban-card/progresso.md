# Kanban — card do pedido mais limpo: progresso

## 2026-10-03 (noite)
- Card lido em `app/admin/pedidos/page.tsx`.
- **"Despacho de rotas"** (`components/pedidos/rota-panel.tsx` e `rota-map.tsx`) usa só `Button`/`Badge`, que não
  mudam. Nada nele foi tocado.
- **Componentes compartilhados:** a Cozinha e os Detalhes usam `InfoPagamento` e `EtiquetaAtendimento`. Por isso
  entraram **variantes opcionais** (`card`, `semFundo`); o padrão desses componentes continua igual.
- **Tempo:** `lib/tempo-pedido.ts` faz "13 min" / "2 horas" / "3 dias" e mantém as faixas de cor de antes (10 e
  20 min). O selo "Parado há…" saiu; o aviso dele continua no tooltip do contador e no ícone de avisos do topo.
- **Massa de teste:** `kanban-cards-semente.mjs` cria cards de vitrine, entrega, retirada, mesa (com comanda) e PDV,
  com nome longo, muitos itens, valor alto e tempos de 4 min, 3 horas e 2 dias.
- **Prints:** antes/depois em `prints/` (`kanban-cards-prints.mjs`).
- **Testes:** `e2e-kanban-card.mjs` 59/59; regressão em andamento.
