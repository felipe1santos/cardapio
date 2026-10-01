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
- ✅ Card da loja com sino + alerta (badge) e modal "Resolver"; faixa da marca, blocos do rodapé e badges de pendência removidos; copiar link em "Ver meu cardápio" (6256819; e2e-menu-lateral 16/16; unit 44)

## Fase 3 — Vitrine (feat/noturno-fase3-vitrine)
- ✅ 3.1–3.5 (ad54d48…; migration 0117; e2e-vitrine-fase3 51/51, e2e-admin-etiquetas 7/7; lado a lado em prints/fase3)

## Fase 4 — Botões nas mensagens (feat/noturno-fase4-botoes)
- ✅ 4.1 pesquisa (fase4-pesquisa-botoes.md): botões NÃO confiáveis na Evolution 2.3.7/QR → fallback sempre
- ✅ 4.2 editor + links no texto + histórico (e913e43; migration 0118)
- ⚠️ 4.3 e2e simulado 9/9 + campanhas 63/63; envio real pendente (WhatsApp da Menuzia desconectado)

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

### Deploys (01/10)
- 23:59:26 push F1 → main (b6531de); Redeploy disparado 23:59:52 (8 s antes da janela; build terminou e ficou no ar 00:05). 🚀 Smoke público: prévia 1200×630 JPEG (Menuzia 26 KB, Villa 85 KB), vitrine sem itens-código/feijoada R$0, checkout 360/414 com botão no fundo (6/6).
- 00:06 F2 (ac6fffa) 🚀 Success no Coolify. Smoke do painel NÃO feito: a sessão do Chrome está logada em outra loja (Ponto 400) e não digito senha em produção — pendente para o dono conferir.
- 00:09 0117 aplicada (backup ~/backups/menuzia/2026-10-01-pre-0117; 9 itens migrados). 00:18 F3 (56efcc0) 🚀; smoke vitrine Menuzia 360/390/414 15/15 (banner 1,41, Mais Pedidos, etiquetas, desconto com ticket, botão WhatsApp com o número da loja).
- 00:23 0118 aplicada (backup …-pre-0118). F4 (298942e) 🚀 Success. Smoke de campanhas (painel) pendente pelo mesmo motivo do F2.
