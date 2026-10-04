# Kanban — card mínimo + painel lateral do pedido: progresso

## 2026-10-03 (noite)
- **Dados:** a consulta do pedido (`PEDIDO_SELECT`) passou a trazer o horário de cada etapa (`preparando_em`,
  `pronto_em`, `em_rota_em`, `entregue_em`, já existentes desde a 0078) e o nome do motoboy.
  - O motoboy vem por `entregadores!pedidos_entregador_id_fkey`. A FK fica explícita porque a
    `fin_entregas_pagamento` cria um segundo caminho entre pedidos e entregadores.
- **Card de 3 linhas** em `app/admin/pedidos/page.tsx`:
  - clique no card abre o painel; o botão de etapa só avança;
  - saíram os itens, a linha de pagamento, o "Ver", o ✕ de recusar (cancelar fica no painel) e o selo "Novo" (a coluna
    laranja já diz isso; ele fazia a linha 1 quebrar com o painel aberto).
- **Painel** (`components/pedidos/painel-pedido.tsx`):
  - fica ao lado do quadro, num flex, sem overlay; no celular é `fixed inset-0`;
  - segue o pedido nas listas em tempo real; se o pedido sai delas (cancelado), relê do banco;
  - Esc fecha, a menos que haja uma janela por cima;
  - o rodapé deixa espaço para o botão flutuante de atendimento.
- **Testes:**
  - `e2e-kanban-card.mjs` reescrita: 72/72;
  - `balcao-entrega`, `pdv-atendimento`, `pdv-pagamento` e `responsivo-kanban` passam a abrir o painel clicando no
    card.
