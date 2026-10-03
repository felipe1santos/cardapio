# Painel de Pedidos — avisos no topo, barra de botões e som de pedido novo (2026-10-03)

A lógica dos pedidos não mudou: aceitar, avançar, cancelar, aceite automático e impressão funcionam como antes.

## 1. Por que o som às vezes falhava (causa real)

| # | Causa | Efeito |
|---|---|---|
| a | **Autoplay bloqueado.** O áudio só destravava no primeiro clique depois de abrir a página. Com o painel recarregado (ou reaberto pelo navegador) e sem clique, o mp3 era recusado, e o bipe de reserva também saía em silêncio, porque o contexto de áudio continuava suspenso. Não havia aviso na tela. | **Principal.** Pedido chegava mudo até alguém clicar no painel. |
| d | **O pedido que já esperava ao abrir/recarregar nunca tocava.** A primeira leitura só gravava a lista de pedidos, sem som. | Quem recarregou com pedido na fila não ouviu nada. |
| g | **O alarme parava sozinho depois de 2 minutos**, mesmo sem ninguém aceitar. | Silêncio com pedido na fila. |
| e | **Um único `<audio>` reaproveitado.** Pedido novo no meio do alarme fazia `pause()` + `play()`, e o `play()` anterior era abortado. Dois pedidos juntos tocavam uma vez. | Toque perdido. |
| b | **Aba escondida / economia de energia.** A repetição usava `setInterval`, que o Chrome reduz a uma vez por minuto em aba escondida. A tela podia apagar. | Repetição atrasada. |
| c | **Volta da internet.** O tempo real reconectava e buscava os pedidos, mas o painel não reagia ao evento `online` do navegador e esperava o poll. | Atraso ao reconectar. |
| f | **Várias abas.** Cada aba tocava por conta própria. | Som duplicado, não falha. |
| — | Nenhuma falha de reprodução era registrada. | Sem rastro para investigar. |

O Chrome libera o áudio sem novo clique quando a pessoa **já clicou no mesmo site naquela aba** (ex.: no login). O
bloqueio acontece de verdade quando o navegador reabre com o painel restaurado ou quando a página fica aberta sem
nenhuma interação.

## 2. O que foi corrigido

**Som** (`components/pedidos/use-alarme.ts` + regras puras em `lib/alarme-pedidos.ts`):
- **Áudio:**
  - mp3 pré-carregado e decodificado no **Web Audio**, com uma fonte nova a cada toque: dois pedidos juntos dão dois
    sons;
  - bipe de reserva se o arquivo falhar;
  - tratamento de erro em todo toque.
- **Desbloqueio:**
  - qualquer clique ou tecla destrava;
  - enquanto estiver bloqueado aparece o aviso clicável **"🔇 Clique aqui para ativar o som dos pedidos"**;
  - assim que libera (pelo clique ou pelo próprio navegador), toca na hora o pedido que estava esperando.
- **Toca TODO pedido novo**, venha por tempo real, poll ou reconexão, e também o que já esperava quando o painel
  abriu. A internet voltar e a aba voltar a ficar visível disparam a busca na hora.
- **Repetição:**
  - ligada por padrão, a cada **15 s** (escolhe 10/15/30/60 s ou "Não repetir" em **Mais ⋯**);
  - repete enquanto houver pedido sem aceitar, **sem o corte de 2 minutos**;
  - **"Silenciar"** para a repetição do que já tocou, mas pedido **novo** toca normalmente. Vale para todas as abas.
- **Várias abas:** só uma toca cada pedido, e a repetição não duplica.
- **Notificação do navegador** com a aba escondida: já existia no layout do painel para todo pedido novo. Mantive essa
  e não dupliquei; o teste confere que sai **uma** notificação. "Mais ⋯" tem atalho para dar a permissão.
- **Wake Lock:** com o painel visível, a tela não apaga.
- O **estado do botão Som** fica salvo e é restaurado ao recarregar.
- **"Testar som"** em Mais ⋯.
- **Log no servidor:** cada falha (`autoplay_bloqueado`, `arquivo_indisponivel`, `erro_reproducao`…) vai para o log do
  Coolify com a loja, o motivo e o estado da aba (`/api/admin/pedidos/som-falha`). No máximo uma por motivo a cada
  5 min.

**Avisos** (`components/pedidos/avisos-pedidos.tsx`):
- A faixa amarela saiu. No lugar há um **ícone de alerta** na barra, com **badge âmbar** e a quantidade.
  - Sem avisos, o ícone fica neutro e sem badge.
  - Quando surge um aviso novo, o ícone pulsa por 4 s.
- O painel lista cada pedido aberto há mais de 12 h com **[Entregue] [Não entregue] [Cancelar]** e **"Ver no kanban"**.
  - "Não entregue" pede confirmação e cancela como não entregue.
  - "Cancelar" abre a janela de motivo de sempre.
  - "Ver no kanban" rola até o card e pisca a borda.
- **Faixas que continuam:**
  - erro de operação e recado da ação, que somem em 6 s;
  - o aviso clicável do som, que precisa de clique e por isso não pode ficar escondido num ícone;
  - a barra vermelha "Novo sistema de impressão", que é global do painel, não desta tela.

**Barra de controles** (`components/layout/topbar.tsx` ganhou `controles`):
- Fica logo depois do título, alinhada à esquerda, com divisor vertical, separada de impressão, Dúvidas e perfil.
- Botões de **44 px**, ícone + texto, sem caixa alta, **8 px** entre eles (medido).
- Som, Aceite auto e Métricas mostram **Ligado/Desligado** num selo e no tooltip.
- **Rotas** desligado tem tooltip com o motivo ("esta loja não trabalha com motoboy").
- **Status da loja** é um seletor verde/vermelho na mesma altura, com Manual/Automático.
- **Telas menores:** Métricas, Entregas e Tela cheia ficam soltos só em monitor largo (≥ 1800 px). Rotas fica solto a
  partir de 1536 px. Abaixo disso, tudo isso vai para **"Mais ⋯"**, junto com Testar som, repetição e notificações.
- A 1440 px tudo cabe numa linha. No celular, os controles quebram em linhas, sem rolagem lateral, e o menu fica
  dentro da tela.
- Esc fecha os menus e o painel de avisos.

## 3. Prints (`prints/`)
- **Antes:** `antes-desktop.png`, `antes-tablet.png`, `antes-celular.png` (faixa amarela "149 pedidos…", botões em caixa
  alta de 30 px).
- **Depois:**
  - `depois-desktop.png` (1920);
  - `depois-notebook.png` (1440);
  - `depois-tablet.png`, `depois-celular.png` (menu Mais aberto);
  - `som-bloqueado.png` (aviso clicável);
  - `avisos-icone.png`, `avisos-painel.png`.

## 4. Testes

`scripts/seguranca/e2e-kanban-topo.mjs`: **55/55**.
- **Ambiente:** loja local ordem-qr-e2e; Chrome com a política de autoplay "exige gesto"; o som é medido pelo contador
  de toques do Web Audio.
- **Barra:**
  - posição depois do título, com divisor, separada do sistema;
  - 44 px, 8 px, ícone + texto, sem caixa alta;
  - Ligado/Desligado no selo e no tooltip;
  - seletor de status;
  - notebook numa linha só;
  - tablet e celular sem rolagem lateral, com o "Mais" dentro da tela.
- **Som:**
  - painel reaberto sem clique: bloqueio detectado, aviso clicável, falha `autoplay_bloqueado` no log do servidor;
  - quando libera, toca o que esperava;
  - dois pedidos juntos = dois toques;
  - repete a cada 10 s sem parar em 2 min;
  - Silenciar para a repetição, e o pedido novo seguinte toca;
  - Testar som;
  - aba escondida: toca e mostra uma notificação;
  - internet cai, entra pedido, volta: toca;
  - duas abas: uma toca;
  - som desligado persiste depois de recarregar e não toca.
- **Avisos:**
  - neutro sem avisos, com o painel dizendo "tudo em dia";
  - a faixa saiu;
  - badge 3 → 4 com pulso;
  - painel com as 4 ações;
  - "Ver no kanban" destaca;
  - Entregue conclui;
  - Não entregue cancela com motivo `nao_entregue`;
  - Cancelar abre a janela de motivo.
- **Navegadores:** Edge e Firefox no desktop (barra, Testar som, pedido novo tocando); Chrome no tablet.

**Regressão:**

| Suíte | Resultado |
|---|---|
| impressao-v2 / aviso-nova-impressao | 40/40 · 34/34 |
| cozinha-fase5 / agendamento | 26/26 · 25/25 |
| pdv-pagamento / pdv-v2 / balcao-entrega | 57/57 · 70/70 · 84/84 |
| financeiro-fase3 / pedido-idempotente / regressao-release | 106/106 · 12/12 · 52/52 |
| responsivo-kanban / estabilidade-operacional | 24/24 · 53/53 (ver abaixo) |
| Vitest | 1948 ok |

Duas suítes antigas foram atualizadas para o comportamento atual:
- **responsivo-kanban:** ainda reclamava de "Pix/Dinheiro" no card, que aparece de propósito desde a 0135.
- **estabilidade-operacional:** procurava o botão "Rotas" solto a 1366 px; agora ele está no "Mais" (o teste confere o
  botão habilitado pelo identificador).

**Limite conhecido:** com a aba escondida por mais de 5 min, o Chrome reduz os timers a um por minuto, então a
**repetição** fica mais espaçada. O primeiro toque de cada pedido continua saindo na hora, junto com a notificação do
navegador. Para não perder nada, o painel visível com o Wake Lock é o ideal.

## Publicação (2026-10-03 ~17:50)
- Sem migration. main `eae254a`, Redeploy no Coolify, build novo no ar às ~17:49.
- **Conferência na Menuzia** (loja "Angus Burguer" e usuário "Administrador" confirmados antes de cada ação):
  - barra nova no topo: Recebendo pedidos (Manual), Som (Ligado), Aceite auto (Ligado), Rotas, Métricas, Entregas,
    Tela cheia, Mais;
  - a faixa amarela saiu;
  - ícone com "1 aviso": o painel lista o #144 (Carlos, pronto há 1 dia) com Entregue / Não entregue / Cancelar / Ver
    no kanban. Nenhuma ação foi feita nele;
  - som bloqueado detectado na aba aberta sem clique, com o aviso clicável na tela;
  - pedido TESTE #147 (PDV, retirada): o card apareceu e a falha `autoplay_bloqueado` foi registrada. A rota de log
    responde 204;
  - #147 e a comanda dele cancelados no fim.
- **Não deu para conferir em produção:** o "destravar pelo clique". A aba controlada pela automação fica em segundo
  plano e o clique dela não conta como gesto do usuário. Foi provado no teste local em Chrome, Edge e Firefox.
  - **Validar no balcão:** abrir o Painel de Pedidos, clicar no aviso amarelo (ou em qualquer lugar) e usar "Mais ⋯ ›
    Testar som".
- **Acompanhamento pós-deploy** (17:52–17:55, só leitura): nenhum pedido real em nenhuma loja nesse intervalo (horário
  calmo). As vitrines da Ponto 400, Estância e Villa respondem 200.
- Rollback não foi necessário.
