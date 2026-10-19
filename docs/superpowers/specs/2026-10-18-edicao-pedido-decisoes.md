# Edição de pedido — decisões da entrevista (18/10/2026)

Respostas do dono às rodadas 1 e 2 (grill-me). Valem como especificação.

| # | Decisão |
|---|---|
| Q1 | Duas fases (painel; depois WhatsApp), na branch `redesign-kanban`. Nada em produção antes do APROVADO do redesign. |
| Q2 | Editável em Recebido/Preparando/Pronto **sem ter saído**: sem motoboy, sem corrida Lalamove chamada, sem "Saiu p/ entrega". Retirada: até Entregue. Depois: "já foi despachado e não pode mais ser alterado". |
| Q3 | Cliente **pede**, a loja aplica/recusa pelo card. Cancelamento automático só em Recebido **e** não pago online; pago online sempre vira solicitação. |
| Q4 | Robô simples: opção "Alterar ou cancelar meu pedido" **só** quando o número tem pedido aberto; coleta texto livre e manda como solicitação. A IA estrutura a mudança com itens reais do cardápio e preço do servidor; nunca inventa. |
| Q5/estorno | Pago online: total pode mudar **só** com "receber a diferença na entrega" (aumentou) ou **estorno parcial** pelo Mercado Pago (diminuiu; a doc do MP aceita `amount` em `POST /v1/payments/{id}/refunds`). Sem isso, bloqueia com aviso. Pix da diferença = fase 3. |
| Q6 | Reimprimir comanda marcado por padrão; etiqueta "editado" no card e última mudança no painel. |
| Q7 | Avisar o cliente no WhatsApp quando a loja aplica, recusa ou edita por conta própria. |
| Q8 | Quem edita: dono, gerente e atendente até o despacho. KDS e motoboy não. |
| Q9 | Tabela `pedido_solicitacoes`; uma pendente por pedido (texto novo se acrescenta). Proposta estruturada quando a IA mapear. |
| Q10 | Janela "Editar pedido" com abas Itens · Endereço · Pagamento; adicionar item com o `ConfigurarItem` do PDV; preço pelo `precificarLinhas`. |
| Q11 | Item removido = `cancelado_em` (nunca delete); totais, fidelidade e KDS ignoram. |
| Q12 | Agendado: mesmas regras. Aguardando pagamento: só cancelar/trocar pagamento. |
| Q14 | 5 min sem resposta → conversa pede atendente (amarela na central) + "Já avisamos a loja, um atendente vai te responder"; a solicitação segue pendente no card. Cron `whatsapp` (1 min). |
| Q15 | Alarme: mesmo som uma vez + card pulsa amarelo com [Aplicar] [Recusar]; conta no triângulo. Recusar: motivo curto opcional, vai ao cliente. |
| Q16 | "ALTERADO" na comanda **sem mexer no Assistente**: pelo campo `Obs. do pedido` que o Alfa 1 já imprime (`pedidos.observacao` ganha o bloco "PEDIDO ALTERADO (hh:mm): …"); KDS com faixa amarela. Se não der, só KDS nesta fase. |
| Q17 | iFood/outros apps: não há integração; aviso "edite no app de origem" previsto no código. |
| Q18 | Textos padrão editáveis em Mensagens automáticas: alterado / não pôde alterar / já saiu para entrega / avisamos a loja. |
| Extra | Mudou endereço → recalcular taxa pela regra da vitrine e avisar se fora da área; cupom com pedido mínimo e prêmio de fidelidade revalidados. |
