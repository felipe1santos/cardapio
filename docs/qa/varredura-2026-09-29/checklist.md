# Varredura 2026-09-29 — checklist de progresso

Branch: `fix/varredura-2026-09-29` (worktree `C:\projetos\cardapio-estab`, criada a partir da main `76147ee`).
Se a sessão cair: retomar pelo primeiro item sem `[x]`.

Legenda: `[x]` feito · `[~]` parcial (ver relatório) · `[-]` não testável (motivo no relatório §6)

## 0. Preparação
- [x] Branch criada a partir da main
- [x] Inventário de telas, APIs, crons e webhooks (abaixo)

## 1. Verificações gerais
- [x] `tsc --noEmit`
- [x] `next lint`
- [x] Testes unitários (`vitest run`)
- [x] `npm audit` (raiz e printer-agent)
- [x] `next build` (avisos)
- [x] Suítes e2e locais (uma por vez) — ver §3

## 2. Disparos (prioridade máxima)
- [x] Leitura completa do código (criação, público, fila, cron, retries, métricas, link, webhook de status)
- [x] Variáveis no texto ({nome}, {link}, ausente, acento/emoji, longo)
- [x] Público: contagem prevista x enviada, sem telefone, inválido, duplicado, formatos
- [x] Opt-out / bloqueio
- [x] Agendamento: fuso, data passada, editar/cancelar agendada, WhatsApp desconectado
- [x] Fila: intervalo, pausa/retomada, reinício no meio, idempotência, dois crons, retry, timeout
- [x] Status/relatório: contadores
- [x] Histórico na central de atendimento marcado como disparo
- [x] Isolamento entre lojas (instância e clientes)
- [x] Resposta do cliente ao disparo (robô / atendente)
- [x] Avisos transacionais durante disparo grande
- [x] e2e local `e2e-campanhas-metricas.mjs` (provedor simulado)
- [-] Teste real ponta a ponta só para 5527992534407 — NÃO feito: instância da Menuzia (final 9932) desconectada (relatório §6)

## 3. Demais áreas
- [x] 1. Pedidos (criação, Kanban, cancelamento, edição, impressão simulada, WhatsApp de status)
- [x] 2. Cardápio público / checkout
- [x] 3. PDV / mesas / comandas / pré-conta / fechamento
- [x] 4. Central de atendimento e robô
- [x] 5. Integrações (pixels, WhatsApp, Nexta) e Impressão
- [x] 6. Fidelidade / cupons
- [x] 7. Produtos, categorias, horários, áreas de entrega
- [x] 8. Relatórios / dashboard / clientes
- [x] 9. Usuários, permissões, login/logout, recuperação de senha
- [x] 10. Configurações da loja + aviso da nova impressão
- [x] 11. Crons e webhooks
- [x] Isolamento entre lojas (todas as APIs)
- [x] Navegação em produção — somente loja Menuzia (desktop + celular)

## Inventário

### Telas (27)
- [x] `/login` · `/cadastro` · `/recuperar-senha` · `/redefinir-senha`
- [x] `/admin` · `/admin/dashboard` · `/admin/pedidos` · `/admin/logistica`
- [x] `/admin/cardapio` · `/admin/clientes` · `/admin/campanhas` · `/admin/fidelidade`
- [x] `/admin/pdv` · `/admin/mesas` · `/admin/mesas/[id]`
- [x] `/admin/integracoes` · `/admin/integracoes/nexta` · `/admin/impressao`
- [x] `/admin/equipe` · `/admin/auditoria` · `/admin/ajustes`
- [x] `/loja/[slug]` · `/mesa/[token]` · `/cozinha/[token]` · `/entregador/[token]`
- [x] `/superadmin` · `/` (raiz)

### APIs (102 rotas) — agrupadas
- [x] admin/campanhas (4) · cron/campanhas · `/c/[token]`
- [x] admin/whatsapp (12) · whatsapp/webhook · cron/whatsapp
- [x] admin/pedidos (2) · pedidos/[id]/notificar · loja/[slug]/pedido (2)
- [x] loja/[slug] conta (4), cupom, eventos, fidelidade, frete · geo
- [x] admin/pdv (6) · admin/balcao · admin/comandas (2) · admin/mesas (9) · mesa/[token] (3) · modulos/mesas
- [x] admin/impressao (10) · agente (8)
- [x] admin/nexta (6) · nexta/webhook (2)
- [x] admin/fidelidade (4) · admin/cardapio/ordem
- [x] admin/equipe (3) · cadastro (2) · auth/redefinir
- [x] cozinha/[token] (4) · entregador/[token] (6)

### Crons
- [x] `POST /api/cron/campanhas` (Coolify, 1/min)
- [x] `POST /api/cron/whatsapp` (Coolify, 1/min — fila do robô e retenção)

### Webhooks
- [x] `/api/whatsapp/webhook/[segredo]` (Evolution: messages.upsert / messages.update)
- [x] `/api/nexta/webhook/[token]` e `[...evento]`

### Assistente de impressão
- [x] `printer-agent` (fila, reimpressão, envio direto) — sem tocar no layout do recibo

## Observações de cobertura
- Telas de produção: carregadas só na loja Menuzia, sem salvar nada (relatório §7). Mobile: coberto
  pelas e2e locais a 390 px (campanhas, mesas, PDV); não percorri todas as telas de produção no celular.
- Checkout da vitrine em produção: não finalizado (sem WhatsApp da loja → sem OTP; não criei pedido).
- Impressão física: não (regra 3); disparo/fila testados por código e suítes locais.
