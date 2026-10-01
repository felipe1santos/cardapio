# Noturno 2026-09-30 → 10-01 — progresso

Início 22:15 (Brasília). Deploy só 00:00–10:00. Envio real de WhatsApp só para 5527992534407
(máx. 25). Cada loja usa o próprio número (botão "Tirar dúvidas", wa.me). Impressão: NÃO mexer
(recibo/Assistente) — decisão do dono antes de começar.

Legenda: ⬜ a fazer · 🔧 em andamento · ✅ feito e testado · 🚀 no ar · ⚠️ com ressalva · ❌ falhou

## Fase 1 — Bugs (branch feat/noturno-fase1-bugs)
- ✅ 1.1 Robô não ativa (5037013; e2e integrações 26/26, robô 106/106): diagnosticar lojas (leitura), webhook automático + registrar nas conectadas sem webhook, toggle salva, estado em tempo real, robô responde, desativar mantém avisos, "falar com atendente" na central; teste real (ou mock + pendente)
- ✅ 1.2 Checkout no celular (já corrigido em 8cf0f85; e2e-checkout-larguras 72/72) (pagamento/entrega): barra por cima / não rola; 360/390/414; entrega e retirada; todas as formas; prints antes/depois
- ✅ 1.3 Prévia borrada (d0441ee; verificar-previa-link ok local) do link: og:image própria 1200×630 JPEG <300 KB, absoluta, meta completas, versão na URL; fallback logo+nome+cor; validar com UA do WhatsApp; envio real só p/ número de teste
- ✅ 1.4 Produtos com nome em código (0af8c78; 9 itens pausados na Menuzia) e R$ 0,00 na Menuzia: origem; validação; leitura outras lojas
- 🔧 Ciclo: vitest 1753 ✅, lint ✅, regressão 52/52, vitrine celular 11/11 — falta deploy (após 00:00) e smoke prod · testes + tsc + lint + suítes + e2e local + deploy + smoke prod

## Fase 2 — Menu lateral (feat/noturno-fase2-menu)
- ⬜ Remover bloco do logo "menuzia" + ícone de link (função de link movida pro card)
- ⬜ Sino de notificações no card (estado + mesmas opções)
- ⬜ Alerta de pendências com badge + modal (o que falta / por quê / Resolver)
- ⬜ Remover blocos "Notificações ativadas" e "X pendências" de baixo
- ⬜ Remover badges de pendência dos itens (manter "Novo")
- ⬜ Recolhido/mobile ok; e2e

## Fase 3 — Vitrine (feat/noturno-fase3-vitrine)
- ⬜ 3.1 Banner com proporção medida; tamanho ideal + prévia no admin; carrossel
- ⬜ 3.2 Cards "Mais Pedidos" (tamanho, 1:1, 2 linhas, "A partir de", tag, rolagem)
- ⬜ 3.3 Tags: ícones Fluent (MIT, locais), principais (Mais pedido 🔥, Novidade, Edição limitada) máx 2; utilitárias (Item promocional, Entrega grátis, Serve X); preço com desconto em 2 linhas; admin "Etiquetas do produto" + prévia; migração das antigas
- ⬜ 3.4 Botão fixo "Tirar dúvidas no WhatsApp" (número da loja; some sem número; não no checkout)
- ⬜ 3.5 Lado a lado referência × resultado; e2e 360/390/414/desktop

## Fase 4 — Botões nas mensagens (feat/noturno-fase4-botoes)
- ⬜ 4.1 Pesquisa de viabilidade (Evolution API)
- ⬜ 4.2 Editor com até N botões + atalho "Ver cardápio" + prévia; envio com botões ou fallback em texto; histórico registra modo; robô
- ⬜ 4.3 E2E (campanha de TESTE só p/ número de teste; fallback forçado; campanhas antigas)

## Fase 5 — Cozinha (feat/noturno-fase5-cozinha)
- ⬜ 5.1 Item "Cozinha" no menu; estações em cards com QR grande, copiar, tela cheia, imprimir QR, desativar/novo link/excluir; modal "Nova estação" (Preparo/Embalo/Completa); compatibilidade; estado vazio
- ⬜ 5.2 KDS redesenhado (tela cheia, wake lock, cabeçalho, cards grandes, cronômetro, itens/obs, marcar item, desfazer, som, filtros, atalhos)
- ⬜ 5.3 Modal "Como fazer" + ficha de preparo no cadastro (migration) + fichas de exemplo na Menuzia

## Fase 6 — Equipe com permissões (feat/noturno-fase6-equipe)
- ⬜ Acessos por item + permissões sensíveis; modelos; dono total; menu filtrado; servidor confere; auditoria; e2e por modelo

## Fase 7 — Agendamento (feat/noturno-fase7-agendamento)
- ⬜ Config (desligado por padrão); vitrine "Somente pedidos agendados / Abrimos…"; checkout com dia/horário; validação no servidor; status Agendado + aba; entrada automática no fluxo; WhatsApp; impressão só pela lógica de disparo (sem mexer no recibo)

## Registro
(atualizado a cada item)
