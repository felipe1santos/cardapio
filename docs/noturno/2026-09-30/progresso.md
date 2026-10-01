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
- 🚀 Ciclo: vitest 1753 ✅, lint ✅, regressão 52/52, vitrine celular 11/11; no ar 00:05 (ver Deploys)

## Fase 2 — Menu lateral (feat/noturno-fase2-menu)
- ✅ Card da loja com sino + alerta (badge) e modal "Resolver"; faixa da marca, blocos do rodapé e badges de pendência removidos; copiar link em "Ver meu cardápio" (6256819; e2e-menu-lateral 16/16; unit 44)

## Fase 3 — Vitrine (feat/noturno-fase3-vitrine)
- ✅ 3.1–3.5 (ad54d48…; migration 0117; e2e-vitrine-fase3 51/51, e2e-admin-etiquetas 7/7; lado a lado em prints/fase3)

## Fase 4 — Botões nas mensagens (feat/noturno-fase4-botoes)
- ✅ 4.1 pesquisa (fase4-pesquisa-botoes.md): botões NÃO confiáveis na Evolution 2.3.7/QR → fallback sempre
- ✅ 4.2 editor + links no texto + histórico (e913e43; migration 0118)
- ⚠️ 4.3 e2e simulado 9/9 + campanhas 63/63; envio real pendente (WhatsApp da Menuzia desconectado)

## Fase 5 — Cozinha (feat/noturno-fase5-cozinha)
- 🚀 5.1 Item "Cozinha" no menu, estações em cartões (QR grande, copiar, tela cheia, imprimir, desativar/novo link/excluir), modal "Nova estação" (Preparo/Embalo · Expedição · Completa), estado vazio; aba de Ajustes redireciona (deaaa11)
- 🚀 5.2 KDS redesenhado: tema escuro, tela cheia + wake lock, filtros, cronômetro, marcar item, desfazer, queda de rede não apaga a tela (4b1f508, 7ecdd6b)
- 🚀 5.3 Ficha de preparo (0119, tabela própria) no cadastro + modal "Como fazer" no KDS (7198da0, ae920c0)
- ✅ e2e-cozinha-fase5 26/26, e2e-ficha-admin 2/2

## Fase 6 — Equipe com permissões (feat/noturno-fase6-equipe)
- 🚀 Acessos por área do menu + 6 ações sensíveis, modelos (Garçom, Caixa, Cozinha, Entregador/Logística, Gerente), dono sempre total, menu filtrado, middleware relê a cada requisição (vale na próxima ação), 403/"sem acesso", auditoria equipe.acessos_alterados, "editar preços" barrado no banco (0120)
- ✅ e2e-equipe-acessos 27/27; suítes: vitest 1786, garçom 47, PDV v2 70, regressão 52, estabilidade 53, caixa 18, checkpoint-e 85/86 (só o QRDIR de sempre), balcão 84, atendimento 71, robô 106, campanhas 63

## Fase 7 — Agendamento (feat/noturno-fase7-agendamento)
- 🚀 Config em Ajustes › Loja (desligada por padrão em todas as lojas); vitrine "Somente pedidos agendados / Abrimos hoje (quinta) às 03:00"; checkout com Agora/Agendar + dia e horário; servidor confere grade, intervalo, antecedência, canal e lotação; faixa "Agendados" no Kanban sem alarme/aceite automático; cozinha, badge e fila de impressão só com pedido liberado (X min antes, só lógica de disparo — recibo intacto); WhatsApp de recebido cita o horário; aviso em Ajustes de agendados fora do novo horário (0121)
- ✅ e2e-agendamento 25/25; vitest 1802; regressões: cozinha 26, regressão 52, checkout 72, PDV v2 70, garçom 47, balcão 84

## Registro
(atualizado a cada item)

### Deploys (01/10)
- 23:59:26 push F1 → main (b6531de); Redeploy disparado 23:59:52 (8 s antes da janela; build terminou e ficou no ar 00:05). 🚀 Smoke público: prévia 1200×630 JPEG (Menuzia 26 KB, Villa 85 KB), vitrine sem itens-código/feijoada R$0, checkout 360/414 com botão no fundo (6/6).
- 00:06 F2 (ac6fffa) 🚀 Success no Coolify. Smoke do painel NÃO feito: a sessão do Chrome está logada em outra loja (Ponto 400) e não digito senha em produção — pendente para o dono conferir.
- 00:09 0117 aplicada (backup ~/backups/menuzia/2026-10-01-pre-0117; 9 itens migrados). 00:18 F3 (56efcc0) 🚀; smoke vitrine Menuzia 360/390/414 15/15 (banner 1,41, Mais Pedidos, etiquetas, desconto com ticket, botão WhatsApp com o número da loja).
- 00:23 0118 aplicada (backup …-pre-0118). F4 (298942e) 🚀 Success. Smoke de campanhas (painel) pendente pelo mesmo motivo do F2.
- ~00:50 0119 aplicada (backup …-pre-0119). F5 (ad89bff) 🚀 Success; smoke público KDS (link inválido) ok; print em prints/fase5/prod-kds-menuzia-1920.png.
- 01:2x servidor local e suítes amplas da F6 foram derrubados pelo Windows (memória crítica); retomadas depois, uma por vez, todas verdes.
- 01:30 0120 aplicada (backup …-pre-0120; dry-run ok; nenhum funcionário com acessos — todos seguem no padrão do papel). F6 (f415e59) 🚀 Success. Smoke: /admin/* sem sessão → login, /api/admin/equipe → 401; leitura no Ponto 400 (sessão do Chrome, só leitura): dono vê o menu inteiro e a coluna "Acessos".
- 02:03 0121 aplicada (backup …-pre-0121; agendamento desligado em todas). F7 (6a15b99) 🚀 Success. Smoke: 5 vitrines 200, /api/loja/*/agendamento = desligado em todas, POST com agendadoPara sem itens recusado antes de gravar (nada criado).
- 02:06 fim: relatório em relatorio.md; servidores locais, Docker e aba do Chrome fechados; repositório em main.
