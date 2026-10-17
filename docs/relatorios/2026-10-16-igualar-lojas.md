# Igualar as lojas (16/10/2026)

**Regra fixa** (topo do CLAUDE.md e memória): tudo vale para todas as lojas, com o mesmo código e visual; o único
liga/desliga por loja é o **Super Admin** (`loja_modulos`: Financeiro, Agente de IA, Disparos; e a Impressão Alfa 1,
que já ficava lá). Módulo ligado = aparece e funciona, já ligado. Publicado em main `91490f0b` + migração **0196**
(aplicada depois do deploy; cópia em `backup.restaurantes_chaves_0196` / `backup.robo_ia_0196`, volta em
`docs/rollback/0196_tudo_para_todas.down.sql`). As chaves do Super Admin não foram mexidas.

## O que foi unificado

| Antes | Agora (todas as lojas) |
|---|---|
| "Novidades em teste" (`novidades_teste`, só Menuzia) | Acabou: coluna apagada, coluna e botão "Liberar novidades para todas" saíram do Super Admin |
| Menu antigo nas outras lojas | Menu reorganizado (visual novo do menu, Impressão e Agente de IA fora do menu principal) |
| Impressão no menu | Em Ajustes › Impressão (o endereço antigo `/admin/impressao` leva para lá). Só mudou o lugar da tela; nada na impressão |
| Agente de IA no menu | Em Ajustes › Agente de IA (o endereço antigo leva para lá); cadeado sem o módulo |
| Modelos de mensagem e Notificações do app em Ajustes | Em Campanhas (os links antigos levam para lá) |
| Tela Pedidos (finalizados/entregadores) antiga | A nova (resumo numa linha, lista de entregadores nova) |
| Perfil "Caixa" sem o KDS | Perfis prontos com o KDS (Cozinha = KDS; Caixa = PDV, Painel de Pedidos e Mesas) para novos funcionários |
| Kanban da Menuzia com card novo (13/10) e painel no mesmo visual | **Igual às outras lojas** (card e painel de antes). Card novo e Kanban v3 cancelados e apagados do código |
| `pdv_v2` em 6 lojas | PDV v2 em todas (DB Doces, Nossa Cozinha, W Lanches e Firehouse sem pedidos nem comandas nos últimos 14 dias) e padrão para loja nova |
| `financeiro_ativo` falso na Firehouse (trava escondida) | Verdadeiro em todas; quem decide o Financeiro é só o módulo do Super Admin |
| Agente de IA: módulo liberado mas interruptor desligado (Ponto 400, Estância, Villa) | Ligado onde o módulo está liberado (Menuzia, Ponto 400, Estância, Villa); padrão do interruptor = ligado; liberar o módulo no Super Admin liga junto. Teto: US$ 0,50/dia por loja (padrão) e US$ 5/dia no sistema, editáveis no Super Admin |
| `vitrine_nova`, `push_liberado`, `impressao_somente_nova` | Já verdadeiras nas 10 lojas, padrão verdadeiro para loja nova (conferido no banco) |

Ficou de propósito: o Dashboard da Menuzia mostra os pedidos de teste (`LOJAS_DE_TESTE`); nas lojas reais eles são
escondidos. Escolhas de negócio de cada loja (horário, cardápio, cores, taxas, aceite automático, mesas, despacho
automático, agendamento, controle de caixa nível 2) não foram tocadas.

## Conferência (só olhando)

- **Menuzia** (Playwright, sessão do Felipe): menu reorganizado sem Impressão/Agente; Kanban com o card de antes
  (0 cards novos); Ajustes com Impressão e Agente de IA ("Ligado", US$ 0,50/dia); Pedidos e Campanhas abrindo.
  Prints em `.shots/igualar/` (fora do git).
- **Ponto 400 e Estância**: sem sessão de painel delas; conferido pelo banco e pelo código. Mesmas chaves de tela nas
  10 lojas (nenhuma loja com `vitrine_nova`/`push_liberado`/`pdv_v2`/`financeiro_ativo`/`impressao_somente_nova`
  diferente) e o código não tem mais nenhum ramo por loja. Módulos (Super Admin): as duas com Financeiro, Agente de IA
  e Disparos liberados; Agente de IA agora ligado nas duas (Ponto 400 e Estância com chave Pix cadastrada).
- Vitrines de Menuzia, Estância e Ponto 400 respondendo (200, < 2 s) e pedidos seguindo normalmente.

## Junto (mesmo deploy)

- **Vitrine "fechada" com a loja aberta**: o HTML da vitrine vem do cache (60 s) e a página fica aberta no celular.
  Agora a vitrine confere a loja ao abrir e, visível e fechada, de minuto em minuto (`lib/loja-ao-vivo.ts`). A conta é
  a mesma do robô, da IA e do pedido (`lojaEstaAberta`).
- **Robô**: chave Pix numa mensagem separada (com o valor do pedido em aberto; sem chave → atendente); resumo que a
  vitrine abre no WhatsApp confirma o pedido sem mandar o link; "tá trabalhando / funcionando / vai abrir / já abriu /
  tá entregando ainda" → aberto agora + horário. Teste real na Menuzia com o número do Felipe: 5 de 5.
