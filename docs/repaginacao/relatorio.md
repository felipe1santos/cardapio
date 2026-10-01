# Repaginação — Equipe, Campanhas e Cadastro de produto (2026-10-01)

Branch `feat/repaginacao` (inclui as branches prontas e ainda não publicadas: `feat/push-notificacoes`,
`feat/dashboard-filtro`, `feat/pdv-janelas`). Prints em `docs/repaginacao/prints/fase1|fase2|fase3`.
Referências e o que se tirou de cada uma: `referencias.md`. Inventário do produto: `inventario-produto.md`.
Identidade: estrutura e comportamento das referências, cara da Menuzia (azul #0688D4, ícones lucide,
cantos de 4–8 px). Nenhum logo, nome, texto ou ícone de terceiros.

## Fase 1 — Equipe
- **Lista**: busca "Pesquisar pelo nome ou login do usuário", "+ Adicionar usuário", colunas Nome (negrito),
  Login, Cargo (selo colorido), Permissões (contagem; dono = "Acesso total"), Situação (Ativo/Pausado/Bloqueado),
  Último acesso; ações por ícone: editar, redefinir senha, pausar/bloquear (menu), excluir (confirmação; só
  desativa, some da lista e fica em "Ver excluídos" para reativar). Dono sem ações. Celular em cartões.
- **Modal de duas colunas**: Informações (Nome, Login, Senha no cadastro / "Redefinir senha" na edição,
  Telefone, Cargo) e Permissões ("N permissões concedidas", Copiar permissões de outro usuário, busca, cartões
  com toggle em 4 grupos — Operação, Cardápio e clientes, Gestão, Ações sensíveis —, marcar/desmarcar grupo),
  rodapé fixo Cancelar/Salvar. Trocar o cargo pergunta antes de substituir as permissões.
- **Regras**: o papel (que a RLS usa) é deduzido no SERVIDOR do cargo + áreas marcadas
  (`lib/equipe-cargos.ts › papelParaAcessos`); gerente não libera o que só dono/gerente usa. Login único,
  senha ≥ 8, ≥ 1 permissão (tela e servidor). Menu e URL/API continuam barrados pelo middleware
  ("Você não tem acesso a esta área").
- **Ação sensível nova "taxa"** (taxas da conta e taxa extra). A 0128 dá "taxa" a quem já podia aplicar
  taxa antes (gerente ou quem tem "desconto"), para ninguém perder o que fazia.
- "Acesso às lojas": não existe conta com várias lojas no sistema hoje — o campo não aparece.
- 0128: `usuarios.cargo` e `usuarios.situacao`; o corte de acesso continua em `desativado_em`.

## Fase 2 — Campanhas
- **Cabeçalho** "Campanhas via WhatsApp" (?) + Envio automático Ligado/Desligado + Boas práticas + Disparar
  mensagem. **Submenu vertical** (trilho no celular): Visão geral, Campanhas, Agendamentos, Mensagens
  automáticas, Notificações do app, Modelos de mensagem.
- **Visão geral**: período ‹ › + calendário; Receita gerada, Quantidade de pedidos, Contatos impactados,
  Pedidos de clientes recorrentes (< 30 dias), recuperados (≥ 30 dias), Envios com sucesso, Taxa de leitura,
  Taxa de cliques, Tempo médio para pedir — cada um com (?). Atribuição: mesmo telefone, pedido não cancelado
  até **72 h** depois do envio (`campanhas_visao_geral`, 0129). Leitura e clique aparecem "Indisponível"
  quando o WhatsApp não devolveu leitura / a campanha não tinha link — nenhum número inventado.
  Investimento não aparece (o sistema não registra custo por envio). Gráfico por dia e receita por campanha,
  tabela de envios com ordenação e paginação, vazio com ilustração própria. O relatório anterior (0104) segue
  em "Ver relatório detalhado".
- **Campanhas**: busca, filtro de status, paginação, selos coloridos, ações por ícone.
- **Agendamentos**: busca, "+ Filtro" (tipo e período), contadores clicáveis Ativas/Processadas/Canceladas,
  miniatura e prévia, criação, programada, enviada + resultado; editar, duplicar, ver destinatários, excluir;
  "Registros por página".
- **Mensagens automáticas**: liga/desliga geral e por tipo de pedido (Entrega/Retirada/Consumo no local),
  cartão por etapa (recebido, agendado, aceito/resumo, pronto retirada, pronto entrega, saiu, entregue) com
  toggle, Ativo/Inativo, variáveis destacadas, "Mensagem padrão", Editar com chips de variável e "Restaurar
  padrão". Sem configuração sai **exatamente** o texto de sempre (teste unitário compara com a função original).
- **Modelos de mensagem**: criar, validar variáveis, usar no disparo, "Salvar como modelo" a partir do disparo.
- confirm()/alert() do navegador trocados por janelas próprias.
- 0129: `restaurantes.mensagens_status`, `campanha_modelos`, `campanhas_visao_geral`, `campanhas_ultimo_envio`.

## Fase 3 — Cadastro de produto e hover
- **Modal com abas** Informações · Complementos · Disponibilidade · Etiquetas · Ficha de preparo · Custo; foto
  grande (Trocar/Remover) + até 4 extras; rótulos flutuantes; Categoria + Etiqueta (atalho para a aba);
  Destaque; Preço de venda + promocional com interruptor Promocional; "Personalizar dia/hora para promoção"
  (dias da semana, faixa de horário, datas); Preço de custo; Código PDV e interno; descrição com dica;
  Configurações avançadas (tipo do produto); rodapé fixo com Salvar só com alteração, girando ao salvar, e
  aviso "Sair sem salvar?" ao fechar com alteração. Produto novo salva e continua aberto.
- **Agenda da promoção** vale em TODOS os canais: aplicada no mapeamento do item (vitrine, PDV, garçom, QR) e
  no preço do servidor (`lib/promocao-agenda.ts`). Sem agenda = sempre (como antes). Em produção nenhum item
  tinha datas de promoção preenchidas (conferido só leitura), então nada muda sozinho.
- **Custo e códigos** numa tabela própria (`itens_cardapio_gestao`, RLS dono/gerente): o cardápio é lido por
  qualquer visitante, e o custo não pode vazar (teste confirma que o visitante não lê).
- **Hover**: categoria com fundo, barra, alça e ⋮ (menu com as ações); produto em tabela com destaque e ações;
  cartão com elevação, borda e ações; 150 ms; em tela de toque tudo sempre à vista. Detalhes em referencias.md.
- **Fotos extras**: ficam guardadas no produto; a vitrine ainda mostra só a foto principal (galeria fica para
  uma próxima etapa, se quiser).
- 0130: `imagens_extras`, `promocao_dias`, `promocao_hora_inicio/fim`, `itens_cardapio_gestao`; o gatilho
  "editar preços" passa a cobrir a agenda.

## Testes
| Suíte | Resultado |
|---|---|
| e2e-equipe-repaginada (novo) | 75/75 |
| e2e-campanhas-repaginada (novo, provedor simulado) | 71/71 |
| e2e-produto-repaginado (novo) | 65/65 |
| e2e-equipe-acessos (portado) | 27/27 |
| e2e-checkpoint-e | 90/90 |
| e2e-campanhas-metricas (portado) | 63/63 |
| e2e-campanha-botoes | 9/9 |
| e2e-push | 68/68 |
| e2e-cadastro-matriz (portado) | 45/45 |
| e2e-admin-etiquetas (portado) | 14/14 |
| e2e-vitrine-tags | 27/27 |
| e2e-pdv-janelas | 53/53 |
| unitários (vitest) | 1876 |
| tsc / eslint | limpos |

A rodada final de regressão foi interrompida pelo sistema (memória do computador baixa) depois de
vitrine-tags e pdv-janelas: pdv-v2 e garçom não chegaram a rodar com o código final.

**Ambiente local**: o Storage local está com o esquema adiantado em relação ao contêiner (qualquer upload,
até com service_role, responde `42P10`; já acontecia antes desta tarefa). Nos e2e de produto e da matriz de
cadastro o envio do arquivo é simulado (`page.route`); a tela e a gravação no banco são as de verdade.
O upload real precisa ser conferido em produção.

## Publicação (pendente — janela 00:00–10:00)
Ordem obrigatória (o código novo lê colunas novas: sem as migrations, a vitrine e a Equipe quebram):
1. Backup (`scripts/seguranca/aplicar-migration-producao.mjs` faz antes de cada uma).
2. Aplicar **0127, 0128, 0129, 0130** em produção, nessa ordem.
3. Juntar `feat/repaginacao` na `main`, push, Redeploy no Coolify, conferir pelo bundle.
4. Conferência na Menuzia (admin/admin, logado pelo dono): Equipe (criar/pausar/excluir usuário TESTE),
   Campanhas (Visão geral, Mensagens automáticas sem mexer no envio), Cardápio (abrir e cancelar um produto,
   hover). Push: VAPID no Coolify e `push_liberado=true` só na Menuzia.
5. Rollback: `docs/rollback/0130…0127*.down.sql` (na ordem inversa) + Redeploy do commit anterior.
