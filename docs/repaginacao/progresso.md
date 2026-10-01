# Repaginação — progresso

Branch `feat/repaginacao` (sobre main + pdv-janelas + dashboard-filtro + push). Item só é marcado depois de testado.

## Preparação
- [x] Branches pendentes juntadas (tsc limpo, unitários 1853)
- [x] Referências: produtos (hover + modal) observados; Usuários não (extensão sem acesso) — ver referencias.md
- [x] Prints copiados para docs/referencias/repaginacao

## Fase 1 — Equipe
- [x] Migration 0128 (cargo, situação; sensível "taxa" dada a quem já podia: gerente ou com "desconto") — aplicada no local
- [x] Regras puras (lib/equipe-cargos.ts: cargos, papel deduzido, contagem, grupos) + 10 unitários
- [x] API (cargo, telefone, situação pausar/bloquear/excluir, papel deduzido no servidor, ≥ 1 permissão)
- [x] Lista nova (busca, colunas, ações por ícone, dono "Acesso total", ver excluídos)
- [x] Modal de duas colunas (cargo → modelo com confirmação, copiar, busca, marcar grupo, rodapé fixo)
- [x] E2E e2e-equipe-repaginada 75/75 (um por cargo, editar, copiar, pausar, bloquear, excluir, menu/URL/API, taxa)
- [x] Desktop 1366 / tablet 820 / celular 390 (prints em prints/fase1)
- [x] Regressão: e2e-equipe-acessos 27/27 (portado para o modal), checkpoint-e 90/90, unitários 1863

## Fase 2 — Campanhas
- [x] Migration 0129: restaurantes.mensagens_status (nulo = padrão), campanha_modelos (RLS gestor), campanhas_visao_geral (72 h), campanhas_ultimo_envio — aplicada no local
- [x] Cabeçalho "Campanhas via WhatsApp" + (?), Boas práticas, Disparar mensagem, envio automático Ligado/Desligado
- [x] Submenu vertical (trilho rolável no celular): Visão geral, Campanhas, Agendamentos, Mensagens automáticas, Notificações do app, Modelos
- [x] Visão geral: período ‹ › + calendário, 9 métricas com (?), leitura/clique "Indisponível" sem dado, gráficos, tabela com ordem e paginação, vazio com ilustração própria; relatório detalhado (0104) mantido
- [x] Campanhas: busca, filtro de status, paginação, selos
- [x] Agendamentos: busca, + Filtro, contadores clicáveis, miniatura e prévia, enviada + resultado, editar/duplicar/destinatários/excluir, registros por página
- [x] Mensagens automáticas: geral + tipos de pedido, cartão por etapa, variáveis destacadas, editor com Restaurar padrão; padrão idêntico ao que já saía (unitário compara com montarMensagemStatus)
- [x] Modelos de mensagem: criar, validar variáveis, usar, salvar do disparo, excluir
- [x] confirm()/alert() trocados por janela própria
- [x] E2E e2e-campanhas-repaginada 71/71 (provedor simulado, telefones fictícios); regressão métricas 63/63, botões 9/9, push 68/68, unitários 1870

## Fase 3 — Cardápio
- [ ] (a detalhar ao iniciar)
