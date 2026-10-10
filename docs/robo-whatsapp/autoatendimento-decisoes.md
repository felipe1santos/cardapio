# Robô de autoatendimento por palavras-chave — decisões (10/10/2026)

Pedido do dono (10/10, noite): robô sem IA e sem token, por palavras-chave, para o WhatsApp. Ele saiu e pediu
que eu decidisse sozinho pelo mais seguro e registrasse aqui. Método: `grilling` (árvore de decisões), cada
pergunta resolvida com os padrões do pedido. Nada aqui foi confirmado pelo dono ainda.

## Fatos levantados antes de decidir

- Já existe o **robô v1** (0103/0105/0107/0116): webhook → `whatsapp_registrar_entrada` (decide no banco, sob trava)
  → fila `whatsapp_envios` → Evolution. Menu 0–5 (2 = atendente). Ligado hoje em **Estância, Ponto 400 e Villa**
  (`robo_ativo=true`); desligado na Menuzia.
- Não existe campo de chave Pix, nem de tempo de entrega, nem formas de pagamento por loja (a vitrine oferece Pix,
  cartão e dinheiro sempre).
- "SAIR"/"PARAR"/"VOLTAR" (mensagem inteira) já descadastra das campanhas (0112).
- Mensagens de status do pedido: `lib/mensagens-automaticas.ts` (`restaurantes.mensagens_status`, com "Restaurar padrão").

## Decisões

| # | Dúvida | Decisão (e por quê) |
|---|---|---|
| D1 | Robô novo substitui o v1? | **Não substitui à força.** Interruptor próprio `autoatendimento_ativo` (padrão **desligado**). Ligado → o robô novo responde; desligado → o v1 continua exatamente como hoje. Estância/Ponto 400/Villa não mudam nada. |
| D2 | Mexer na função SQL do v1? | **Não.** Função nova `whatsapp_auto_entrada` só para lojas com o autoatendimento ligado. A do v1 fica intacta (risco zero para as lojas reais). |
| D3 | Onde decidir a resposta? | Classificador e máquina de estados **puros em TypeScript** (testáveis, e o simulador usa o mesmo código sem enviar nada). O banco faz o que exige trava: gravar a mensagem, reentrega, loja assumiu, silêncio, proteção contra loop e limites. Depois, `whatsapp_auto_aplicar` grava o estado novo da conversa. |
| D4 | Pausa do "atendente" e da resposta manual | 1 h **sem mensagens** na conversa (conta da última mensagem ou do silêncio, o que for mais recente), ou até reativar no painel. Assim o robô não entra no meio de um atendimento longo. |
| D5 | "parar" | Silencia aquela conversa sem prazo (motivo `parar`) até o cliente mandar "voltar" ou a loja reativar. Como "parar"/"voltar" já descadastram das campanhas (0112), as duas coisas acontecem juntas. |
| D6 | Saudação 1×/6 h | Coluna própria `auto_saudacao_em`. Uma saudação repetida dentro das 6 h recebe o menu curto, sem "bom dia". |
| D7 | Entrega sem bairro | Pergunta o bairro e guarda o estado `aguardando_bairro` por 15 min. A próxima mensagem que não for outro assunto é lida como bairro. Bairro não encontrado → aviso + lista com as taxas, e o estado continua (mais uma tentativa). |
| D8 | Tempo de entrega | Não existe no sistema. Campo novo na configuração do robô (`tempo_entrega`, texto livre, ex.: "40 a 60 min"). Vazio → a resposta mostra só a taxa. |
| D9 | Chave Pix | Campos novos em `restaurantes`: `pix_chave` e `pix_chave_tipo` (cpf, cnpj, telefone, email, aleatoria), editáveis em **Ajustes**. Sem chave → o robô não menciona Pix. A chave sai **sozinha** numa 2ª mensagem. |
| D10 | Formas de pagamento | Sem configuração por loja: o robô diz o que a vitrine aceita (Pix, cartão e dinheiro na entrega), tirando o Pix quando não há chave nem Pix online. |
| D11 | Status com mais de um pedido aberto | "Aberto" = recebido, preparando, pronto, em rota (de hoje ou de ontem). 1 → status. 0 ou mais de 1 → pede o número do pedido e guarda o estado `aguardando_numero` (15 min). O número só vale para pedidos daquele telefone. |
| D12 | Não entendeu | 1ª vez → menu completo + link. 2ª vez **seguida** → transfere para atendente (igual à opção 0). |
| D13 | Assunto desligado pelo dono | É tratado como "não entendeu" e some do menu. |
| D14 | Proteções novas | No máximo 5 respostas/min por conversa; limite por loja de 60 respostas/min; a mesma mensagem 3× seguidas → silencia (motivo `protecao`, é outro robô). Grupo, status, lista de transmissão e mensagens da loja continuam filtrados como no v1. |
| D15 | "Digitando..." | O envio do robô novo leva `delay` de 1,2 s na Evolution (mostra "digitando" e só então envia). Sem chamada extra. |
| D16 | Registrar intenção | Coluna `intencao_robo` em `whatsapp_mensagens` (toda mensagem do cliente no modo novo) + `acao_robo` (já existe). |
| D17 | Perguntas não entendidas | Tabela `whatsapp_auto_nao_entendidas` (texto normalizado, contagem, último em), apagadas após 30 dias. "Ensinar" = adiciona o texto às palavras extras do assunto escolhido e marca como ensinada. |
| D18 | Formatação nova nos modelos de status | **Revisada durante o trabalho.** Um teste de guarda já existente (`lib/mensageria/robo-flag.test.ts`) proíbe o aviso de status do pedido de ler a configuração do robô: o aviso tem que sair mesmo se o robô quebrar. Respeitei a guarda: o código de status ficou igual. Os modelos novos estão em `PADRAO_FORMATADO` (`lib/mensagens-automaticas.ts`) e foram gravados como **texto próprio só da Menuzia** (Campanhas › Mensagens automáticas; "Restaurar padrão" volta ao antigo). Para levar a outra loja: o dono cola o modelo, ou se decide trocar o padrão de todas. |
| D19 | Tela | "Robô de atendimento" em Integrações (card do WhatsApp → página própria): interruptor geral e por assunto, textos com prévia estilo WhatsApp, palavras extras, tempo de entrega, simulador (não envia nada) e "Perguntas que o robô não entendeu". |
| D20 | Alerta "Cliente pedindo atendente" | Faixa no Painel de Pedidos com nome e número, consultando o servidor a cada 20 s só com a aba visível (servidor próprio, sem API paga). Botão "Reativar robô nesta conversa". |
| D21 | Liberação | Migração com o autoatendimento **desligado em todas as lojas**; ligado só na Menuzia. O robô v1 (`robo_ativo`) não foi tocado em loja nenhuma (Menuzia continua com o v1 desligado: o autoatendimento conta como robô ligado por conta própria). Estância/Ponto 400/Villa: nada muda. |
| D22 | Teste real | Só pelo WhatsApp da Menuzia, se conectado. Nada é enviado a clientes de loja real. |
| D23 | "ok", "obrigado", 👍 | Mensagem inteira de agradecimento/confirmação não recebe resposta e não conta como "não entendi" (senão o "obrigado" do cliente viraria menu e, na 2ª vez, atendente). |
| D24 | Ordem das mensagens | Achado no e2e: a fila enviava a chave Pix antes do texto (o banco devolve o lote sem ordem). Corrigido ordenando o lote por criação em `processarFila` (vale para todos os envios da fila, que antes tinham a mesma falha latente). |
