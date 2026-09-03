# 🔴 RETOMAR — o que fazer quando voltar

> Última sessão: **2026-09-03 (noite)**. Tudo commitado e no GitHub (`main`).
> Migration **0049 aplicada**. Deploy do commit `2b11a70` **no ar** (Coolify, 03/09 noite).

---

## O que foi essa sessão

Deploy que o Felipe achou ter disparado **não tinha subido** (último build era `5da3a66`,
de 01/09). Disparei o Redeploy no Coolify e validei em produção os itens 1 a 4 da lista
anterior. Só o teste no celular ficou de fora.

---

## ✅ Validado em produção (loja MENUZIA)

### 1. Deploy
- [x] Card **"Como a loja atende"** aparece em Ajustes › Entrega (3 toggles).

### 2. Retirada ponta a ponta
- [x] Toggle "Aceitar pedidos para retirada" ligado.
- [x] Vitrine mostra "Como você quer receber?" com Entrega/Retirada.
- [x] Retirada: taxa vira **"Retirada no balcão · Sem taxa"**, total sem frete,
      checkout **pula o endereço** e mostra o endereço da loja.
- [x] Pedido **#96** chegou no Kanban como **RETIRADA** e fechou com **ENTREGUE**
      direto na coluna "Pronto p/ Despacho".

### 3. Kanban sem Logística
- [x] Toggle "Usar o módulo de Logística" desligado → item **Logística some** do menu.
- [x] Entrega em "Pronto" mostra **SAIU P/ ENTREGA** + botão **✓**.
- [x] Depois de "Saiu p/ entrega", o pedido (#94) vai pra 4ª coluna
      ("Entregas & concluídos" › EM TRÂNSITO) com botão **ENTREGUE**, e concluiu.
- [x] Religando o toggle, Logística volta ao menu e o botão volta a **NA LOGÍSTICA**.

### 4. Checkout de entrega
- [x] Campo **Cidade** e **Ponto de referência** presentes no passo de endereço.
- [x] Dinheiro → campo **"Troco para quanto?"**; revisão mostra "Troco para R$ 50,00".
- [x] Pedido **#97** no Kanban com cidade (Vila Velha), **Referência** e **Troco**.
- [x] Na **Logística**, o card do #97 traz a referência e o badge
      **TROCO PARA R$ 50,00**.
- [x] Drawer do Kanban com Logística ligada fecha o pedido por
      **"Concluir sem entregador"**.

---

## 🎨 Sessão de design da vitrine (03/09, noite — commit `2b11a70`, deploy feito)

Referência olhada: cardápio do CardápioWeb (telefabrica_dpizza).

- [x] Cabeçalho da loja no celular: barra com a altura da logo (76px), nome numa
      linha, pílulas de status/horário/tempo/nota rolando na horizontal, endereço
      truncado. Some o vão vertical do print.
- [x] Azul petróleo no horário de funcionamento e cor da loja no tempo de entrega.
- [x] Verde de promoção mais fechado (#15803D) no preço com desconto, na pílula
      de -%, no chip "Promoções" e nos preços dos complementos.
- [x] Etiqueta "Obrigatório" em vermelho de verdade (#DC2626).
- [x] Ficha do produto: cabeçalho de grupo em faixa cinza com regra + contador,
      miniatura do complemento de 36px para 56px, nome e preço maiores.
- [x] Login: telefone com máscara, teclado numérico, Enter, e o último número
      fica salvo no aparelho (volta preenchido). O código do WhatsApp continua —
      é o que impede alguém de entrar com o telefone de outro cliente.
- [x] Branco no rodapé ao rolar: o html ganhou cor de fundo e as barras fixas
      deixaram de ser promovidas a camada própria (transform-gpu/will-change).
- [x] horarioFechamentoAtual() novo em lib/timezone.ts (pílula "Até 23:00").

## 🚨 Checklist de configuração no painel (03/09, madrugada — commits `58184dd` e `9a35061`)

O painel agora avalia a configuração da loja a cada troca de rota e avisa o dono
quando falta algo que atrapalha o pedido do cliente.

- Regra pura em `lib/setup-checklist.ts` (20 testes), leitura em `lib/queries/setup.ts`.
- **Críticas**: sem canal de venda, loja travada fechada, cardápio sem item,
  sem categoria, item simples com preço zerado, item sem dia da semana marcado,
  telefone vazio, endereço da loja incompleto (com entrega ligada).
- **Atenção**: sem taxa de entrega, sem grade de horário, sem entregador,
  sem logo, sem capa, itens sem foto.
- Crítica abre modal piscando; "OK, entendi" guarda a assinatura do conjunto e
  deixa só o marcador vermelho no item do menu. Pendência nova reabre o modal.
- Atalho "N pendências" no rodapé da sidebar reabre a lista.
- No Kanban e no PDV o modal não abre (não interrompe quem atende).
- Validado em produção na loja MENUZIA: acusou endereço incompleto (crítico),
  horário não configurado e 2 itens sem foto.

## ⬜ O QUE FALTA

### 1. ⬜ Testar no celular de verdade (só o Felipe consegue)
- Conferir o cabeçalho da loja, as pílulas e a ficha de produto redesenhados.
- Rolar a lista até o fim: **não pode aparecer faixa branca** embaixo dos botões.
- Puxar a tela pra baixo no cardápio: **não pode recarregar**.
- Abrir um produto e apertar voltar: fecha só a sheet.
- Apertar voltar no cardápio: aparece **"Sair do cardápio?"**.
- Adicionar item, recarregar a aba: a sacola tem que continuar lá.

### 2. ⬜ Resolver as pendências que o próprio painel está acusando
Endereço da loja incompleto e grade de horário em branco (Ajustes), 2 itens sem foto.

### 3. ⬜ Decidir os toggles da loja MENUZIA
Ficaram assim depois dos testes: **entrega ON, retirada ON, logística ON**.
O original era retirada **OFF** — desligar se a loja não faz retirada de verdade.

---

## ⚠️ Achados desta sessão

- **A loja MENUZIA está sem endereço estruturado**: em Ajustes › Perfil da loja,
  Rua/Número/Bairro/Cidade/UF estão vazios (só o CEP está preenchido). Por isso a
  **Cidade não veio pré-preenchida** no checkout — o código está certo
  (`comCidadePadrao` usa `restaurante.cidade`), falta o cadastro. Isso também
  atrapalha o geocode do frete por raio. **Preencher o endereço da loja.**
- A **4ª coluna do Kanban** só abre sozinha com Logística desligada se o navegador
  ainda não tiver a chave `menuzia:kanban-col4`. Quem já clicou no botão ENTREGAS
  alguma vez mantém a escolha antiga — não é bug, é o comportamento desejado.
- **Deploy no Coolify não é automático**: o repo não tem webhook. Depois de dar push,
  alguém precisa clicar em **Redeploy** (leva ~7 min).
- `app/page.test.tsx` continua falhando (`NEXT_REDIRECT`), como antes. Os outros
  215 testes passam.
