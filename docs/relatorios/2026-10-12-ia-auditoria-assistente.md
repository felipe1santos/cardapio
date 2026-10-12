# Relatório 12/10/2026 (madrugada) — IA do WhatsApp, auditoria "só na Menuzia", Assistente antigo, alarme pelo Assistente

Sessão das 00:30 às ~02:15 (Brasília). Tudo publicado na `main` e no Coolify ao fim de cada parte. Próxima migração livre: **0186**.

## Parte 1 — Agente de IA: troca de pagamento, pós-pedido e cancelamento

### Causas dos bugs do teste do Felipe (#287, 11/10 23:38–23:42, lido no banco)

| Bug | Causa raiz | Correção |
|---|---|---|
| Robô assumiu depois do pedido e leu "cartão na **entrega**, tô sem pix" como bairro | Ao criar o pedido a IA zerava `ia_desde`; a janela pós-pedido era de 15 min e o pedido de 23:41 já estava fora dela no código da época | Pós-pedido: 30 min com a IA ou até o pedido ser entregue/cancelado (Pix expirado NÃO encerra). Entrar no modo IA já limpava o estado do robô (`aplicar('ia')`) — confirmado |
| Resumo duplicado | O servidor mandava o resumo e o texto da IA junto ("Seu pedido está montado… Posso confirmar?") | `mensagensDaResposta`: quando o servidor responde (resumo, troca, atendente), o texto da IA não vai |
| "um refri" não achava | A busca só olhava nome/descrição | Grafias (`xburger`, `hamburguer`, `burguer` → "burger") e família/categoria ("refri" → Bebidas). Loja sem bebida: a ferramenta avisa e a IA diz que não tem |

### Regras novas (todas decididas no SERVIDOR — `lib/agente-ia/pos-pedido.ts`, `planoAlteracao`, puro e testado)

- Antes do "sim": qualquer mudança só refaz o resumo (testado: Item 7 → Item 1; cartão → Pix).
- Pedido Pix **não pago** → cartão ou dinheiro (pergunta o troco): cancela a cobrança no Mercado Pago e manda o pedido para o Kanban (avisos e push iguais aos do Pix confirmado). Cancelar Pix não pago: cancela cobrança e pedido.
- Cartão/dinheiro → Pix antes de aceito: Pix online só se o papel ainda não saiu (senão a cozinha prepara um pedido não pago → atendente); sem Pix online, a chave cadastrada (reimprime se já saiu papel).
- Pix **pago**, pedido já aceito, ou cancelar/itens/endereço com o pedido no Kanban → a IA NÃO faz: "Vou chamar alguém da loja pra te ajudar com isso, só um instante 🙏", conversa amarela no topo da central com o motivo ("Cancelamento do pedido #X" / "Alteração do pedido #X"), robô e IA pausados. Sem resposta da loja em 10 min → aviso único ao cliente (cron do WhatsApp).
- Pix da IA expirado → "Seu Pix do pedido #X expirou 😕 Quer que eu gere outro ou prefere pagar na entrega?" (no lugar do aviso genérico de cancelado); a resposta remonta o mesmo pedido e pede o "sim".

### Achados do teste real (corrigidos na hora)

1. **#289** — trocar Pix por cartão cancelava a cobrança, o webhook do MP chegava na hora e a conferência tratava como **Pix expirado** (cancelava o pedido e mandava a mensagem de expirado). Correção: `conferirPagamento` ignora "cancelled" de cobrança que nós mesmos marcamos como cancelada.
2. **#290** — a regra de transição do banco (0148) não deixava "aguardando Pix → recebido" sem pagamento nem nada voltar para "aguardando". **0185**: duas exceções só para o servidor.
3. Mesmo carrinho logo depois de um pedido cancelado devolvia o **cancelado** como "repetido" ("Pedido #290 anotado"). Agora só pedido vivo conta como duplicado.
4. Busca descartava números ("Item 1" trazia Item 7).
5. **O Haiku respondeu "Pedido confirmado" sem chamar `criar_pedido`** (nada foi criado). Agora "sim" claro depois do resumo cria o pedido no servidor, sem chamar a IA (custo zero). "sim, mas troca…" não confirma.
6. Alarme do Assistente parava 21 s depois do aceite quando o aceite acontecia durante a impressão (corrigido na espera longa).

### Conversa de teste (Menuzia, número do Felipe, injetada no webhook)

- 01:50 "Quero 1 Item 5 … no pix" → resumo (um só) → "Sim" → *#294 anotado* + código Pix (MP real).
- 01:51 "Desculpa é cartão na entrega, tô sem pix" → "Pronto! Troquei para *Cartão na entrega* e o pedido #294 já foi pra cozinha 👍" (cobrança `cancelled` no MP, pedido `preparando`, cartão).
- 01:45 Pix → "vou pagar em dinheiro" → "Precisa de troco? Para quanto?" → "Troco pra 50" → *#293* na cozinha com "Dinheiro (troco para R$ 50,00)".
- 01:29 #291 no Kanban → "Quero cancelar o pedido" → atendente, motivo "Cancelamento do pedido #291", "Alô? alguém?" sem resposta (pausado), aviso de 10 min às 01:40.
- 01:43 #292 no Kanban → "Troca o endereço…" → atendente, "Alteração do pedido #292".
- "um refri" → a IA achou a categoria Bebidas e ofereceu a Heineken. Loja sem bebida: coberto por teste de unidade (não alterei o cardápio da Menuzia).
- #295 no Pix sem pagar: venceu 02:08, às 02:10 chegou "Seu Pix do pedido #295 expirou 😕 Quer que eu gere outro ou prefere pagar na entrega?"; "Prefiro pagar na entrega no cartão" → resumo do mesmo pedido com cartão (não confirmei: ficou um resumo pendente nessa conversa).
- Pedidos de teste #289–#295: todos encerrados ("Não entregue" ou cancelados pelo próprio fluxo).

### Migrações

- **0184** (aplicada): `whatsapp_conversas.pediu_atendente_motivo` e `pediu_atendente_aviso_em` (nulas; nada muda nas conversas existentes). Rollback em `docs/rollback/`.
- **0185** (aplicada): `pedidos_transicao_valida` com as duas exceções do servidor. Ensaio em transação no banco de produção com 5 transições conferidas. Rollback = função da 0148.

### Custo medido

- 12/10 (Menuzia): **42 chamadas, US$ 0,0133** (≈ US$ 0,0006 por resposta da IA). Teto da loja US$ 0,50/dia; nenhuma API paga nova. O "sim" depois do resumo agora não chama a IA (economia).

### Extra — bairros de teste da Menuzia (NÃO apagados; aguardando o Felipe)

DASDAS (R$ 2,40), DASDSA (R$ 2,00), SADASD (R$ 3,00) e "jabururna" (R$ 2,50, duplicado de "Jaburuna" R$ 5,89). Ficam: Jaburuna, jardim asteca, jardim colorado.

## Parte 2 — Auditoria "só na Menuzia" (só levantamento)

Arquivo: `docs/auditoria-so-menuzia.md` (18 itens). Causa do carrinho/checkout "antigo": a vitrine nova já está em 9 das 10 lojas; o que só a Menuzia tem é a **fonte iFood** (`vitrine_fonte='ifood'`) e o **tamanho de foto 110** (ajustes da loja em Ajustes › Aparência; as outras ficaram no padrão), mais o Pix online (única com Mercado Pago). A **firehouse** está na vitrine clássica (loja nova nasce com `vitrine_nova=false`). Não é cache/PWA.

## Parte 3 — Assistente antigo

- Conferido 12/10 00:34: as 4 lojas que imprimem (Estância, Menuzia, Ponto 400, Villa) estão em "Cozinha e Caixa" com o Assistente novo dono da cozinha; o antigo já recebia lista vazia. Estância passou sozinha para o novo em 11/10 23:11 (#303 saiu pelo novo). Heartbeat "recente" na madrugada só a Menuzia (lojas fechadas); último pedido de cada loja foi impresso pelo novo.
- **Desligado no código**: o servidor não aceita mais token de loja (401 em pedidos/imprimir/diagnóstico/trabalhos, sem `?token=`); `/api/admin/impressao/token` GET nulo, POST 410; o painel parou de consultar o sinal do antigo a cada 8 s; link do 0.1.23 removido; "Retirar" do Super Admin não devolve loja "só novo" para "Somente teste" (a comanda pararia).
- **Não feito (bloqueado pela proteção de alterações em loja real, precisa do Felipe):** anular `impressao_agente_token` da Estância e marcar `impressao_somente_nova=true` na firehouse. Não são necessários para o desligamento (o servidor já recusa qualquer token antigo). O Assistente antigo ainda está instalado no PC da Estância e na Menuzia: só mostra erro, não imprime — pode desinstalar.
- O asset 0.1.23 continua no GitHub (apagar release é ação externa; não fiz). `public/guia-impressora.html` ainda descreve o antigo.

## Parte 4 — Alarme pelo Assistente (um alarme só)

- **Servidor**: a mesma consulta de pedidos do Assistente dono da Cozinha traz `alarme: { aguardando, numeros }` (regra do alarme do painel). Com `?alarme=N` a espera longa volta na hora quando a contagem muda. Nenhuma chamada de rede nova no ciclo (só um parâmetro).
- **Painel**: pergunta `/api/admin/pedidos/alarme-assistente` a cada 15 s; Assistente dono da Cozinha **1.2.0+ e online (< 30 s)** → painel mudo (só visual); offline, sem Assistente, versão antiga, Villa 1.1.0 ou erro → painel toca. Se o Assistente cair com pedido esperando, o painel toca na hora.
- **Assistente Alfa 1 1.2.0**: janela oculta toca o mp3 do instalador em repetição até aceitar/recusar (sem clique, mesmo com navegador fechado), notificação do Windows com o número, **volume 10–100%** e **"Testar alarme"** na tela. Rede caiu: para em 60 s (o painel assume).
- **Teste real na Menuzia** (1.2.0 instalado por cima no DESKTOP-BIE4TTM, pareamento mantido): #292 criado 01:42:10,7 → "Alarme tocando" 01:42:11 → aceito 01:42:18 → parado 01:42:39 (21 s; corrigido depois). Condição do painel conferida no banco (dono da cozinha, 1.2.0, 6 s sem sinal → painel mudo).
- **Alternância online/offline** (rota real do painel, sessão da Menuzia): Assistente ligado → `{"assistente":true}` (painel mudo); fechado → depois de 35 s `false` (painel toca); religado → `true` de novo.
- **Medição criado → início da impressão (Menuzia)**: 1.1.2 = 0,85 s (#291); 1.2.0 = 0,65 s (#292). Não piorou. Ressalva: a Menuzia imprime em "Microsoft Print to PDF", que às vezes trava ~60 s; durante a impressão o ciclo não consulta, então o alarme só para depois (com térmica normal, 3–8 s).
- **Entrega**: release `printer-agent-v1.2.0` (SHA-256 6016518f…8cf9) liberado no feed; o `latest.yml` só responde nas janelas 03:00–10:30 e 14:30–17:00 e o Assistente instala com a fila vazia. Villa fora (trava por computador + IP). Lojas que ainda não atualizaram seguem com o alarme do painel.
- **Risco a acompanhar**: depois da atualização, o som sai pela caixa do PC da impressora. Se esse PC estiver sem som/mudo, ninguém ouve (o painel fica mudo). Pedir às lojas para usar "Testar alarme" na primeira abertura.

## Parte 5 — Coolify

A `ANTHROPIC_API_KEY` de **Produção** já estava com Build time desmarcado e Runtime ligado — nada a mudar, sem redeploy por isso. A cópia de "Preview deployments" tem Build time marcado (não é usada; não mexi). Assistente da Menuzia continuou buscando pedidos e a IA respondendo durante todos os deploys.

## O que depende do Felipe

1. Apagar os bairros de teste (DASDAS, DASDSA, SADASD, jabururna)?
2. Autorizar anular o token antigo da Estância e `somente_nova` na firehouse (opcional); desinstalar o Assistente antigo dos PCs.
3. Decidir item a item da `docs/auditoria-so-menuzia.md`.
4. Acompanhar a primeira atualização para o 1.2.0 (Ponto 400/Estância) e o "Testar alarme" nas lojas.
