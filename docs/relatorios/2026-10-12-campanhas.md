# Relatório 12/10/2026 — Campanhas: push grátis + disparos seguros + modelos integrados

Publicado: commit `e0323e2` (deploy finalizado 17:07, Brasília; app 200; Assistente seguiu buscando pedidos).
Migração **0190** aplicada (ensaio antes; rollback em `docs/rollback/0190_campanhas_seguras_push.down.sql`). Próxima livre: **0191**.
Nenhuma mensagem ou push de teste foi para cliente real: testes só na Menuzia, público = número/aparelho do Felipe.

## Parte 1 — Push grátis em todas as lojas
- `push_liberado` ligado nas 10 lojas e padrão `true` (loja nova já nasce liberada).
- Push saiu do módulo pago: rotas `/api/admin/campanhas/push*` livres (`lib/modulos.ts`), e em **Ajustes › Notificações do
  app** o push aparece para todas as lojas (antes pedia o módulo Disparos). Na Menuzia ("Novidades em teste") fica em
  Campanhas › Notificações do app.
- Limites: marketing só **09:00–21:30** (Brasília) e com a loja aberta; **1 notificação de campanha por dia** (o da loja,
  preso ao teto do Super Admin, padrão 1) — conferido na criação.
- Link da notificação com `utm_source=push&utm_medium=campanha` + `push=<envio>`: clique e pedido contam para a campanha.
- Vitrine: o convite já aparece no momento certo (depois do 1º pedido, na confirmação, e em Perfil › Notificações),
  nunca na entrada; iPhone fora do app instalado recebe a frase de como instalar. Não mudou.
- Já existia e foi conferido: criar/agendar, título, texto, imagem, destino (cardápio, produto, cupom, promoções),
  público (todos, comprou nos últimos X dias, sem comprar há X dias, fidelidade), estimativa de inscritos e relatório
  (enviadas, falhas, cliques, pedidos). Web push não informa "entregue" ao celular: "enviada" = aceita pelo serviço de push.
- **Super Admin › Gasto por loja**, fim da página: novo quadro **"Limites das campanhas"** (WhatsApp por dia, frequência por
  cliente, push por dia), com auditoria.

## Parte 2 — Disparos de WhatsApp com segurança (módulo pago; liberado na Menuzia)
- **Público só de quem já pediu** na loja (em todos os filtros): Todos que já pediram · Comprou nos últimos X dias ·
  Não compra há X dias · **Gastou acima de R$ X** (novo, total na loja). Quem respondeu SAIR nunca entra.
- **Rodapé obrigatório**: "Responda SAIR para não receber mais." (não dá mais para desligar).
- **Opt-out**: SAIR, PARAR, PARE, STOP, "não quero mais", "me tira/tire da lista", "me remove", "para de mandar"… +
  **CANCELAR** só para quem recebeu disparo nos últimos 7 dias (sem isso "cancelar" continua sendo do pedido). Grava o
  opt-out, confirma **uma vez** (repetido não responde de novo), cancela o que estava na fila e nunca mais inclui o
  número (avisos do próprio pedido continuam). Vale com o robô ligado ou desligado.
- **Variáveis**: {nome}, {loja}, {link_cardapio} (link rastreável: clique e pedido contam para a campanha), {ultimo_item}
  (1º item do último pedido; sem item, "seu pedido de sempre"). Botões para inserir e prévia com cliente de exemplo
  (Maria, último item X-Burger, nome real da loja).
- **Ritmo e janela** (no banco, `campanha_reservar_envios`): a loja escolhe a janela (padrão 17:00–19:00), sempre dentro de
  09:00–21:30; **1 mensagem por loja a cada 25–90 s** (aleatório); **limite diário** por loja (padrão 150, teto no Super
  Admin); o que sobrar **continua no dia seguinte** na mesma janela (a fila agora expira só 7 dias depois); **1 disparo por
  cliente a cada 3 dias** (Super Admin).
- **Freio**: pausa e avisa (alerta "campanha_pausada") com WhatsApp desconectado, erro > 5% ou SAIR > 3% dos enviados
  (a partir de 20 envios, para 1 erro em 3 não parar tudo). Desconexão volta sozinha ao reconectar; pausa manual ou do
  freio só volta pelo **Retomar**.
- **Botões**: Pausar, Retomar e Cancelar (inclusive pausada) na lista; motivo da pausa em português.
- **Relatório** da campanha: enviadas, falhas, respostas, **pediram SAIR** (novo), cliques, pedidos e faturamento.
- **Aviso fixo** na tela: "O WhatsApp alternativo pode bloquear números que mandam mensagem para quem não quer receber.
  Envie só para clientes, com moderação."
- Sem IA para reescrever mensagens (decisão do Felipe).

## Parte 3 — Modelos integrados
- Biblioteca única (Campanhas › Modelos na Menuzia; Ajustes › Modelos nas outras): modelo tem **título do push**
  (opcional) e mensagem; botões **No push** e **No WhatsApp** (este só com o módulo), **Duplicar**, Editar, Excluir.
- "No push" abre a notificação nova já preenchida (tira o que só o WhatsApp entende e corta em 200 caracteres).
- **Exemplos prontos** (Promoção do dia, Sentimos sua falta, Novidade no cardápio), sem preço inventado: viram modelo só
  quando a loja salva (nada foi gravado nas lojas).
- Botões de Campanhas conferidos e ligados: criar, editar, duplicar, excluir, usar modelo, agendar, pausar, retomar,
  cancelar, relatório. Corrigidos: aviso que mandava para "Ajustes" na Menuzia; cancelar campanha pausada; push preso ao
  módulo pago em Ajustes.

## Teste de ponta a ponta (Menuzia)

| Passo | Resultado |
|---|---|
| 1. Push | Único inscrito da Menuzia = Chrome do Felipe (final 4407). Notificação de campanha criada 17:09, **enviada 17:10** pelo ciclo normal. Toque (link aberto no Chrome) → **clique registrado** 17:10:34. Pedido **#303** feito a partir dela → **atribuído à notificação** (relatório conta como pedido gerado) e origem `push · campanha`. Fechado como **Não entregue** |
| 2. WhatsApp | Campanha com público = só 27 99253-4407, janela curta. **Enviada 17:12**: "Oi Felipe! Teste da campanha da Angus Burguer 🧪 Saudade do Item 3? Peça aqui: …/c/(link) — Responda SAIR para não receber mais." Resposta do cliente → **caiu na conversa da central** e o robô respondeu normal. "me tira da lista" → **opt-out gravado** + confirmação 1 vez; "SAIR" de novo → **sem 2ª resposta**. 2º disparo para o mesmo número → **cancelado** ("Cliente pediu para não receber (SAIR)"). Opt-out de teste **removido** |
| 3. Freio | Teste automático do ciclo de envio (`lib/mensageria/campanhas-freio.test.ts`, 4 casos): WhatsApp desconectado → pausa sem enviar; erro > 5% → pausa + alerta; SAIR > 3% → pausa; pausa manual não volta sozinha. Não derrubei o WhatsApp real da Menuzia de propósito (é o mesmo do Agente de IA) |
| 4. Limite e janela | Na função real do banco de produção, numa transação desfeita (`.medidas/teste-fila-disparos.mjs`, números fictícios): fora da janela não sai; 1 por chamada; pulou quem recebeu há 1 dia ("menos de 3 dias"); próxima em 25–90 s; limite diário atingido → nada sai e o resto fica para amanhã; voltando o limite → sai. Regras puras em `lib/mensageria/disparo-regras.test.ts` |

Testes: mensageria/push/robô/queries/auth 995 + freio 4 passando; tsc e lint limpos. **Semgrep não rodou** (Docker
desligado, PC de 8 GB).

## O que depende do Felipe
- Conferir no celular: a mensagem de WhatsApp das 17:12 (e a confirmação do opt-out) e, no Chrome deste PC, a notificação
  das 17:10.
- Limites em **Super Admin › Gasto por loja › Limites das campanhas** (hoje 150/dia, 3 dias, 1 push/dia).
- O limite diário por loja (abaixo do teto) ainda não tem tela: hoje 150 em todas.
- Pedidos vindos de push aparecem como origem "Outros" no gráfico (detalhe `push · campanha`); se quiser, crio a origem
  "Notificação do app" com ícone próprio.
- Campanhas › Modelos/Notificações aparecem só nas lojas com "Novidades em teste"; nas outras ficam em Ajustes (grátis).
