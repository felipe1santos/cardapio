# 🔴 RETOMAR — o que fazer quando voltar

> Última sessão: 2026-06-28. Todo o código está commitado e no GitHub (`main`).
> O computador foi desligado — **o loop em background que publicava o release morreu**, ignore ele.

---

## ✅ O que JÁ está pronto (no `main`, último commit `d88227e`)
Nada disso está em produção ainda — **falta deploy**. Já feito no código:
- PDV: pagamento (modal mais largo, ícones coloridos, troco), painel de mesas, fechar conta, sair do PDV, tela cheia.
- Cozinha produção: grade de quadrados + modal "quer preparar?".
- Mapa de rotas: zoom no scroll + re-centraliza.
- Vitrine: etiquetas de item, preço fonte fina, destaque compacto, **cabeçalho em barra única**, removido "calcular frete", modal de detalhes do pedido (timeline verde), conta centralizada.
- Telefone confirmado some aviso no Kanban.
- **Superadmin**: métricas por loja (faturamento/pedidos/ticket/pedidos-dia) + fuso São Paulo + visual Menuzia.
- PWA: ícone + botão instalar.
- Migration **0035** (coluna `tag`) — **já aplicada** no Supabase. ✅

---

## ⬜ O QUE FAZER QUANDO VOLTAR (na ordem)

### 1. Deploy no Coolify  ← MAIS IMPORTANTE
Dispara o deploy. Sobe TUDO do `main` pra produção (`app.menuzia.com.br`).
Sem isso, nada acima aparece pro usuário.

### 2. ✅ Release do agente 0.1.12 — JÁ PUBLICADO
Publicado no GitHub com o `.exe` anexado. O botão de download no painel
(Ajustes > Impressão) já aponta pra v0.1.12 e funciona. Nada a fazer aqui.

### 3. Instalar o agente 0.1.12 no PC da impressora
Pra impressão ficar **rápida** (corrigido: medição em bitmap, sem inicializar driver 2x).
- Instalar o `.exe` (do release publicado, ou direto do `dist/` local).

### 4. Testar em produção (depois do deploy)
- **PDV**: clicar mesa → ver pedidos / novo pedido → receber pagamento (troco) → fechar conta.
- **Impressão**: lançar pedido pelo PDV → deve imprimir rápido e em negrito.
- **Cozinha produção**: grade → clica card → "quer preparar?" → preparar → concluir/devolver.
- **Vitrine**: cabeçalho em barra única, etiquetas no item, modal de detalhes do pedido (timeline verde).
- **Superadmin** (`/superadmin`): conferir faturamento/ticket/pedidos por loja e datas no fuso certo.

---

## ❌ NÃO foi feito (pendências decididas / abortadas)
- **Login = qualquer coisa (não email)** + cadastro sem nome da loja + tempo-de-sessão → **abortado** (risco de quebrar login). Login segue por **email**.
- **Carrinho em coluna no desktop** → adiado a pedido seu.
- **2 layouts de cabeçalho + preview ao vivo no Ajustes** → abortado.

---

## ⚠️ Lembretes
- Trabalhar direto no `main`; `git push` → Coolify lê `main`.
- Migrations: aplicar manual no **SQL editor do Supabase** (o `db:setup` está quebrado). Nenhuma pendente agora.
