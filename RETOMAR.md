# 🔴 RETOMAR — o que fazer quando voltar

> Última sessão: **2026-09-03**. Tudo commitado e no GitHub (`main`, commit `4ca2226`).
> Migration **0049 já aplicada** no Supabase remoto.
> Redeploy no Coolify: **disparado pelo Felipe no fim da sessão** — confirmar que subiu.

---

## O que foi essa sessão

Teste de ponta a ponta do pedido → 12 bugs achados → 4 entregas (D, C, B, A do plano).
Detalhe completo no commit `4ca2226`.

---

## ✅ Concluído (código no `main`)

### D — Fechar pedido sem Logística
- [x] Migration 0049: `restaurantes.usa_logistica` / `aceita_entrega` / `aceita_retirada`
- [x] Ajustes › Entrega ganha o card **"Como a loja atende"** (3 toggles)
- [x] Logística OFF: Kanban fecha a entrega sozinho (`pronto` → `em_rota` → `entregue`)
      e o item Logística some do menu lateral
- [x] Logística ON: drawer de detalhes ganha **"Concluir sem entregador"**
- [x] `proximoStatusKanban` extraído pra `lib/queries/pedidos.ts` + 9 testes
      (`lib/queries/pedidos-fluxo.test.ts`)

### C — Retirada na vitrine
- [x] `submitOrder` deixa de mandar `tipo: 'entrega'` fixo
- [x] Seletor "Como você quer receber?" (só aparece com os dois canais ligados)
- [x] Retirada pula endereço, zera frete e mostra o endereço da loja
- [x] `criarPedido` valida o canal server-side (aba velha / POST direto não fura)

### B — Endereço e frete
- [x] Cidade passa a morar dentro de `endereco`, pré-preenchida com a da loja
      (migration: `clientes.endereco_cidade`, `pedidos.endereco_cidade`)
- [x] Ponto de referência (opcional), exibido na Logística e no drawer do Kanban
- [x] Linha da taxa nunca mais mostra "R$ 0,00" falso: "A calcular" / "Calculando…" /
      "Fora da área" / "Confirmaremos com você"
- [x] Total só soma a taxa quando ela é um valor confirmado
- [x] Falha de rede no `/frete` deixou de ser silenciosa
- [x] Bairro duplicado (ignorando acento/caixa) bloqueado em Ajustes
- [x] Header do dropdown de bairro muda conforme lista fechada × raio
- [x] Endereço público da loja mostra o domínio real (era `cardapio.app`)
- [x] `<html lang="pt-BR">`

### A — Navegação mobile da vitrine
- [x] `overscroll-behavior-y: contain` → mata o pull-to-refresh
- [x] Sacola persistida no aparelho (`menuzia_carrinho_${slug}`, validade 24h)
- [x] Botão voltar fecha uma camada por vez; na raiz pede confirmação
- [x] "Sair mesmo assim" com `history.go(-2)`

---

## ⬜ O QUE FAZER QUANDO VOLTAR (na ordem)

### 1. Confirmar que o deploy subiu
Abrir `https://app.menuzia.com.br/admin/ajustes` › aba **Entrega**.
Se o card **"Como a loja atende"** estiver lá, o deploy pegou.

### 2. ⬜ Testar retirada ponta a ponta
1. Ajustes › Entrega → ligar **"Aceitar pedidos para retirada"**.
2. Na vitrine, o seletor "Como você quer receber?" deve aparecer no carrinho.
3. Escolher Retirada → checkout pula o endereço, mostra o endereço da loja, taxa "Sem taxa".
4. Finalizar → o pedido tem que chegar no Kanban como **Retirada**.

### 3. ⬜ Testar o Kanban sem Logística
1. Ajustes › Entrega → desligar **"Usar o módulo de Logística"**.
2. Item **Logística** tem que sumir do menu lateral.
3. Pedido de entrega em "Pronto" mostra **Saiu p/ entrega** + botão **✓** (entregue direto).
4. Depois de "Saiu p/ entrega", o card aparece na 4ª coluna com botão **Entregue**.
5. Religar o toggle e conferir que volta ao comportamento antigo ("Na logística").

### 4. ⬜ Testar o checkout de entrega com login
Precisa de OTP por WhatsApp — por isso não deu pra validar na sessão passada.
1. Conferir os campos novos **Cidade** (já preenchida com a da loja) e
   **Ponto de referência** no passo de endereço.
2. Finalizar e conferir no Kanban/Logística que a referência aparece.

### 5. ⬜ Testar no celular de verdade
- Puxar a tela pra baixo no cardápio: **não pode recarregar**.
- Abrir um produto e apertar voltar: fecha só a sheet.
- Apertar voltar no cardápio: aparece **"Sair do cardápio?"**.
- Adicionar item, recarregar a aba: a sacola tem que continuar lá.

---

## ⚠️ Coisas pra lembrar

- **Chrome pula entradas de histórico criadas antes da primeira interação**
  (*history manipulation intervention*). Por isso a sentinela do botão voltar só
  é plantada no primeiro `pointerdown`/`keydown`. Se alguém "otimizar" isso pra
  rodar na montagem, o voltar volta a sair do site.
- Defaults da migration 0049 preservam o comportamento antigo de propósito:
  `aceita_retirada = false` (a vitrine nunca vendeu retirada) e `usa_logistica = true`.
- `app/page.test.tsx` falha desde antes desta sessão (`NEXT_REDIRECT`). Não é regressão.
- Extensão do Chrome não executa JS em `localhost` (só screenshot/clique), e o
  checkout local exige sessão de cliente — daí os itens 2–4 acima terem ficado
  pro ambiente real.
