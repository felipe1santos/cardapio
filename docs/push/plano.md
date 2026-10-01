# Notificações push no app do cardápio — plano (2026-10-01)

## Estudo (o que vale hoje)

| Plataforma | Funciona? | Regras |
|---|---|---|
| Chrome Android | Sim, também com o site no navegador (sem instalar) | Permissão por **origem** (vale para `app.menuzia.com.br` inteiro). Mostra `icon`, `badge` (barra de status, só silhueta/alfa), `image` grande, `tag`. |
| Samsung Internet | Sim (Chromium) | Igual ao Chrome; ícone/badge com o mesmo comportamento. |
| Firefox Android | Sim | Permissão por origem; `image` e `badge` limitados (ignora). |
| Chrome/Edge/Firefox desktop | Sim | Permissão por origem; `image` só Chrome/Edge (Windows). |
| iPhone/iPad (Safari) | Só **iOS/iPadOS 16.4+** com o site **adicionado à Tela de Início** e aberto por lá | Permissão pedida **por toque** do usuário, **de dentro do app instalado**; permissão **por app da tela de início** (manifesto `display: standalone`, `id`). Sem `image`, sem `badge` (usa o ícone do app), sem botões de ação. Push silencioso é proibido (`userVisibleOnly`). No Safari comum não há `PushManager`. |

Fontes: WebKit "Web Push for Web Apps on iOS and iPadOS"; MDN `showNotification`, Push API; especificação Push API
(cada registro de service worker tem as suas assinaturas; permissão é da origem).

## Mesmo domínio (app.menuzia.com.br/loja/<slug>)

- **Uma assinatura por loja**: a vitrine registra um service worker próprio, `/sw-loja.js`, com **escopo
  `/loja/<slug>`** (o mesmo `scope` do manifesto da loja). Cada registro tem o seu `PushManager`, então cada
  loja ganha um endpoint diferente mesmo no mesmo domínio, e o servidor guarda a assinatura com
  `restaurante_id` + cliente.
- **Permissão por origem (Android/desktop)**: aceitar em uma loja libera o navegador para todas, mas **só
  assina quem tocou em "Sim, avisar" naquela loja**. Nenhuma loja envia para assinatura de outra (toda
  consulta filtra `restaurante_id`; o endpoint é único por loja).
- **iPhone**: cada loja instalada é um app separado (manifesto com `id` = `/loja/<slug>`), com a sua
  permissão — já é o comportamento certo.
- **Conteúdo** sempre da loja dona da assinatura: título = nome da loja, ícone =
  `/api/loja/<slug>/icone/192`, badge = `/api/loja/<slug>/push/badge`, link dentro de `/loja/<slug>`.

### Recomendação para o futuro (sem mudar agora)
Subdomínio por loja (`<slug>.menuzia.com.br`) ou domínio próprio dá a cada loja a sua **origem**: permissão,
"bloquear" e configurações de notificação do Android passam a ser **por loja** (hoje, bloquear uma loja no
Chrome bloqueia todas), o nome do site na notificação vira o da loja e o cookie/armazenamento fica isolado.
Custo: certificado curinga, roteamento por host no middleware, novas assinaturas (as atuais não migram de
origem — o cliente precisa aceitar de novo). Recomendo fazer quando houver lojas com domínio próprio.

## Modelo de dados (migration 0127, com rollback)

- `restaurantes.push_liberado boolean default false` — **flag por loja**, desligada em todas; ligada só na
  Menuzia.
- `push_config` (1 por loja): `limite_dia` (1), `limite_semana` (3), `antecedencia_min` (30),
  `telefone_teste`, `estado jsonb` (frete grátis visto por último etc.), `ultima_avaliacao`.
  Teto do sistema: 3/dia e 10/semana.
- `push_automacoes` (loja × tipo): `ativo` (desligado por padrão), `titulo`, `texto` (variáveis `{nome}`,
  `{loja}`, `{produto}`, `{cupom}`, `{desconto}`), `params jsonb` (dias etc.).
- `push_assinaturas`: loja, `cliente_id`/`cliente_telefone` (quando houver), `endpoint` (único por loja),
  `p256dh`, `auth`, `plataforma` (android/ios/desktop/outro), `navegador`, `instalado`, `categorias text[]`,
  `consentimento_em`, `ultimo_sucesso_em`, `falhas_seguidas`, `status` (ativa/invalida/cancelada).
  Vários aparelhos por cliente.
- `push_avulsas`: título, texto, imagem, destino, público, `agendado_em`, status, previstos.
- `push_envios` (fila + histórico): assinatura, `destinatario` (telefone ou id da assinatura), origem
  (automacao/avulsa/status/teste), tipo, categoria, `chave_dedup`, payload, status
  (pendente/enviado/falhou/invalida/descartado), tentativas, próxima tentativa, erro, `enviado_em`,
  `clicado_em`, `pedido_id` (atribuição em até 48 h).
- RLS ligado sem políticas: só o servidor (service role) lê/escreve; o painel usa rotas de API que
  conferem a loja do usuário e a área Campanhas.

## Fluxo de permissão (vitrine)

1. Nunca ao abrir o cardápio.
2. **Depois do pedido**, na folha "Pedido enviado!": "Quer ser avisado quando seu pedido sair e receber as
   promoções da <loja>?" [Sim, avisar] [Agora não]. Só "Sim" chama `Notification.requestPermission()`.
3. **Perfil › Notificações**: liga/desliga e categorias (status do pedido, promoções e cupons, novidades do
   cardápio, fidelidade); se bloqueado no navegador, explica como reativar.
4. iPhone fora do app instalado: em vez de pedir, ensina "Compartilhar › Adicionar à Tela de Início" e abrir
   por lá.
5. "Agora não"/recusa: não pergunta de novo por 30 dias (localStorage por loja).
6. Assinatura vai para `POST /api/loja/<slug>/push/assinar` com consentimento (data, aparelho, categorias).
   Vínculo com o cliente: sessão (telefone + token) **ou** o id do pedido recém-feito (uuid, prova de posse).

## Motor de automações

- Avaliação a cada 10 min (`/api/cron/push`, mesma proteção `x-cron-secret`; também chamado pelo cron de
  campanhas, que já roda a cada 60 s no Coolify, com trava de 10 min por loja). Só lojas com
  `push_liberado`.
- Regras puras em `lib/push/regras.ts` (testáveis): janela de envio (loja aberta ou até N min antes de
  abrir; nunca entre 00:00 e 07:59), limite por cliente (dia/semana), prioridade
  **cupom > fidelidade > loja abriu/promoção > frete grátis > item novo > recompra > inativo**, dedup por
  chave, categorias do cliente.
- Gatilhos: (a) loja aberta com promoção ativa, 1/dia; (b) só 1 pedido há ≥ X dias (3); (c) último pedido há
  ≥ X dias (6), repete a cada Y (14); (d) item criado ou com Novidade; (e) cupom novo público; (f) frete
  grátis ligado (geral ou bairro do cliente), detectado pela mudança no `estado`; (g) fidelidade: faltam
  ≤ 2 para o prêmio e prêmio disponível; (h) status do pedido — transacional, fora do limite, disparado no
  mesmo ponto do WhatsApp (`notificarPedido`).

## Envio

- `web-push` com chaves VAPID de `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Coolify + .env local).
- Fila em `push_envios`: processa pendentes, até 3 tentativas com espera crescente; 404/410 → assinatura
  `invalida`; 5 falhas seguidas → `invalida`.
- Payload: `title`, `body` (até 140 caracteres, corta com "…"), `icon` (192 px da loja), `badge` (silhueta
  branca gerada da logo com sharp; se não der silhueta boa, talher neutro), `image` opcional, `tag` por tipo,
  `data.url` com `?push=<envio>` para medir clique e pedido.
- Clique: o service worker foca uma aba da loja ou abre o link; a vitrine registra o clique e guarda o id
  para o pedido feito em até 48 h.

## Painel

Campanhas › "Notificações do app" (atalho na Fidelidade): resumo, automações com texto/parâmetros e
prévia Android/iPhone, avulsa (agora/agendada, contagem prevista), limites/horários, relatórios, botão
"Enviar notificação de teste para mim" (vai só para as assinaturas do telefone de teste da loja). Rotas em
`/api/admin/campanhas/push/*` → herdam a área Campanhas; enviar avulsa exige `disparar_campanhas`.

## Riscos

- Enviar para cliente de outra loja → toda query filtra loja; endpoint único por loja; testes de isolamento.
- Spam → limites, janela, dedup, prioridade; automações desligadas por padrão.
- Flag ligada sem VAPID → vitrine não oferece (config responde `ativo:false`).
- iPhone: só funciona instalado; muita gente não instala → convite ensina.
- Chrome pode "silenciar" sites com pouca aceitação → só pedimos depois de um gesto e de um pedido.
- Chaves VAPID trocadas invalidam todas as assinaturas → documentar: não trocar.
