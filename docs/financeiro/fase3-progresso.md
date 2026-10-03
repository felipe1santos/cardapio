# Financeiro — Fase 3 (Motoboy): progresso

## 2026-10-03 ~01:00 — desenho (a partir do levantamento do código)

**O que existe hoje**
- Link/QR do motoboy (`/entregador/[token]`):
  - o token é permanente: não expira e não dá para revogar;
  - não tem login;
  - "Não entreguei" cancela o pedido;
  - "Entregue" não registra pagamento;
  - a tela atualiza a cada 10 s;
  - já é instalável como app (service worker `sw-entregador.js`).
- O papel `entregador` existe, mas não tem permissão nenhuma, e o login dele cai em `/login`.
- O despacho da Logística grava direto do navegador (`entregador_id` + `em_rota`).
- Nexta e "entrega sem entregador" não registram pagamento.

**Desenho**

1. **Login do motoboy.** Na Logística, o cartão do entregador ganha "Login do app": cria (ou vincula) um usuário com papel
   `entregador`, ligado ao cadastro em `entregadores.usuario_id`.
   - Esse usuário entra pelo login principal e cai em `/motoboy` (app de celular, instalável).
   - Não tem acesso ao painel; no Equipe aparece como cargo "Motoboy".
   - Bloquear ou pausar na Equipe derruba o login e **troca o token** do link antigo.
2. **Link revogável** (todas as lojas):
   - "Gerar novo link" e "Desativar entregador" (`entregadores.desativado_em`).
   - Link antigo ou entregador desativado: o portal responde "link inválido".
3. **Pagamento na entrega** (só com o financeiro).
   - Ao marcar "Entregue", o motoboy informa:
     - dinheiro: o recebido, e o servidor calcula o troco dado;
     - cartão: o NSU;
     - Pix: fica **a conferir**;
     - não pago: motivo obrigatório.
   - A RPC `entrega_registrar` grava `fin_entregas_pagamento` (imutável), o livro-caixa e o status, na mesma transação e
     de forma idempotente.
   - O motoboy não confirma Pix e não muda valor.
4. **Troco** (`fin_config.troco_modo`):
   - **por pedido** (padrão): no despacho, "troco entregue" pré-preenchido e editável; sai da gaveta para "com o motoboy";
   - **fundo fixo:** "Entregar fundo" e "Complementar troco".
   - A troca de modo vale no próximo caixa, ou já, se nenhum motoboy tiver dinheiro.
5. **Dinheiro com o motoboy** = saldo da carteira `motoboy` dele no livro-caixa: troco recebido + dinheiro dos clientes −
   troco dado − o que devolveu. Aparece na Logística (card por motoboy) e no app.
6. **Acerto às cegas** (Financeiro › Acerto de Motoboys):
   - Esperado = saldo da carteira do motoboy (por pedido ou tudo).
   - O operador conta antes de ver o esperado.
   - Diferença vira **pendência do motoboy**, com alerta ao dono. Ela é quitada por novo acerto, ou baixada pelo dono com
     motivo.
   - O acerto entra no turno de quem acertou, com caixa aberto obrigatório.
   - Motoboy com saldo aparece nas pendências do fechamento.
7. **Conferir Pix:** quem tem a permissão confirma ("caiu", vai para a conta da empresa e o pedido fica pago) ou marca
   "não caiu" (vai para a receber).
8. **Entrega sem motoboy e Nexta:** a entrega é registrada na mesma tela de acerto.
   - Sem motoboy, o dinheiro vai para a gaveta.
   - Nexta fica "a receber da Nexta" até o repasse.
9. **Lojas sem financeiro:** tudo como hoje. Só ganham o link revogável e o login do motoboy é opcional.

## 2026-10-03 ~01:30 — implementado e testado localmente

- Migration `0136_financeiro_motoboy.sql` + rollback `docs/rollback/0136_financeiro_motoboy.down.sql` (desfazer e
  reaplicar testados no banco local).
- Serviço único do motoboy (`lib/motoboy/servico.ts`) usado pelo link/QR e pelo app com login (`/motoboy`).
- Logística: "Dinheiro com cada motoboy agora", "Troco para levar" (por pedido / fundo), segurança do acesso
  (link novo, desativar, login do app); o acerto antigo da gaveta aponta para o Financeiro quando o módulo está ligado.
- Financeiro: Acerto de Motoboys (cego), Conferir Pix, entregas sem registro, Nexta a receber + repasse.
- Suíte `scripts/seguranca/e2e-financeiro-fase3.mjs`: 99/99. Suítes integrada e PDV-pagamento migradas para o acerto
  novo (52/52 e 57/57). Vitest 1930 ok.
- Relatório: `fase3-relatorio.md`.
