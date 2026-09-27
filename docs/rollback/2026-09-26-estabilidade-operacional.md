# Estabilidade operacional — 2026-09-26

Mesas e Comandas, Logística/Rotas e fonte única de status/financeiro. **Sem migration**:
só código (Next). Rollback = redeploy do commit anterior de `main` (a074f3f).

## O que muda

- **Mesas e Comandas / PDV**
  - Conta antiga aberta sem nome: "Fechar conta" pede o nome (modal) e segue direto para o
    fechamento completo — não trava mais. Nome e telefone editáveis a qualquer momento
    (cartão "Cliente" na conta da mesa; quem fecha a conta também pode identificar).
  - Fechar pela tela de Mesas usa o mesmo fechamento do PDV v2 (decide pendências da
    cozinha, recebe o saldo, fecha numa transação) em vez de exigir tudo pago antes.
  - Cancelar a conta inteira (mesa ou balcão) também no PDV v2: ação `cancelar_conta`
    (gestão: `pedidos.presencial.cancelar`), motivo ≥ 5 letras, recusada com pagamento
    (estorno antes) e com pedido em rota. Usa `comanda_cancelar` (0070): pedidos
    cancelados com `reimprimir=false`, auditoria `conta.cancelou_comanda`.
  - Resumo ao fechar/cancelar: total, pago, falta, pendentes, cancelados, motivo, autor e
    horário; avisa quando a mesa ficou em limpeza.
  - Conta aberta há mais de 24h: aviso dentro da conta da mesa.
- **QR em somente visualização**: o card amarelo virou ícone (i) na barra do topo; toque
  abre modal com a mesma explicação.
- **Logística / Despacho de rotas**
  - "Não foi possível salvar" falso: o indicador global contava o aviso de WhatsApp
    (`/api/pedidos/[id]/notificar`, fogo-e-esquece) e a cotação do Nexta como se fossem
    a gravação. Agora ficam de fora; requisição abortada não conta como erro.
  - WhatsApp (Evolution) com prazo de 10s.
  - Atribuição só em pedido pronto/em rota e confere as linhas gravadas: pedido cancelado
    em outra tela não volta para "em rota"; operador é avisado.
  - Logística recarrega no máximo uma vez por vez (junta rajadas de realtime).
- **Loja sem motoboy** (`usa_logistica=false` ou `entrega_sem_entregador=true`): botão
  Rotas desabilitado (Kanban e cozinha), despacho da cozinha recusado (409), e "Saiu p/
  entrega" avisa o cliente e conclui o pedido — inclusive com Logística desligada (antes
  ficava em rota esperando um ✓). Hoje afeta só a **estancia-burger**.
- **Status/financeiro**: Central de Balcão mostra "Saiu p/ entrega", "Entregue",
  "Cancelado"; financeiro Cancelado / Pago a mais; encerradas mostram o financeiro;
  filtro "A acertar" (entregue sem pagamento no caixa) com atalho "Receber e fechar".
  Portal do motoboy: pedido de balcão já pago no caixa aparece "Pago", sem "Receber".

## Provas (local, loja isolada)

- vitest completo, tsc, lint (mesmos 2 avisos antigos), build.
- `e2e-estabilidade-operacional.mjs` (novo), `e2e-pdv-atendimento`, `e2e-pdv-v2`,
  `e2e-balcao-entrega` em `cantina-e2e`; suítes de mesas em `cantina-mesas2`.

## Rollback

Redeploy de `a074f3f` no Coolify. Nada a desfazer no banco.
