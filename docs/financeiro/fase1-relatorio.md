# Financeiro — Fase 1 (Base): relatório

Data: 2026-10-01 · Branch `feat/financeiro` · Migration **0132** (só no banco local até a sua autorização).

## O que entrou

Tudo atrás da flag `restaurantes.financeiro_ativo` (padrão **desligada**). Com a flag desligada a loja funciona
exatamente como antes: sem menu, sem PIN, sem trava, sem registro de sessão e sem ban ao bloquear. As correções de segurança R1, R2, R3 e R13 valem para todas as lojas, porque só fecham
portas que o painel não usa mais. R9 também é por banco, mas só age com a flag.

| Item | Como ficou |
|---|---|
| Flag por loja | `financeiro_ativo`; menu, telas, PIN, trava e alertas só existem com ela ligada. A API devolve 404 sem a flag. |
| Ledger imutável | `fin_lancamentos` em centavos (bigint). Cada linha tem hash encadeado por loja (`sha256(anterior + conteúdo)`). UPDATE, DELETE e TRUNCATE são recusados até para o service_role. A chave de idempotência impede lançamento duplicado. |
| Auditoria imutável | `eventos_auditoria` ganhou hash encadeado (com retrocálculo do histórico) e trava de alteração e exclusão. Verificador `auditoria_verificar_cadeia` e botão "Verificar integridade" na tela. |
| Aprovação por PIN | `fin_aprovacoes` (imutável). O banco recusa aprovador igual ao solicitante. `lib/financeiro/aprovacao.ts` confere a loja, a permissão `aprovar`, o PIN e o bloqueio (a Fase 2 liga isso às ações de caixa). |
| PIN pessoal | 6 dígitos, guardado em bcrypt. Criar exige a senha. PIN fraco (sequência ou repetido) é recusado. 5 erros bloqueiam por 15 min e geram alerta. O gestor só **apaga** o PIN (Equipe), nunca vê nem define. |
| Tela travada | Por inatividade (5 min, configurável) ou pelo menu "Bloquear tela". **A sessão continua**: Kanban, tempo real e impressão não param. O servidor marca a sessão do terminal como travada e recusa ações de dinheiro (423) até destravar com o PIN. Telas de operação contínua (Pedidos, Logística, PDV, Mesas, Cozinha) não travam sozinhas. Só trava sozinho quem já tem PIN. |
| Troca rápida de operador | "Trocar operador" mostra quem da loja tem PIN. Funciona só em aparelho já aberto com senha por alguém da loja nos últimos 30 dias. A sessão anterior fica encerrada como `troca_operador`. |
| Sessões | `usuarios_sessoes` guarda IP, aparelho e terminal (cookie httpOnly). O painel avisa a cada 4 min que segue aberto. O mesmo login em dois aparelhos gera alerta ao dono. |
| Bloquear derruba | Pausar, bloquear ou excluir na Equipe derruba o login **na hora**: ban no Auth, sessões encerradas e o terminal aberto recebe 401. Reativar devolve o acesso. O ban só acontece com a flag ligada. |
| Alertas | `fin_alertas` no painel (Financeiro › Auditoria e Alertas, com "Marcar lido" e o nome de quem leu). Os **graves** também vão pelo WhatsApp da própria loja para o número do dono (`fin_config.alerta_whatsapp`). |
| Permissões | Área "Financeiro" e 14 ações sensíveis novas, com o grupo "Financeiro" na Equipe (aparece só com a flag). Toda rota confere a permissão no servidor (`contextoFinanceiro`). |
| Correções | **R1** acertos de entregador sem escrita pelo navegador. **R2** entregador não se apaga pelo navegador, e o acerto fica RESTRICT. **R3** pedido entregue ou cancelado não troca de entregador pelo navegador, e toda troca vai para a auditoria. **R9** ninguém aprova o próprio cancelamento (gatilho no banco, cobre as duas rotas). **R13** `cupom_usos` sem escrita pelo navegador. **R16** com a flag, login, falha de login, PIN, trava e troca de operador vão para a auditoria. Sem a flag, o login só ganha o cookie do terminal. |
| Auditoria (tela) | Rótulos novos para as ações `sessao.*`, `fin.*` e `pedido.trocou_entregador`, e grupos "Acessos" e "Financeiro" no filtro. |

**Ficou para as próximas fases, como no plano:**
- Revogar o link do motoboy ao bloquear: entra na Fase 3, junto do login do motoboy.
- Auditar as ações de dinheiro dentro da mesma transação (a outra metade do R8): entra na Fase 2, nas RPCs de caixa.

As seções Caixa, Fluxo, Motoboys, Movimentações, CMV, Contas/DRE e Dashboard aparecem como "Em construção — Fase N".

## Testes

- Unitários: **1.910** ok, sem nenhuma falha. Inclui os novos testes de centavos, permissões, trava, menu e indicador.
- `tsc` e `eslint` limpos. `next build` ok.
- SQL da 0132: imutabilidade, idempotência, autoaprovação, cadeia adulterada acusada e PIN. Rollback e reaplicação testados.
- **E2E `e2e-financeiro-fase1.mjs`: 66/66**, com navegador real, em desktop e celular.
- Regressão: ver a tabela ao final.

### Tentativas de fraude (todas precisam FALHAR)

| # | Tentativa | Resultado |
|---|---|---|
| 1 | Garçom chama a API da auditoria | 403 |
| 2 | Atendente (caixa) lê auditoria e alertas | 403 |
| 3 | Criar PIN sem saber a senha | 403 |
| 4 | PIN fraco (123456) ou com 4 dígitos | 400 |
| 5 | Tirar a sobreposição da tela travada pelo DevTools e chamar a API | 423 (o servidor sabe que está travada) |
| 6 | Recarregar a página para destravar | continua travada |
| 7 | PIN errado na tela travada | recusado |
| 8 | Trocar para funcionário de **outra loja** pelo PIN | 404 |
| 9 | Usar PIN num aparelho que ninguém da loja abriu com senha | 403 |
| 10 | Chutar PIN (5 tentativas) e depois usar o certo | bloqueado 15 min (423) + alerta ao dono |
| 11 | Gerente apagar o PIN do dono | recusado |
| 12 | Funcionário bloqueado continua no terminal aberto | 401 na hora; sessões encerradas |
| 13 | Funcionário bloqueado entra com a senha | recusado (ban no Auth) |
| 14 | service_role altera ou apaga lançamento do caixa | recusado pelo banco |
| 15 | Usuário logado insere lançamento direto no banco | recusado |
| 16 | service_role altera ou apaga a auditoria | recusado pelo banco |
| 17 | Aprovar a própria ação | recusado pelo banco |
| 18 | Adulterar um lançamento direto no banco (superusuário) | "Verificar integridade" acusa o registro |
| 19 | Aprovar o próprio pedido de cancelamento | recusado pelo banco (`autoaprovacao`) |
| 20 | Ver ou marcar como lido o alerta de outra loja | não aparece; 404 |
| 21 | Mesmo login em dois aparelhos | alerta "login simultâneo" ao dono |
| 22 | Errar a senha no login | fica na auditoria |

### Regressão (build da Fase 1, banco com a 0132)

| Suíte | Resultado |
|---|---|
| PDV v2 | 70/70 |
| Balcão e entrega (delivery) | 84/84 |
| Garçom (mesas) | 47/47 |
| Caixa: turnos / regras | 18/18 · 34/34 |
| Pedido idempotente | 12/12 |
| Impressão v2 | 40/40 |
| Cozinha | 26/26 |
| Robô WhatsApp | 106/106 |
| Campanhas | 71/71 |
| Vitrine: checkout em larguras | 72/72 |
| Equipe repaginada / acessos | 75/75 · 27/27 |
| Menu lateral / limite de login | 16/16 · 3/3 |
| Release Mesas | 250/254 — **as mesmas 4 falham sem a Fase 1** (vitrine da loja de teste e eventos antigos de "senha" do balcão; ambiente) |
| Regressão release | trava no popup de fidelidade da vitrine — **igual sem a Fase 1** (ambiente) |
| Cardápio ordem/QR | não roda: o Storage local recusa a imagem de semente (`42P10`), antes de qualquer verificação (ambiente) |

Uma rodada anterior da Equipe falhou com a máquina sem memória: o salvar passou do tempo limite. Com memória livre
passou 75/75, tanto sozinha quanto logo depois da suíte do financeiro.

Rollback da 0132 seguido de reaplicação: ok. Depois disso, o e2e antifraude passou de novo (66/66) e o teste SQL também.

## Prints

Estão em `docs/financeiro/prints-fase1/`: `01-meu-pin`, `02-tela-travada`, `03-trocar-operador`, `04-financeiro-auditoria`,
`05-financeiro-celular`.

## Para publicar (precisa da sua autorização)

1. Backup e aplicação da **0132** em produção com `aplicar-migration-producao.mjs`. É uma migration só: a 0133 do plano
   foi juntada nela. Rollback em `docs/rollback/0132_financeiro_base.down.sql`.
2. Merge de `feat/financeiro` na main e Redeploy no Coolify.
3. Ligar a flag **só na Menuzia**: `update restaurantes set financeiro_ativo = true where slug = 'menuzia'`. Depois, criar
   o seu PIN em Minha conta › Criar meu PIN e conferir a tela Financeiro › Auditoria e Alertas.
4. Nenhuma outra loja muda. A única diferença nelas é que R1, R2, R3 e R13 fecham escritas que o painel já não fazia.
