# Auditoria das travas + caça a loops + WhatsApp — 28/10/2026 (noite)

Pasta `cardapio-estab-main` (main). Publicado: `fe1c3bae` (travas) e `8d1948d9` (WhatsApp), deploy 23:07 BRT.
Medição: `pg_stat_statements` somando por `queryid`; tráfego por container com `nsenter`; testes só na loja Menuzia.

## Parte 1 — travas

| Trava | Funciona? | Falha aberta / fechada | Banco por requisição | Loop | Resultado |
|---|---|---|---|---|---|
| Pedido 15/min IP + 200/min loja | sim: 16º = 429 (testado em produção); X-Forwarded-For falso não escapa (Traefik reescreve) | **fechada**: era 15/min por IP no sistema todo → IP de operadora (CGNAT) somava lojas | não (memória) | não | **bug corrigido**: 15/min por IP **em cada loja**. Reinício zera; deploy = 2 containers por segundos (dobra) |
| WhatsApp evento repetido / 440-401 / 3 por hora | sim | — | evento repetido: 0 | 3/h para sempre | **trocado** pela regra da Parte 3 (3 tentativas no total) |
| Maps 60% por loja | sim (testado no banco): conta, barra só a loja, zera na virada do dia de Brasília | — | 1 RPC (já existia) | não | ok |
| umaPorVez (entregas, Pix) | 2 rodadas juntas: só 1 roda; erro solta | **fechada para sempre** se a rodada travar (chamada que nunca responde) → Pix/entregas paravam até reiniciar | não | não | **bug corrigido**: solta sozinha em 10 min; a rodada velha não solta a nova |
| Batida dos crons | sim | — | 1 gravação por cron por minuto = **540/h** | não | **corrigido**: 1 a cada 5 min por cron (~108/h) |
| Vigia | sim | 2 chamadas juntas passariam as duas | despacharPendentes 1 consulta/min | alerta: trava de 6 h no banco | **corrigido**: umaPorVez + pendentes só com aviso novo ou a cada 5 min |
| Pedido duplicado (duplo clique) | sim: mesma chave enquanto o carrinho não muda + índice único (0065) | — | — | — | ok |
| IA/áudio por loja | teto US$ 0,50/dia por loja (chamarIa) | — | — | não | ok (testes existentes) |
| Vídeo | 50 MB, 3 min, 20/h por loja | — | — | — | ok |

Testes novos: `lib/saude/cron.test.ts`, `lib/pedidos/limite-publico.test.ts`, `lib/custo/guarda.test.ts` (Maps por loja),
`lib/whatsapp-monitor*.test.ts`, `lib/mensageria/entrada-conexao.test.ts`, `lib/guardas/bundle-cliente.test.ts` (B6).

## Parte 2 — loops e gasto

- Sem laço ativo. Volume = nº de requisições (~530/min no jantar, ~1,5 KB cada), quase tudo Assistente de impressão
  (4 ligados). Não há média de 7 dias confiável: estatística do banco zerada em 23/10 e banco fora ~22 h em 27–28/10.
- Código (varredura completa): toda API paga passa pela guarda; nenhum retry sem limite que gaste dinheiro. Riscos médios
  que ficam para decisão: sincronização de corridas 1×/min por corrida ativa (cota de 600/dia é do sistema, sem teto por
  loja); reenvio de status aos canais (iFood/99) sem limite de tentativas; Pix com erro de API consultado todo minuto sem
  prazo; frete recalculado a cada digitação (até 3 geocodificações por endereço parcial). Hoje: 0 Pix presos, 0 erros de
  canal, 0 corridas ativas.
- APIs pagas hoje: geocoding 13, Mapas 10; IA US$ 0,00; sem Lalamove/Uber.

## Parte 3 — WhatsApp

Regra nova (`lib/whatsapp-monitor.ts`): desconectada (manual, 401, 440 ou 3 tentativas sem voltar) é marcada uma vez e
para — o cron não confere, o webhook ignora os eventos dela sem consultar o banco, sem reconexão, sem aviso repetido. Volta
ao ler o QR (evento "open" ou a tela de Integrações vê "open"). Reconexão só em queda momentânea, 3 no total. Sem faixa
vermelha, push ou alerta para a loja; o Super Admin recebe 1 aviso quando uma loja em uso cai sozinha.

| Loja | Evolution | Banco | Eventos 24 h / 7 d |
|---|---|---|---|
| Estância Burger | open | open | 12 / 36 |
| Ponto 400 | open | open | 8 / 78.464 (enxurrada de 27/10) |
| Villalanches | open | open | 4 / 34 |
| Nossa Cozinha | connecting (a Evolution insiste) | close (parada) | 0 / 7 |
| Burguer Max (Menuzia, teste) | close | close (parada) | 0 / 1 |
Instâncias sem loja no mesmo Evolution (outros projetos): nr13-leads, painel-engenharia, disparos, crm-numero-axial; e
menuzia-alertas (sem QR). Nada apagado.

Prova (webhook real da Menuzia, 200 eventos connecting/close 401/440/503/408 em 9 s): **3 consultas no total** (só o 1º
evento), 0 auditoria, estado segue "close", nenhuma conferência/reconexão na Evolution. Antes: ~5 consultas por evento.

## Antes → depois (janelas de 3 e 10 min, mesma noite)
| Fonte | Antes | Depois |
|---|---|---|
| Faixa vermelha do painel (leitura do estado do WhatsApp, por aba aberta) | 117/h (+ login de cada chamada) | 0 |
| Leituras do monitor do WhatsApp | 176/h | 60/h (1 por minuto, só lojas conectadas) |
| Batidas dos crons | 410/h | 66/h |
| Evento de conexão de loja desconectada | ~5 consultas cada | 0 (3 só no 1º evento) |
Depois do deploy: site 200, 4 Assistentes vivos, pedidos da Villa entrando e impressos.
