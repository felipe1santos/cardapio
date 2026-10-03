# PDV: forma de pagamento e troco antes de lançar + caixa que abre sozinho — progresso

## 2026-10-02 22:40 (horário de SP)

### Parte 2.3: levantamento (só leitura) e backup

Backup em `~/backups/menuzia/2026-10-02-caixas-automaticos/` (`ponto-400-hamburgueria.json` e `menuzia.json`): turno,
pedidos entregues, acertos e pagamentos.

Caixas abertos sozinhos pela regra da 0115 que **nunca foram fechados**:

| Loja | Aberto (SP) | Horas aberto | Entregas desde então | Entregas em dinheiro com motoboy | Acertos | Financeiro |
|---|---|---|---|---|---|---|
| Ponto 400 Hamburgueria | 30/09 23:01 | ~48 h | 16 (30/09: 5 · 01/10: 6 · 02/10: 5) | 4 — R$ 214,99 (R$ 77,00 · R$ 80,99 · R$ 57,00) | 0 | desligado |
| Menuzia (teste) | 02/10 07:57 | ~15 h | 4 | 1 — R$ 32,00 | 0 | ligado |

Nenhuma outra loja tem caixa aberto.

A Ponto 400 nunca fez acerto de motoboy pela Logística: a tela "Fechamento de caixa" vem somando as entregas em dinheiro
desde 30/09.

### Plano
- **Parte 1:** forma de pagamento e troco antes de lançar, no PDV/balcão. Mesmo modelo da vitrine:
  `pedidos.forma_pagamento` e `troco_para`.
- **Parte 2.1:** com o financeiro ligado, a entrega não abre mais o caixa. O dinheiro fica "a acertar" no livro-caixa,
  sem turno, e entra no turno de quem acertar. Aviso no topo e alerta depois de X h (padrão 2 h).
- **Parte 2.2:** sem o financeiro, o fechamento da Logística é por **dia operacional**. Regra no relatório.
- **Parte 2.3:** encerrar o caixa da Ponto 400 sem apagar nem mudar valores, com auditoria. Ajustar o caixa 3 da Menuzia.

## 2026-10-02 23:45 — implementado e testado (local)

- Migration 0135, com rollback (testado: desfaz e reaplica).
- PDV: bloco "Pagamento" com escolha obrigatória antes de lançar e troco com atalhos. O troco é conferido no banco
  contra o total da conta. Mesa segue sem esta etapa.
- Alterar a forma depois de lançar, com auditoria e aprovação por PIN depois de sair para entrega ou de pago.
- A forma aparece no Kanban, no detalhe do pedido, na cozinha, na Logística (alerta de troco), no motoboy, no WhatsApp e
  na impressão.
- Corrigido: entrega do balcão já paga no caixa contava de novo no acerto do motoboy.
- Caixa com financeiro: a entrega não abre mais o caixa. O dinheiro fica "a acertar", com aviso no topo e alerta depois
  de 2 h, e entra no turno de quem acertar.
- Caixa sem financeiro: um turno por dia operacional (05:00).
- Script de ajuste de produção: `scripts/seguranca/ajustar-caixas-automaticos-0135.mjs`. Por padrão faz e desfaz.

Testes:

| Suíte | Resultado |
|---|---|
| e2e-pdv-pagamento | 57/57 |
| financeiro integrado | 52/52 |
| financeiro Fase 1 | 66/66 |
| financeiro Fase 2 | 55/55 |
| PDV v2 | 70/70 |
| balcão/entrega | 84/84 |
| PDV atendimento | 97/97 |
| PDV janelas | 53/53 |
| PDV navegação | 30/30 |
| impressão | 40/40 |
| caixa turnos / regras | 18/18 · 34/34 |
| garçom | 47/47 |
| cozinha | 26/26 |
| equipe | 75/75 |
| menu | 16/16 |
| robô | 106/106 |
| unitários | 1.930 |
