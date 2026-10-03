# Pixel Meta, anúncio sem conversões e conferência do Dashboard — 2026-10-03

Regra seguida:
- Ponto 400 (loja real) só em leitura, pelo banco, em transação READ ONLY.
- Testes de ponta a ponta só no ambiente local e na Menuzia (perfil do Chrome "Menuzia teste", com a loja conferida
  na tela antes de cada ação).

O pedido veio com `[LOJA]` e `[DATAS]` em branco. Pelos dados, a campanha é da **Ponto 400** (única loja com pixel
real, `1458…8017`), e o período é **01 e 02/10/2026**:
- tráfego vindo do `adsmanager.facebook.com` em 01/10;
- picos de `ig`/`fb` em 01 e 02/10;
- os números do Dashboard citados (02/10: 79 / 24 / 17 / 10 / 10, R$ 674,96) são os da Ponto 400.

## Parte 0 — Status geral

| Item | Status | Observação |
|---|---|---|
| Webhook do WhatsApp em todas as lojas | **Em produção** (b6531de, 52ce635) | Registrado ao conectar, ao reconectar e pelo cron. Recebem eventos agora: Estância, Ponto 400, Villa, Nossa Cozinha. **Belgas** tem instância, mas nenhum evento chegou. **Menuzia**: 1 evento em 3 dias (WhatsApp desconectado). DB Doces, Mama Pizza, Pizza do Rosa e Teste: sem WhatsApp. |
| Botões clicáveis nos disparos e prévia borrada do link | **Em produção** (0118, e913e43; prévia própria `/api/loja/[slug]/previa`) | Os botões vão como links no texto. Botão nativo só pela API oficial do WhatsApp. Envio real nunca foi testado: o WhatsApp da Menuzia está desconectado. |
| Notificações push no PWA | **Parcial** | Código e 0127 em produção, mas `push_liberado = false` em todas as lojas (`/api/loja/menuzia/push/config` → `ativo:false`). Falta conferir a chave VAPID no Coolify e ligar na Menuzia. |
| Fechamento de caixa por turno e as 28 correções da varredura | **Em produção** (0111–0116, 0114/0115; depois o Financeiro 0132–0137) | Com o financeiro ligado (só Menuzia), o caixa é o do Financeiro. |
| Robô que não ativava e checkout da vitrine no celular | **Em produção** (5037013, 8cf0f85, 9b968cf) | |
| KDS redesenhado e modal "Como fazer" | **Em produção** (4b1f508, 0119) | |
| Agendamento de pedidos | **Em produção** (0121) | Ligado só na Menuzia. |
| Fonte única na vitrine e tela cheia no celular | **Em produção** (a0fbb05, 34e7e03) | |
| Aviso da vitrine com cor/efeito, cupom azul com resgate e bug do e-mail nos Ajustes | **Em produção** (25328f6, 0123, 0125) | |
| PDV: janelas sobre a tela, item com fotos, sabor da pizza, busca e categorias na mesma linha | **Em produção** (9076138, a8d71fa) | |
| Dashboard (filtro de data), topo do Kanban e som de pedido novo | **Parcial** | Filtro de data **em produção** (7c8fe2b). Não achei commit específico de "topo do Kanban" nem de "som de pedido novo" depois do alarme antigo do aceite automático: tratar como **não começado** até você me dizer qual era o pedido. |
| Equipe no estilo novo, submenu de Campanhas e cadastro de produto com hover | **Em produção** (0128–0130, 8f62eb6, 6f62900) | |
| Clientes: importar/exportar CSV | **Em produção** (0131, 2c31e70) | |
| Impressão: modelo oficial (fonte do antigo, logo, itens compactos) e bug do "PAGO" | **Em produção, parcial nas lojas** | Comanda padrão (0109) e recibo com taxas (0126) entraram com o Assistente **beta.8**. Cada loja precisa instalar a versão nova por cima. O "PAGO" indevido no delivery a receber foi corrigido na 0135 (recibo sai "A RECEBER"). |

Todas as branches de feature (`feat/*`, `fix/*`) têm 0 commits fora do main, e o main está publicado. Migrations em
produção vão da 0100 à 0137, sem buracos além dos números pulados de propósito (0108, 0110).

## Parte 1 — Anúncio: 30 cliques e zero carrinho/compras no Meta

### 1.1 Dados internos (Ponto 400, 01–02/10, só leitura)

Funil por sessão, separando quem veio do Meta (`origem` = ig, fb, l./m./lm.facebook.com, l.instagram.com,
adsmanager):

| Grupo | Sessões | Viu item | Sacola | Checkout | Pedido |
|---|---|---|---|---|---|
| **Anúncio / Meta** | 90 | 12 | 6 | 3 | **3** |
| Outras origens | 124 | 47 | 26 | 16 | 11 |

- **Pedidos do anúncio** (reais, entregues):
  - #303 em 01/10 19:04, R$ 23,00, Pix;
  - #307 em 02/10 18:15, R$ 72,00, cartão;
  - #315 em 02/10 22:03, R$ 50,99, Pix.
- **69 das 90 sessões do Meta não tiveram nenhuma interação** (só a abertura da página). É o perfil do pré-carregamento
  de links do navegador do Instagram/Facebook e de quem abre e fecha. Sessões com interação: 21, de 13 visitantes. Isso
  é coerente com os ~30 cliques do Gerenciador.
- **Loja aberta e vendendo** nos horários: 15 pedidos da vitrine em 01–02/10, todos entregues. O WhatsApp da Ponto 400
  recebe eventos normalmente (638 em 3 dias).
- O banco não guarda o navegador/aparelho por visita (a `vitrine_eventos` não tem user-agent). Por isso não dá para
  separar Instagram × Facebook × Chrome pelo histórico.

**Conclusão 1.1:**
- Quem veio do anúncio chegou à sacola e **comprou**: 3 pedidos, R$ 145,99.
- Não houve problema real na compra. O zero no Gerenciador de Eventos é **rastreamento** (ver 1.2).

### 1.2 Auditoria do pixel no código (antes da correção)

| Ponto | Encontrado |
|---|---|
| Eventos enviados ao Meta | **Só `PageView`** (`app/loja/[slug]/vitrine.tsx`, injeção do pixel). ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo e Purchase **não existiam no código**. É a causa do "0 carrinho / 0 compra" no Gerenciador. |
| Purchase com valor/moeda/event_id | Não existia. |
| PageView repetido | Sim. Ao voltar para a aba depois de 30 s, a loja recarrega, o objeto `restaurante` muda e o efeito do pixel roda de novo, mandando outro PageView (e outro `gtag config`). |
| Navegação interna (SPA) | A vitrine é uma página só (produto, sacola, checkout e confirmação são estados), então o pixel está presente em todas as telas. Não há troca de rota que exija PageView. |
| CSP / correção da varredura | **Não há CSP** no app, então nada bloqueia `connect.facebook.net`. A correção da varredura (`idsDeMedicaoSeguros`) só aceita ID numérico e não atrapalha um pixel válido. A Ponto 400 tem um ID válido de 16 dígitos. |
| Pixel duplicado / ID inválido | Não. Um pixel por loja. Menuzia e Pizza do Rosa têm IDs de teste ("1213…", "1312…"), que não são pixels reais. |
| Google tag | Só o page_view automático, sem eventos de e-commerce. IDs `GTM-…` eram carregados como `gtag/js`, o que não carrega o contêiner do Tag Manager. Nenhuma loja real usa Google tag hoje. |
| API de Conversões | Não existia. |
| Rastreio interno | Não guardava o navegador, e não filtrava robôs nem pré-visualização de link no endpoint de eventos. |

### 1.3 Reprodução de ponta a ponta (local, 4 navegadores emulados)

Suíte `scripts/seguranca/e2e-pixel-conversao.mjs`: **48/48**.
- **Perfis:** Chrome Android (Pixel 7), Safari iOS (iPhone 13), navegador interno do Instagram (iOS) e do Facebook
  (Android).
- **Cenário:** entrada com `?fbclid=…&utm_source=ig`, abrir o cardápio, produto, sacola, checkout e concluir o pedido.
- **Isolamento:** o `fbq` é um gravador, e os domínios do Meta e do Google ficam bloqueados no navegador de teste. Nada
  saiu para o Meta.
- **Resultado por navegador:**
  - PageView, ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo e Purchase, **uma vez cada**, em BRL e com valor;
  - Purchase com `eventID = pedido-<id>`;
  - GA4 com `view_item`, `add_to_cart`, `begin_checkout`, `add_payment_info` e `purchase` (`transaction_id` = número do
    pedido).
- **Voltar à aba depois de 30 s:** o PageView não se repete.
- **API de Conversões** (receptor falso local): 1 Purchase por pedido, com o mesmo event_id, BRL, valor,
  `test_event_code`, telefone só em SHA-256, `fbc` com o fbclid do anúncio, IP e navegador.
- O rastreio da vitrine grava o navegador (instagram/facebook/chrome/safari) e a origem `ig`.
- Robôs (facebookexternalhit, WhatsApp, Googlebot) não viram visita. O mesmo envio vindo do navegador do Instagram
  grava.
- O campo do pixel com código (`123');alert(1);//`) **não é injetado**.
- **Nenhum erro ou travamento** impediu a compra em nenhum dos 4 navegadores. Prints em `prints/`.

"Testar eventos" do Gerenciador: precisa do seu login no Meta e do código de teste. Ver o checklist no fim.

### 1.4 Correções feitas

1. **Eventos padrão** (`lib/pixel-eventos.ts`, ligados em `vitrine.tsx`):
   - ViewContent ao abrir o produto;
   - AddToCart quando a sacola aumenta;
   - InitiateCheckout ao abrir o checkout;
   - AddPaymentInfo ao sair da etapa Pagamento;
   - Purchase **só depois** do pedido aceito pelo servidor, com `value` (total do pedido), `currency: 'BRL'`,
     `content_ids`, `contents`, `num_items` e `eventID: pedido-<id>`.
   - Guarda contra duplicar: o mesmo event_id não sai duas vezes na aba, e o Purchase também é guardado no
     sessionStorage.
2. **PageView uma vez por página.** O efeito do pixel depende só dos IDs, e uma guarda global impede injetar de novo.
3. **Google tag:** eventos GA4 equivalentes. `GTM-…` passa a carregar `gtm.js` (o contêiner de verdade).
4. **API de Conversões (Purchase pelo servidor)** (`lib/meta-capi.ts`):
   - Sai no `/api/loja/[slug]/pedido` depois que o pedido é criado, com o mesmo event_id do navegador, então o Meta
     deduplica.
   - Leva o telefone em SHA-256, IP, navegador, `_fbp` e `_fbc` (do cookie ou do `fbclid` da URL de entrada).
   - Nunca atrapalha o pedido: tem timeout de 5 s e o erro só vai para o log.
   - **Precisa do token da loja:** Integrações › Medição › "API de Conversões do Meta", que só o dono vê. O token fica
     na tabela nova `integracoes_segredos` (0138), que não tem nenhuma política de leitura (só o servidor lê), e nunca
     volta para a tela (aparece "••••abcd"). Há um campo opcional para o código de teste do "Testar eventos".
5. **Rastreio interno:**
   - eventos de robôs e pré-visualizações de link são descartados;
   - cada evento guarda a categoria do navegador e do sistema (`vitrine_eventos.navegador/sistema`, 0138), nunca o
     user-agent inteiro.
6. **Segurança:** o campo do pixel continua aceitando só o ID (`idsDeMedicaoSeguros` intacto). A suíte prova que código
   no campo não é injetado.

**Causas operacionais:** nenhuma.
- A Ponto 400 estava aberta e vendendo nos horários.
- Os preços estavam normais.
- O WhatsApp estava conectado.

**O que não dá para corrigir no código:** o pré-carregamento de links do Instagram/Facebook abre a página sem a pessoa
ter clicado. Explica parte das 69 sessões sem interação. O Meta conta "visualizações da página de destino" do jeito
dele, e o nosso painel conta quem executou a página.

## Parte 2 — Dashboard: correto ou inflado?

Referência: Ponto 400, 02/10/2026. Recalculado direto no banco, em leitura:

| Número | Painel | Banco | Bate? | O que mede | Depois da correção |
|---|---|---|---|---|---|
| Visitas | 79 | 79 visitantes únicos (112 eventos, 110 sessões) | ✅ | Visitante único no período (a mesma pessoa abrindo duas vezes conta 1) | Igual. A partir do deploy, robôs e pré-visualizações deixam de entrar. |
| Visualizações | 24 | 24 | ✅ | Visitantes que abriram algum item | Igual |
| Sacola | 17 | 17 | ✅ | Visitantes que puseram algo na sacola | Igual |
| Checkout | 10 | 10 | ✅ | Visitantes que abriram o checkout (14 sessões) | Igual |
| Pedidos (funil) | 10 | 10 | ✅ | Visitantes que concluíram o pedido **na vitrine** | Igual. Checkout 10 = Pedidos 10 é real: os 10 que abriram o checkout compraram. |
| Faturamento | R$ 674,96 | R$ 674,96 (#307–#316, todos da vitrine) | ✅ no dia | **Soma todos os canais** (vitrine + PDV/balcão + mesas) | Igual, agora com rodapé por origem. Em 02/10 a Ponto 400 só vendeu pela vitrine; em 01/10 já entrou o #305 do PDV (R$ 34). |
| Ticket médio | R$ 67,50 | R$ 674,96 ÷ 10 = R$ 67,50 | ✅ | Faturamento ÷ pedidos (todos os canais) | Igual |
| Tempo médio de entrega | 1h34min | 1h34min | ✅ (mas rótulo enganoso) | Média de **saída do motoboy → marcado "entregue"** | Renomeado para "Tempo médio na rua", com a explicação ao passar o mouse |
| "pedido → porta" | 2h24min | 2h24min | ✅ (rótulo enganoso) | Média de **pedido feito → marcado "entregue"** | Renomeado para "do pedido feito à entrega" |

**Por que 1h34 na rua?** É operação, não erro de conta. A Ponto 400 marca "entregue" **em lote**:
- 21:08 para #307–#311;
- 22:43 para #312–#314;
- 23:43 para #315–#316.

Ex.: #307 saiu 19:11 e foi marcado entregue 21:08, o que dá 117 min de "rua". A média passa a refletir o tempo real
quando o motoboy marca a entrega no app, na hora.

**Correções do Dashboard:**
1. **Faturamento:**
   - rodapé "Vitrine R$ … (n) · PDV/balcão R$ … (n) · Mesas R$ … (n)";
   - a dica diz que o resumo soma todos os canais e que o funil é só do cardápio online.
2. **Tempos:**
   - rótulos claros;
   - ficam fora da média os pedidos de **teste** (cliente "TESTE…") e os pedidos com mais de 6 h entre feito e
     entregue (esquecidos abertos);
   - continuam fora rotas de menos de 1 min ou mais de 4 h, e os cancelados (só entram os entregues).
3. **Visitas:** já eram por visitante único. Agora, sem robôs.

Suíte `scripts/seguranca/e2e-dashboard-banco.mjs`: tela × SQL direto, **8/8** na fin-int (faturamento e as três
origens) e **8/8** na ordem-qr-e2e (funil 796 / 345 / 325 / 222 / 143).

## Lojas de teste locais (as duas suítes que falhavam)

- A `ordem-qr-e2e` estava **sem nenhum item**: alguma rodada anterior apagou o cardápio. Por isso o
  `pedido-idempotente` (procura "Coca Lata") quebrava. Rodei a semente de novo (`semear-cardapio-ordem.mjs`).
- O Storage do Supabase **local** se atualizou (índices de versionamento) e recusa upload com o erro 42P10. A semente
  agora segue sem as fotos de teste quando o upload falha. É problema só do ambiente local, e as fotos não são usadas
  nessas suítes.

## Checklist para validar no Gerenciador de Eventos (antes da próxima campanha)

1. Gerenciador de Eventos › seu pixel › **Configurações › API de Conversões › Gerar token de acesso**. Copie o token.
2. Menuzia › **Integrações › Medição › API de Conversões do Meta** › Adicionar token. Cole o token e, para testar, o
   código da aba **Testar eventos** (ex.: `TEST12345`).
3. Na aba **Testar eventos**, abra o cardápio pelo link do anúncio (ou cole a URL da loja). Abra um produto, adicione à
   sacola, vá ao checkout, escolha o pagamento e conclua um pedido de teste (depois cancele no painel).
4. Confira que aparecem **PageView, ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo e Purchase**:
   - o Purchase com **valor e BRL**;
   - o Purchase com duas fontes, **Navegador e Servidor**, e "Desduplicado".
5. Volte em Integrações e **remova o código de teste** (o token fica).
6. No Gerenciador de Anúncios, a campanha de vendas deve otimizar para **Compra** (Purchase) no pixel da loja.
7. Depois de 24–48 h, em **Visão geral** do pixel, a "Qualidade da correspondência de eventos" do Purchase deve
   aparecer. Telefone e fbc ajudam a nota.

## Publicação (2026-10-03, ~16:00, autorizada fora da janela)
- **0138** aplicada com backup (`~/backups/menuzia/2026-10-03-pre-0138`) e conferida: tabela de segredos sem acesso
  para anon/authenticated, colunas `navegador`/`sistema` criadas.
- **main `3fc1023`**, Redeploy no Coolify, no ar às ~16:05.
- **Conferência na Menuzia** (perfil "Menuzia teste"; loja "Angus Burguer" e usuário "Administrador" confirmados na
  tela):

| Verificação | Resultado |
|---|---|
| Cartão "API de Conversões do Meta" em Integrações; rota responde "não configurada" (só para o dono) | ok |
| Vitrine com `?fbclid=…&utm_source=ig`: pixel injetado 1 vez, 1 requisição PageView, `_fbc` guardado | ok |
| Volta à aba depois de 30 s: continua 1 PageView | ok |
| Rastreio no banco: visita com `origem=ig`, `navegador=chrome`, `sistema=windows` | ok |
| Dashboard: Faturamento com "Vitrine · PDV/balcão · Mesas"; "Tempo médio na rua" | ok |

- **Não deu para conferir na Menuzia:** a sacola e a compra, porque a vitrine da Menuzia está sem itens visíveis
  agora (produtos de teste pausados ou fora do horário). Esses eventos e o Purchase foram provados no teste local em 4
  navegadores (48/48).
- **Acompanhamento pós-deploy** (16:07–16:10, só leitura): nenhum pedido em nenhuma loja nem antes nem depois (horário
  calmo). As vitrines da Ponto 400, Estância e Villa respondem 200.
- Rollback não foi necessário.
