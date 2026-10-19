# Kanban — ajustes 19/10/2026 (branch redesign-kanban, SÓ LOCAL)

Blocos A→G do pedido do dono. Ao fim de cada bloco: commit + atualizar aqui.
Se o terminal fechar: ler este arquivo e continuar do próximo bloco não marcado.

| Bloco | Estado | Feito | Falta |
|---|---|---|---|
| A — observação intocada + histórico de alterações | FEITO (commit "Bloco A") | `edicoes[].alteracoes` estruturado (tipo, item, de/para, origem/via); editar.ts não toca mais em `observacao`; comanda recebe "PEDIDO ALTERADO (hh:mm): − 1× fsd · + 1× coca lata" curto montado NA IMPRESSÃO (payload, layout do Assistente intocado) e não imprime item removido; KDS faixa curta do histórico; painel: linha amarela compacta + "ver histórico", item removido riscado/"removido", adicionado amarelo/"adicionado", endereço/taxa/cupom/pagamento/troco com antigo riscado; card idem nos itens; 15 pedidos de teste da Menuzia limpos (.medidas/limpar-observacao-edicao.mjs); testes 15/15 | conferência visual fica para o Bloco G |
| B — Cancelado ≠ Não entregue | em andamento | | |
| C — paleta de botões (tokens da barra do despacho) | pendente | | |
| D — modal do pedido (ícones, cabeçalho, biblioteca de ícones) | pendente | | |
| E — card: logo grande da origem + pedidos fake iFood | pendente | | |
| F — animação de pedido novo | pendente | | |
| G — testes, build, prints, dev server | pendente | | |
