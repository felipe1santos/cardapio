# Notificações push no app do cardápio (PWA) — progresso

Branch `feat/push-notificacoes`. Início 2026-10-01. Flag por loja, DESLIGADA por padrão; ligada só na
Menuzia. Envios reais só para assinaturas da Menuzia. Deploy entre 00:00 e 10:00, com backup antes da
migration e rollback se falhar.
Legenda: ⬜ a fazer · 🔧 em andamento · ✅ feito e testado · 🚀 no ar · ⚠️ ressalva

## 0. Estudo e plano
- ✅ Documentação atual: Web Push, Push API + Notifications API, service worker, VAPID
- ✅ Regras do iOS/iPadOS (tela de início, 16.4+, permissão de dentro do app, por toque)
- ⚠️ Comportamento no Chrome Android, Samsung Internet e Firefox Android (documentação; aparelho real fica para o seu teste)
- ✅ Levantamento do que existe (manifesto/PWA por loja, service worker, convite de instalar, clientes,
  campanhas, fidelidade, cupons, status do pedido) — reaproveitar
- ✅ Mesmo domínio (permissão por origem): assinatura ligada à loja + cliente, conteúdo/ícone/link de cada loja
- ✅ Recomendação documentada de subdomínio por loja / domínio próprio (sem mudar agora)
- ✅ Plano em docs/push/plano.md (dados, permissão, motor, envio, riscos)

## 1. Base técnica
- ✅ Chaves VAPID em variável de ambiente (Coolify + .env local), nunca no repositório
- ✅ Service worker da vitrine: recebe push, mostra notificação, clique abre/foca no link certo
- ✅ Migration com rollback: tabela de assinaturas (loja, cliente, endpoint, chaves, plataforma,
  navegador, instalado, categorias, consentimento, último sucesso, falhas seguidas, status; vários aparelhos)
- ✅ Envio pelo servidor (web-push) em fila com retentativas
- ✅ 404/410 → assinatura inválida, para de receber
- ✅ Conteúdo: title (loja/título), body com limite e "…", icon (logo 192/512 PNG)
- ✅ Badge monocromático gerado da logo (silhueta branca; fallback ícone neutro)
- ✅ image opcional (Android), data.url com parâmetro de origem, tag para agrupar

## 2. Permissão e instalação na vitrine
- ✅ Nunca pedir ao abrir o cardápio; convite próprio antes do pedido nativo
- ✅ Momento principal: depois de concluir o pedido ("Sim, avisar" / "Agora não")
- ✅ Perfil › Notificações: ativar/desativar e categorias (pedido, promoções e cupons, novidades, fidelidade)
- ✅ iPhone fora do app instalado: instrução de instalar (Compartilhar › Adicionar à Tela de Início)
- ✅ Recusou: não perguntar por 30 dias; bloqueado: Perfil mostra como reativar
- ✅ Consentimento registrado por loja (data, aparelho, categorias) — LGPD

## 3. Automações (motor no servidor)
- ✅ Job periódico (~10 min) avalia regras e enfileira
- ✅ a) Loja abriu + promoção (máx. 1/dia)
- ✅ b) Recompra (1 pedido, X dias, padrão 3)
- ✅ c) Cliente inativo (X dias, padrão 6; repetir a cada Y, padrão 14)
- ✅ d) Item novo / marcado Novidade
- ✅ e) Cupom novo / desconto novo
- ✅ f) Frete grátis ativado (geral ou bairro do cliente)
- ✅ g) Fidelidade: progresso e prêmio disponível
- ✅ h) Status do pedido (aceito, saiu para entrega, pronto para retirada) — fora do limite de marketing
- ✅ Marketing só no horário da loja (ou até 30 min antes, configurável); nunca de madrugada
- ✅ Limite por cliente (padrão 1/dia e 3/semana, configurável dentro do teto)
- ✅ Prioridade (cupom > fidelidade > promoção > recompra), só a mais importante
- ✅ Deduplicação · categorias desativadas respeitadas · isolamento entre lojas
- ✅ Cada automação liga/desliga com texto editável

## 4. Painel (Campanhas / Fidelidade)
- ✅ Seção "Notificações do app" em Campanhas, atalho na Fidelidade
- ✅ Resumo: ativas (total, Android, iPhone, desktop) e quantos instalaram
- ✅ Automações: liga/desliga, texto com variáveis ({nome}, {loja}, {produto}, {cupom}, {desconto}), parâmetros, prévia Android/iPhone
- ✅ Avulsa: título, texto, imagem, destino, público, agora/agendado, contagem prevista
- ✅ Limites de frequência e horários
- ✅ Relatórios: enviadas, falhas, cliques, pedidos até 48 h depois do clique
- ✅ Permissão de Campanhas para configurar/enviar
- ✅ Botão "Enviar notificação de teste para mim"

## 5. Testes
- ✅ Unitários: regras de cada automação, horário, limite, prioridade, dedup, categorias, isolamento, expiradas, conteúdo
- ✅ Ponta a ponta Chrome desktop com push real (assinar, receber, desativar categoria, cancelar) · ⚠️ clique no aviso do Windows não automatizável (conferir no celular); cada tipo coberto no e2e simulado
- ⚠️ Emulação Android/iOS: prints em 390×844; BrowserStack indisponível; iPhone real no seu teste
- ✅ Flag por loja desligada por padrão (testado) · ⬜ ligar na Menuzia (na publicação)
- ✅ docs/push/teste-celular.md (Android Chrome e iPhone)

## 6. Publicação e relatório
- ⬜ Backup antes da migration · deploy 00:00–10:00 · conferência na Menuzia · rollback se falhar
- ⬜ VAPID no Coolify
- ✅ docs/push/relatorio.md (plataformas, limitações do iPhone, prints, testes, subdomínio, próximos passos)

## Registro
- 2026-10-01 tarde: início; checklist criado.
- 2026-10-01 ~15:50: implementado e testado (unitários 1845, e2e push 68/68, push real no Chrome, regressão verde). Falta a publicação (janela 00:00–10:00) e o seu teste no celular.
