# Kanban — ajustes 19/10/2026 (branch redesign-kanban, SÓ LOCAL)

Blocos A→G do pedido do dono. Ao fim de cada bloco: commit + atualizar aqui.
Se o terminal fechar: ler este arquivo e continuar do próximo bloco não marcado.

| Bloco | Estado | Feito | Falta |
|---|---|---|---|
| A — observação intocada + histórico de alterações | FEITO (commit "Bloco A") | `edicoes[].alteracoes` estruturado (tipo, item, de/para, origem/via); editar.ts não toca mais em `observacao`; comanda recebe "PEDIDO ALTERADO (hh:mm): − 1× fsd · + 1× coca lata" curto montado NA IMPRESSÃO (payload, layout do Assistente intocado) e não imprime item removido; KDS faixa curta do histórico; painel: linha amarela compacta + "ver histórico", item removido riscado/"removido", adicionado amarelo/"adicionado", endereço/taxa/cupom/pagamento/troco com antigo riscado; card idem nos itens; 15 pedidos de teste da Menuzia limpos (.medidas/limpar-observacao-edicao.mjs); testes 15/15 | conferência visual fica para o Bloco G |
| B — Cancelado ≠ Não entregue | FEITO (commit "Bloco B") | regra pura em lib/cancelamento.ts (`ehNaoEntregue`, `quemCancelou`, `rotuloCancelamento`, teste 3/3); `cancelado_por` com prefixo fixo (Loja: / Cliente (WhatsApp robô|IA) [· aplicado por] / Entregador: / sistema), formatos antigos ainda lidos; painel: "Cancelado pela loja · Nome · motivo" ou "Não entregue pelo motoboy Zé · motivo"; 4ª coluna: Cancelados × Não entregues; card da 4ª coluna com quem+motivo; aviso de 12 h: só em rota vira Não entregue (o resto cancela com "outro"); lista de pedidos usa o mesmo painel | relatórios/Dashboard não rotulam cancelado por tipo (só contam) — sem mudança |
| C — paleta de botões (tokens da barra do despacho) | em andamento | | |
| D — modal do pedido (ícones, cabeçalho, biblioteca de ícones) | pendente | | |
| E — card: logo grande da origem + pedidos fake iFood | pendente | | |
| F — animação de pedido novo | pendente | | |
| G — testes, build, prints, dev server | pendente | | |
