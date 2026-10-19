# Edição de pedido (painel) + solicitações do cliente pelo WhatsApp — Plano

> **Para quem executa:** usar superpowers:executing-plans (ou subagent-driven-development) tarefa a tarefa; `- [ ]` marca o progresso. Branch `redesign-kanban` (em cima do redesign, por ordem do dono em 18/10). **Nada vai para produção antes do APROVADO do dono no redesign.** Decisões da entrevista (Q1–Q18) em `docs/superpowers/specs/2026-10-18-edicao-pedido-decisoes.md`.

**Meta:** a loja edita um pedido de delivery pelo lápis do card (itens, endereço, pagamento) enquanto ele não foi despachado; o cliente pede alteração ou cancelamento pelo WhatsApp (robô simples e Agente de IA) e a loja aplica/recusa pelo card, com alarme, prazo de 5 min para atendente e avisos ao cliente. Pago online: estorno parcial pelo Mercado Pago quando o total diminui; "receber a diferença na entrega" quando aumenta.

**Arquitetura (em uma frase cada):**
- **Uma rota de edição** (`POST /api/admin/pedidos/[id]/editar`) faz tudo no servidor: valida "editável" (status + sem despacho), reprecifica com `precificarLinhas` (o da vitrine), refaz frete com `resolverFrete`, revalida cupom (`validarCupom`/`calcularDesconto`), grava itens (remoção = `cancelado_em`, nunca delete), total, `observacao` com o bloco "PEDIDO ALTERADO: …", `reimprimir`, auditoria, aviso ao cliente. A IA, o robô e o painel **chegam à mesma rota** (o painel direto; as solicitações via "Aplicar").
- **Solicitação do cliente** é uma linha em `pedido_solicitacoes` (uma pendente por pedido) que o card mostra com [Aplicar] [Recusar]; o cron `whatsapp` (1 min) escala para atendente após 5 min.
- **"Despachado"** = `status in (em_rota, entregue, cancelado)` **ou** `entregador_id` **ou** corrida Lalamove ativa **ou** `saiu_para_entrega_em`. Regra pura em `lib/pedido-editavel.ts`, usada por painel, IA, robô e rota.
- **Pago online e total muda:** diminuiu → estorno PARCIAL (`amount` em `POST /v1/payments/{id}/refunds`, confirmado na doc do MP) com a mesma aprovação de gerente do estorno atual; aumentou → só com "receber a diferença na entrega" (`pedidos.diferenca_a_receber`); senão bloqueia. Pix da diferença fica para a fase 3.
- **Comanda "ALTERADO" sem mexer no Assistente:** o Alfa 1 imprime `Obs. do pedido: <pedidos.observacao>` e o KDS mostra `⚠ Pedido: <observacao>`; a edição prefixa a observação com `PEDIDO ALTERADO (hh:mm): −cebola no X-Tudo · +1× Coca 2L` (o bloco é regerado a cada edição, mantendo a observação original depois dele). **Proibido tocar em `printer-agent/`.**

**Stack:** Next.js App Router + TypeScript, Supabase (Postgres, RLS, realtime), Tailwind, Vitest; Mercado Pago (estorno); Evolution (WhatsApp).

## Regras fixas

- CLAUDE.md: paleta, radius, nada de API paga fora da guarda (não há API paga nova aqui); **não tocar em `printer-agent/`**; migrations aditivas e idempotentes; default seguro (coluna nova não muda pedido antigo).
- Mesmos handlers/permissões do Kanban: editar = quem pode "Alterar pagamento" hoje (dono, gerente, atendente) até o despacho; KDS e motoboy não.
- TDD nas regras de dinheiro: teste que falha primeiro (`lib/pedido-editavel.test.ts`, `lib/pedido-edicao-regras.test.ts`, `lib/pagamentos/*.test.ts`).
- Testar na Menuzia com pedidos de teste (telefone do dono); nenhum pedido de loja real.
- Baseline vitest antes da Task 1: anotar `npx vitest run` (hoje: 2866 passed / 10 skipped; 2 falhas de timeout sob carga conhecidas).
- Gate: `npx tsc --noEmit` sem erro; `node scripts/custo/regra-1.mjs` ok; `npx next lint` sem warning novo.

## Fase 1 — Edição pelo painel (lápis)

### Banco — `supabase/migrations/0200_edicao_pedido.sql`
- [ ] `pedidos`: `editado_em timestamptz`, `editado_por_nome text`, `edicoes jsonb not null default '[]'` (histórico curto: `{em, por, origem, mudancas[]}`), `diferenca_a_receber numeric(10,2)`, `observacao_original text` (a observação sem o bloco ALTERADO).
- [ ] `pedido_itens`: já tem `cancelado_em/cancelado_motivo/cancelado_por_nome` (0067). Nada novo.
- [ ] `pedido_solicitacoes` (Fase 2, mas cria aqui): `id, restaurante_id, pedido_id, origem ('robo'|'ia'), tipo ('alterar'|'cancelar'), texto text, proposta jsonb null, status ('pendente'|'aplicada'|'recusada'|'cancelada'), motivo_recusa text, decidido_por_nome, decidido_em, escalada_em, criado_em, atualizado_em`; índice único parcial `(pedido_id) where status='pendente'`; RLS select por tenant (`auth_restaurante_id()`), escrita só servidor; `alter publication supabase_realtime add table`.
- [ ] Rollback em `docs/rollback/0200_edicao_pedido.down.sql`. Script `.medidas/aplicar-0200.cjs` (ensaio + `--aplicar`).

### Regras puras (TDD)
- [ ] `lib/pedido-editavel.ts`: `pedidoEditavel(p, corridaAtiva): { ok: true } | { ok: false; motivo: 'despachado'|'entregue'|'cancelado'|'aguardando_pagamento'|'mesa'|'app_externo' ; texto }` — textos: "Este pedido já saiu para entrega e não pode mais ser alterado", "edite no app de origem" (previsto; sem origem externa hoje). Teste cobre cada ramo, agendado (editável), Lalamove chamada (não editável).
- [ ] `lib/pedido-edicao-regras.ts`: `calcularEdicao({ itensAtuais, mudancas, taxaEntrega, desconto, cupom }) → { linhasGravar, itensCancelar, subtotal, total, mudancasTexto[] }`; `blocoAlterado(mudancasTexto, agora, observacaoOriginal) → observacao`; `decisaoPagamentoOnline({ pago, pagamentoOnline, totalAntigo, totalNovo, escolha }) → { ok, acao: 'nada'|'estorno_parcial'|'diferenca_entrega', valor } | { ok:false, texto }`. Testes: redução → estorno parcial do delta; aumento sem escolha → bloqueia; aumento com "diferença na entrega" → grava delta; cupom que perde o mínimo → desconto zera + mudança "Cupom X removido (pedido mínimo)".

### Servidor
- [ ] `lib/pagamentos/mercadopago.ts`: `reembolsar(token, id, idem, valor?)` manda `{ amount }` quando `valor` vem (simulado idem). `lib/pagamentos/pix-online.ts`: `devolverPix(..., { valorCentavos? })` → estorno parcial grava `devolucao_valor` (coluna nova em `pagamentos_online`, na 0200) e lançamento negativo do valor; status `devolvido_parcial`. Teste no simulado.
- [ ] `lib/pedidos/editar.ts` (novo, server-only): `editarPedido(admin, { restauranteId, pedidoId, por, origem: 'painel'|'solicitacao', mudancas: { itens?: { adicionar?: NovoItem[], remover?: itemId[], quantidade?: {itemId, qtd}[], observacao?: {itemId, texto}[] }, endereco?: {...}, pagamento?: {...}, pagoOnline?: { escolha: 'estorno_parcial'|'diferenca_entrega' } }, reimprimir })`:
  1. carrega pedido + corrida ativa → `pedidoEditavel`;
  2. itens novos → `precificarLinhas` (canal delivery, mesma validação da vitrine);
  3. endereço novo → `resolverFrete` (fora da área → erro "Endereço fora da área de entrega"); `gravarCoordenadasDoPedido` depois;
  4. cupom → revalida mínimo; prêmio de fidelidade (`recompensa_id`) mantém se o item do prêmio continua;
  5. `calcularEdicao` + `decisaoPagamentoOnline`; estorno parcial via `devolverPix` com a aprovação que já existe (PIN de gerente quando o financeiro está ligado);
  6. transação: update `pedido_itens` (cancelar/qtd/obs), insert novos, update `pedidos` (subtotal, taxa, desconto, total, endereço, observacao = bloco ALTERADO + original, editado_*, edicoes, reimprimir, diferenca_a_receber, troco recalculado — se `troco_para < total` novo, zera e avisa);
  7. `registrarAuditoria` `pedido.editado` (rótulo em `lib/queries/auditoria.ts`, grupo pedidos);
  8. WhatsApp ao cliente (texto `pedido_alterado` com as mudanças e o novo total) via `enviarWhatsapp` com registro na central.
- [ ] `app/api/admin/pedidos/[id]/editar/route.ts`: sessão, permissão (`pedidos.delivery.avancar` ou `logistica.operar`), corpo validado, chama `editarPedido`, devolve o pedido novo. Entrada em `lib/auth/rotas.ts` já coberta por `/api/admin/pedidos` → `pedidos.delivery.cancelar`? **Não**: criar entrada mais específica `['/api/admin/pedidos/*/editar', 'pedidos.delivery.avancar']` antes da genérica (conferir que o matcher aceita; senão a rota confere por dentro e a entrada genérica fica).
- [ ] `lib/fidelidade.ts`: `qtdItens` ignora `cancelado_em` (bug encontrado no levantamento).
- [ ] `lib/queries/pedidos.ts`: `PEDIDO_SELECT`/`mapPedido` com `editadoEm`, `editadoPorNome`, `edicoes`, `diferencaAReceber`; `mapPedido.itens` **filtra `cancelado_em`** (o painel/KDS/comanda já não veem item removido; o histórico fica em `edicoes`).

### Painel (branch do redesign)
- [ ] `components/pedidos/editar-pedido.tsx`: `ModalCentral` "Editar pedido #N" com abas **Itens · Endereço · Pagamento**. Itens: lista (qtd −/+, remover, observação), "Adicionar item" com `ConfigurarItem` do PDV (`components/pdv/configurar-item.tsx`) + catálogo via a mesma consulta do PDV; Endereço: campos + CEP (autofill existente) + taxa recalculada ao salvar; Pagamento: `EditorPagamento` atual. Rodapé: resumo das mudanças, novo total, caixa "Reimprimir comanda" (ligada), [Salvar]. Pago online: faixa com a decisão (estorno parcial R$ X / receber diferença na entrega) obrigatória.
- [ ] Lápis do card e do painel da direita abrem essa janela (hoje abre só Pagamento). Pedido não editável: o lápis fica desabilitado com a dica do motivo; o modal mostra o aviso.
- [ ] Card: etiqueta **"editado"** (cinza-azul) + no painel "Alterado às hh:mm por Fulano: …" (de `edicoes`). KDS (`components/admin/kds/quadro-kds.tsx`): faixa amarela "ALTERADO" quando `editadoEm` > `preparando_em` (ou sempre que houver `edicoes`), com as mudanças.
- [ ] Mensagem automática `pedido_alterado` em Campanhas › Mensagens automáticas (lib/mensagens-status ou equivalente) com padrão "Seu pedido #{numero} foi alterado: {mudancas}. Novo total {total}."

### Testes e conferência (Fase 1)
- [ ] Unit: regras puras, estorno parcial no simulado, `pedidoEditavel`.
- [ ] E2E local (`.medidas/e2e-edicao-pedido.mjs`, perfil do Playwright já logado): pedido de teste na Menuzia → +1 item, −1 item, obs, endereço novo (taxa muda), pagamento; conferir total, `observacao` com ALTERADO, `reimprimir`, auditoria, WhatsApp registrado; pedido em rota → lápis bloqueado; pedido pago online (simulado MP) → redução com estorno parcial, aumento com "diferença na entrega".
- [ ] Prints para o dono: janela de edição (3 abas), card "editado", KDS "ALTERADO".

## Fase 2 — Cliente pelo WhatsApp (robô e IA)

### Solicitação (servidor)
- [ ] `lib/pedidos/solicitacoes.ts`: `abrirSolicitacao(admin, { pedidoId, origem, tipo, texto, proposta? })` (acrescenta ao pendente se já houver), `aplicarSolicitacao` (→ `editarPedido` com a proposta; `cancelar` → a mesma rota de cancelamento do painel com motivo `cliente_pediu`), `recusarSolicitacao` (motivo opcional → WhatsApp "A loja não pôde alterar: …"), `escalarPendentes` (≥ 5 min: marca a conversa `atendimento='aguardando'` + `pediu_atendente_motivo` e manda "Já avisamos a loja, um atendente vai te responder"; chamada pelo cron `whatsapp` ao lado de `avisarAtendentesPendentes`).
- [ ] Cancelamento automático: `tipo='cancelar'` com pedido em `recebido` **e** não pago online → cancela na hora (mesma rota/efeitos de cancelar), WhatsApp confirma; senão vira pendente.
- [ ] `app/api/admin/pedidos/[id]/solicitacao/route.ts`: `POST { acao: 'aplicar'|'recusar', motivo? }` (mesma permissão da edição).

### Agente de IA
- [ ] `lib/agente-ia/pos-pedido.ts` + `ferramentas.ts`: `alterar_itens` / `alterar_endereco` / `outro` deixam de chamar atendente quando o pedido é editável: a IA monta a **proposta** com itens reais (ferramenta de busca no cardápio que já existe; preço sempre do servidor via `precificarLinhas`; nunca inventar) e abre a solicitação; resposta ao cliente: "Anotei: −cebola no X-Tudo, +1× Coca 2L (novo total R$ 42,00). A loja vai confirmar." `cancelar` fora de `aguardando_pagamento`: automático em `recebido` não pago online; senão solicitação. Pedido despachado: texto fixo "Este pedido já saiu para entrega…". Prompt (`prompt.ts`) atualizado. Testes dos planos (`pos-pedido.test.ts`).

### Robô simples (robo-auto)
- [ ] `lib/robo-auto/respostas.ts`/`motor.ts`: opção **"7 · Alterar ou cancelar meu pedido"** só quando `pedidosAbertosDoTelefone` tem pedido editável; fluxo: "O que você quer mudar?" → texto livre vira solicitação `alterar`; "cancelar" → confirma "Sim/Não" → solicitação `cancelar` (ou automático em recebido não pago online). Despachado → aviso fixo. Palavras já classificadas como `atendente` ("cancelar", "mudar o pedido", "esqueci") entram nesse fluxo. Testes do motor.

### Painel
- [ ] Card: faixa amarela "Cliente pediu: …" (texto + proposta estruturada quando houver) com [Aplicar] [Recusar]; pulsa; conta no triângulo de avisos; alarme toca uma vez (`aoAtualizarPedidos` com ids prefixados `sol:`); realtime em `pedido_solicitacoes` (adicionar à lista de tabelas do Kanban). Painel da direita mostra a solicitação. Recusar abre campo de motivo opcional.
- [ ] Central de atendimento: a escalada aparece como hoje (amarela).

### Testes e conferência (Fase 2)
- [ ] Unit: planos da IA, menu do robô, escalada de 5 min (cron).
- [ ] E2E com provedor simulado de WhatsApp (`WHATSAPP_PROVEDOR=simulado`, como `scripts/whatsapp/*`): robô → solicitação → aplicar; IA → proposta → aplicar; cancelar em recebido → automático; pedido em rota → aviso; 5 min → atendente.
- [ ] Teste real na Menuzia com o telefone do dono (robô e IA), antes de publicar.

## Fase 3 (depois, não neste plano)
- Pix da diferença (cobrança com valor próprio) para pedido pago online que aumentou.
- Bloco "PEDIDO ALTERADO" nativo na comanda (quando houver janela do Assistente).

## Publicação
- Só depois do APROVADO do redesign e do dono conferir as duas fases localmente. Migration 0200 antes do deploy (ensaio + backup de `pagamentos_online`). Todas as lojas de uma vez. Conferir pedidos chegando após o deploy.
