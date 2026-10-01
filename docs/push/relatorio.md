# Notificações push no app do cardápio — relatório (2026-10-01)

Branch `feat/push-notificacoes` · migration **0127** (rollback em `docs/rollback/0127_push_notificacoes.down.sql`)
· plano em `plano.md` · checklist em `progresso.md` · teste no celular em `teste-celular.md` · prints em `prints/`.

## O que foi feito

**Base técnica**
- Chaves **VAPID** só em variável de ambiente (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`);
  nomes em `.env.local.example`, valores nunca no repositório. Sem as chaves, a vitrine nem oferece.
- **Service worker por loja** (`public/sw-loja.js`, escopo `/loja/<slug>`): recebe o push, mostra a
  notificação (título, texto, ícone, badge, imagem, tag), no toque foca a aba/app da loja e navega para o
  link, e renova a assinatura se o navegador trocar (`pushsubscriptionchange`).
- **0127**: flag `restaurantes.push_liberado` (desligada em todas), `push_assinaturas` (loja, cliente,
  endpoint, chaves, plataforma, navegador, instalado, categorias, consentimento, último sucesso, falhas
  seguidas, status; vários aparelhos por cliente), `push_envios` (fila + histórico + clique + pedido),
  `push_config`, `push_automacoes`, `push_avulsas`, função `push_reservar_envios` (reserva atômica da
  fila). Tudo só pelo servidor (RLS ligado, sem permissão para anon/authenticated).
- **Envio** com `web-push`, em fila com até 3 tentativas (espera crescente); **404/410 → assinatura
  inválida**; 5 falhas seguidas → inválida.
- **Conteúdo**: título = loja (ou o da mensagem), texto até 140 caracteres com "…", **ícone = logo da
  loja** (192 px), **badge monocromático gerado da logo** (silhueta branca em fundo transparente; logo sem
  silhueta boa → talher neutro), imagem opcional, `tag` por tipo, link com `?push=<envio>`.

**Vitrine**
- Nunca pede ao abrir. **Convite depois do pedido** ("Quer ser avisado quando seu pedido sair…?" ·
  Sim, avisar / Agora não); só o "Sim" chama a permissão do navegador.
- **Perfil › Notificações**: liga/desliga e categorias (status do pedido, promoções e cupons, novidades,
  fidelidade); se bloqueado, explica como reativar (Android, iPhone, computador).
- **iPhone fora do app instalado**: ensina "Compartilhar › Adicionar à Tela de Início".
- "Agora não"/recusa: não pergunta de novo por **30 dias**. Consentimento gravado (data, aparelho,
  categorias) a cada ativação/alteração.
- Toque na notificação: registra o clique; pedido feito em até **48 h** conta para a notificação.
  `?item=` abre o produto, `?aba=pedidos|promocoes` troca a aba, `?cupom=` preenche o cupom.

**Motor** (cron de 10 em 10 min por loja — roda dentro do cron de campanhas que o Coolify já chama a cada
60 s, sem agenda nova)
- (a) loja abriu com promoção (1/dia) · (b) recompra (1 pedido, X dias, padrão 3) · (c) cliente sumido
  (X dias, padrão 6; repete a cada Y, padrão 14) · (d) item novo/Novidade · (e) cupom novo (mais novo
  ainda não recebido, respeitando o público do cupom) · (f) frete grátis ligado (geral ou bairro do
  cliente, detectado pela mudança) · (g) fidelidade (faltam 1–2; prêmio liberado) · (h) **status do
  pedido** (aceito, saiu para entrega, pronto para retirada) — no mesmo ponto do WhatsApp, fora do limite.
- Regras: só no horário da loja (ou até N min antes de abrir), **nunca 00:00–07:59**; limite por cliente
  (padrão 1/dia e 3/semana; teto 3 e 10); prioridade **cupom > fidelidade > loja abriu > frete > item
  novo > recompra > sumido**; deduplicação; categorias; isolamento por loja.

**Painel** — Campanhas › **Notificações do app** (atalho na Fidelidade): resumo (aparelhos, Android,
iPhone, computador, instalaram, clientes), teste para o seu telefone, automações (liga/desliga, texto com
variáveis, parâmetros, **prévia Android e iPhone com o ícone da loja**), avulsa (título, texto, imagem,
destino, público, agora/agendada, **contagem prevista** e confirmação), avulsas enviadas, limites e
horários, relatórios de 30 dias (enviadas, falhas, cliques, pedidos em 48 h). Área "Campanhas"; enviar
avulsa/teste exige a permissão "disparar campanhas".

## Como funciona em cada plataforma

| Plataforma | Recebe? | Observações |
|---|---|---|
| Android (Chrome, Samsung Internet) | Sim, mesmo sem instalar | Ícone, badge na barra, imagem grande. Permissão vale para o domínio inteiro. |
| Android (Firefox) | Sim | Sem imagem grande; badge pode não aparecer. |
| Computador (Chrome/Edge/Firefox) | Sim | No Windows aparece como notificação do sistema. |
| iPhone/iPad | **Só iOS 16.4+ com o cardápio na Tela de Início** | Permissão pedida dentro do app instalado; sem imagem grande e sem badge (usa o ícone do app); cada loja instalada é um app com permissão própria. |

## Mesmo domínio e recomendação de subdomínio
Hoje todas as lojas estão em `app.menuzia.com.br/loja/<slug>`. Funciona assim: cada loja tem o **seu
service worker** (escopo `/loja/<slug>`) e portanto **a sua assinatura**; o servidor guarda loja + cliente
e cada notificação sai com o nome, o ícone e o link da loja dona. A ressalva é a **permissão**, que no
Android/computador é do domínio: aceitar em uma loja libera o navegador para todas (mas só recebe de quem
o cliente ativou) e **bloquear** em uma bloqueia todas.
**Recomendação para o futuro:** subdomínio por loja (`<slug>.menuzia.com.br`) ou domínio próprio dá a cada
loja a sua origem — permissão e bloqueio por loja, nome da loja no lugar do domínio na notificação,
armazenamento isolado. Custa certificado curinga, roteamento por host e **nova permissão dos clientes**
(assinatura não migra de origem). Não foi feito agora.

## Testes
- **Unitários** (`lib/push/*.test.ts`): janela, madrugada, limite e teto, prioridade, dedup, categorias,
  gatilhos (recompra, inativo e repetição, fidelidade, frete por bairro), conteúdo (corte, variáveis,
  link, ícone/badge), badge monocromático (silhueta, foto → neutro, sem logo). Suíte toda: **1845 testes
  passando**.
- **E2E** `scripts/seguranca/e2e-push.mjs` (servidor local, envio simulado): **68/68** — flag por loja,
  vínculo só com prova, status do pedido, cada automação, dedup, limite, prioridade, categorias, janela,
  expirada (410 → inválida), isolamento entre lojas, avulsa/agendada/cancelada, contagem, teste para o
  telefone de teste, clique e pedido em 48 h, relatório, cancelamento, vitrine (convite não aparece ao
  abrir, Perfil, service worker com escopo da loja, erro tratado).
- **Push real no Chrome do computador** (localhost, loja de teste, chaves VAPID locais): ativado pelo
  Perfil → assinatura FCM gravada → avulsas enviadas pelo motor → **entregues ao service worker** (o
  Google aceitou e a aba recebeu o aviso do SW); desligar "Promoções" → a avulsa seguinte não chegou;
  desligar a chave → assinatura removida do navegador e cancelada no servidor.
  Limitação do ambiente: o Playwright não libera o serviço de push do Chrome, por isso a assinatura real
  foi feita no Chrome de verdade; o toque na notificação do Windows fica para a conferência no celular.
- **Regressão**: PDV v2 71, checkout 72, tags da vitrine 27, retoque 46, pedido idempotente 12,
  estabilidade 53, balcão/entrega 84, campanhas/métricas 63, botões de campanha 9 — todas verdes.
- Emulação Android/iPhone: prints em 390×844 (Android e iPhone 13); BrowserStack não disponível.

## Prints
`prints/painel-1-resumo-automacoes.png`, `painel-2-previa-cupom.png`, `painel-3-avulsa.png`,
`painel-4-limites.png`, `painel-5-celular.png`, `vitrine-1-convite-pos-pedido-android.png`,
`vitrine-2-perfil-notificacoes.png`, `vitrine-3-convite-iphone-instalar.png`.

## Publicação (pendente — janela 00:00–10:00)
1. Backup + aplicar a **0127** (`aplicar-migration-producao.mjs`).
2. Gerar chaves VAPID de produção e colocar no **Coolify** (variáveis de ambiente, não no repositório).
3. Merge na main + Redeploy; conferir que `/sw-loja.js` e `/api/loja/menuzia/push/config` respondem.
4. `push_liberado = true` **só na Menuzia**; automações continuam desligadas até você ligar.
5. Você testa no celular (`teste-celular.md`); rollback: desligar a flag (imediato) ou a 0127 down.

## Próximos passos
- Ligar as automações da Menuzia uma a uma, olhando o relatório.
- Liberar para outras lojas pelo superadmin (hoje só por SQL).
- Atualizar o status do pedido na vitrine ao receber o push com a aba aberta (o service worker já avisa).
- Subdomínio por loja quando houver loja com domínio próprio.
