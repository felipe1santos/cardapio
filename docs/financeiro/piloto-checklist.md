# Piloto do Financeiro nas lojas reais — checklist

Criado em 2026-10-04. Hoje o financeiro está ligado **só na Menuzia** (loja de teste). Nada deste
checklist liga o financeiro em loja real: cada passo com 🔒 só com a autorização explícita do dono.

## Obrigatório antes de ligar o financeiro em qualquer loja piloto

- [ ] 🔒 **Item 3: aprovação pelo celular em produção (feito pelo dono).** Na Menuzia, com o
  "Gerente TESTE" (login `gerente`) e o "Caixa TESTE" (login `caixa`), o dono faz o fluxo inteiro de
  pedir e aprovar pelo celular (sangria, despesa, estorno, reabrir caixa) e confere:
  - a aprovação chega ao celular do gerente e só vale com o PIN dele;
  - cada passo aparece na auditoria (`eventos_auditoria`) com quem pediu e quem aprovou;
  - o livro-caixa (`fin_lancamentos`) recebe só o que foi aprovado, no turno certo;
  - recusar ou deixar expirar não gera lançamento.
  Adiado em 2026-10-04 por decisão do dono ("vou fazer eu mesmo antes de ligar o financeiro nas
  lojas piloto"). Os dois usuários de teste ficam **pausados** (não apagados) até lá; o dono os
  reativa na tela de Equipe na hora do teste.
  Ponto de partida lido em 2026-10-04 20h35 (Menuzia): 474 eventos de auditoria, 23 lançamentos,
  0 aprovações. Os dois usuários estavam sem PIN; ele é definido no primeiro acesso.

## Antes de ligar (pendências conhecidas)

- [ ] Migration 0141 (restrições do postgres): **não aplicar** sem a ordem do dono.
- [ ] Volume `/app/dados/ancoras` e os 3 agendamentos (crons) no Coolify, a cargo do dono (item 5).
- [ ] Integrações e Ajustes não aparecem no menu do Gerente, embora estejam nas áreas liberadas no
  cadastro dele (visto em 2026-10-04). Confirmar se é regra do papel ou um filtro errado.
