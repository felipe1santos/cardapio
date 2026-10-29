# Diagnóstico de custo e estabilidade — 29/10/2026 (somente leitura)

Nada foi alterado: só leitura de código, `SELECT` no banco (pg_stat_statements, tamanhos, permissões), `GET` na Evolution e
na API do Coolify, comandos de leitura na VPS e páginas do Supabase pelo Chrome. Única escrita: este arquivo.
Base: 5 lojas ativas, 926 pedidos em 30 dias (398 de entrega), medido em 28–29/10. Cotação usada: US$ 1 = R$ 5,50.

## 1. Resumo (português simples)
1. **Hoje o sistema aguenta com folga**: banco em 5–9% de CPU no pico, 25 de 120 conexões, 133 MB de 8 GB; egress ~7–16 GB/mês de 250.
2. O custo fixo é o **Supabase Pro (~R$ 140/mês)** + a VPS. As APIs pagas custaram **US$ 0,15 no mês** (IA); Google e entregadores dentro do grátis.
3. **Até ~15–20 lojas** usando entregador (Uber/Lalamove) o primeiro limite a bater **não é dinheiro**: é o teto diário de chamadas
   das APIs de entrega (600/dia para o sistema todo) — corridas novas passariam a ser recusadas. Ajuste de configuração.
4. **Até ~40–60 lojas** o banco (servidor Micro do Supabase) aguenta; depois precisa subir para Small/Medium (+R$ 30 a +R$ 275/mês).
5. **~100–140 lojas** o egress chega a 70–90% da cota → risco de bloqueio como o de 27/10 (o teto de gasto está LIGADO).
6. **O maior risco hoje é operacional, na VPS**: cada deploy deixa ~5 GB (imagem de 2,4 GB + cache) e nada limpa sozinho
   (disco 35% → 55% em 4 h, com 6 deploys); o build roda na mesma máquina de 2 núcleos que atende as lojas (CPU 88% no build);
   o app não tem healthcheck nem limite de memória.
7. Se o Supabase cair: vitrine e painel param, pedidos novos não entram (não se perdem — não são criados), a impressão retoma sozinha
   quando volta; pedidos do iFood/99 podem ser cancelados pelo app se a queda passar do prazo deles.
8. Não há laço ativo nem chamada paga repetida sem limite (verificado no código e nos números).
9. O volume do banco é fixo e não de clientes: ~118 req/min de madrugada, 580–787 no jantar; o Assistente de impressão é ~35% dele.
10. Falta um **monitor externo** (se a VPS cair, o vigia cai junto e ninguém é avisado).

## 2. Mapa de custos

| Recurso | Uso hoje | Limite (plano) | % | R$/mês hoje | 10 lojas | 30 lojas | 100 lojas |
|---|---|---|---|---|---|---|---|
| Supabase Pro (assinatura) | — | — | — | ~138 (US$ 25) | 138 | 138 | 138 |
| Compute (Micro, 1 GB) | CPU 5–9% pico, mem 63% livre | crédito US$ 10 cobre o Micro | — | 0 | 0 | +27 (Small) | +275 (Medium) |
| Egress (API) | ~7–16 GB/mês proj. (0,13 GB nas 1ªs 6 h do ciclo) | 250 GB | 3–6% | 0 | ~17 GB | ~50 GB | ~170 GB (68%) |
| Cached egress (fotos/CDN) | ~1,5 GB/mês proj. | 250 GB | <1% | 0 | 3 GB | 9 GB | 30 GB |
| Tamanho do banco | 133 MB (+~3 MB/dia) | 8 GB (depois US$ 0,125/GB) | 2% | 0 | 0 | 0 | ~+R$ 10–20 após 1 ano |
| Storage | 586 MiB | 100 GB | <1% | 0 | 1 GB | 3 GB | 10 GB |
| Realtime conexões | pico 6 | 500 | 1% | 0 | ~30 | ~90 | ~300 (60%) |
| Realtime mensagens | 377 em ~9 h | 5 milhões | 0% | 0 | 0 | 0 | 0 |
| Log ingestion | 0,13 GB | 20 GB | <1% | 0 | 0 | 0 | ~3 GB |
| MAU (Auth) | 3 | 100 mil | 0% | 0 | 0 | 0 | 0 |
| Disk IO (banco) | 4–7,5 op/s, 0,2 MB/s | linha base do Micro | baixo | 0 | — | — | atenção |
| VPS Hostinger KVM 2 | 2 vCPU, 8 GB, 4 GB swap (1 GB usado), disco 55% | — | — | fatura atual (renova 10/02/2027) | igual | trocar p/ KVM 4 | KVM 4/8 ou build fora |
| IA (Claude Haiku) | 463 chamadas, US$ 0,15/30 d | US$ 5/dia sistema, US$ 0,50/dia por loja | 0% | ~1 | ~2 | ~6 | ~20 (teto máx. ~825) |
| OpenAI áudio | 0 no mês | 200/dia + teto US$ | 0% | 0 | centavos | centavos | ~R$ 5 |
| Google Geocoding | 165/30 d | 300/dia (guarda); grátis até 10 mil/mês | 1–2% | 0 | 0 | 0 | 0 (~3,3 mil/mês) |
| Google Maps JS | 225/30 d | 150/dia (guarda); grátis até 10 mil/mês | 5% | 0 | 0 | 0 | **bate os 150/dia** |
| Directions | 6/30 d | 300/dia | 0% | 0 | 0 | 0 | 0 |
| Uber/Lalamove/Foody (API) | 51 chamadas/30 d | **600/dia sistema**, 360/dia por loja | 0–6% | 0 (a corrida é paga pela loja) | ok | **bate o teto** | bate |
| Mercado Pago | taxa na conta da loja | — | — | 0 (nosso) | 0 | 0 | 0 |
| Push (web-push/VAPID) | — | — | — | 0 | 0 | 0 | 0 |
| E-mail (Auth do Supabase) | poucos | SMTP padrão tem limite baixo por hora | — | 0 | 0 | atenção | precisa SMTP próprio |

**O que estoura primeiro conforme cresce:**
1. ~15–20 lojas usando entregador: teto de 600 chamadas/dia das APIs de entrega (cada corrida ~10–15 chamadas) — configuração.
2. Já hoje, a cada deploy: disco da VPS (imagens) e CPU da VPS durante o build.
3. ~40–60 lojas: compute Micro do Supabase (CPU/memória do banco, Realtime) → Small.
4. ~60–100 lojas: Maps JS 150/dia; Realtime ~300 conexões; Evolution ~1,5 GB de RAM (≈15 MB por instância).
5. ~100–140 lojas: egress 70–90% de 250 GB (com teto de gasto ligado = bloqueio).

## 3. Capacidade (por cálculo, sem teste)

| | Hoje (pico) | 3× | 5× |
|---|---|---|---|
| Requisições PostgREST/min | 580–787 (madrugada 118) | ~2.400 (40/s) | ~3.900 (65/s) |
| CPU do banco (Micro) | 9% | ~30% | ~45–50% |
| Conexões do banco | 25 / 120 (PostgREST usa 5) | ~30 | ~35 |
| CPU da VPS (app) | app ~8% de 1 núcleo; VPS 25–67%, 88% com build | app ~25% | app ~40% + build = saturada |
| Memória da VPS | 2,2 GB usados de 8 + 1 GB swap | ~3 GB | ~3,5 GB (build +2–3 GB) |
**Primeiro gargalo:** a VPS de 2 núcleos quando um deploy coincide com o pico (build + app + Evolution + 15 outros apps na mesma
máquina). O banco ainda tem folga a 5×.

## 4. Pontos de queda (o que acontece hoje), por gravidade

| Gravidade | Ponto | O que acontece hoje | Correção recomendada (não aplicada) |
|---|---|---|---|
| **Alta** | Supabase bloqueado (402, cota com teto de gasto ligado) | Vitrine mostra erro genérico, painel vazio, pedidos não entram (não se perdem: não são criados), impressão espera e volta sozinha; WhatsApp/robô não respondem (mensagens do período podem se perder); iFood/99 podem cancelar pedidos não confirmados | Alerta de 70%/90% já existe (estimado); monitor externo; página de "voltamos já" na vitrine; decidir teto de gasto (ligado = cai, desligado = cobra excedente) |
| **Alta** | Disco da VPS enchendo com imagens de deploy | 2,42 GB por imagem + cache; 9 imagens do Menuzia hoje; disco 55% (44 GB livres) | Limpeza automática do Docker no Coolify (manter 2–3 imagens) e/ou imagem enxuta (Next `standalone`, ~300 MB) |
| **Alta** | Build na mesma VPS das lojas | CPU 88% no build; app/Evolution lentos por 6–15 min por deploy | Deploy fora do pico; build em outro lugar (GitHub Actions → imagem pronta) ou VPS maior |
| Média | Sem healthcheck no Coolify ("Running (no healthcheck)") | Container travado (vivo mas sem responder) não é reiniciado; deploy ruim troca o bom sem checar | Ligar healthcheck HTTP em `/login` (ou rota `/api/saude` leve) |
| Média | App sem limite de memória | Um vazamento pode tomar a RAM da VPS e derrubar Evolution e os outros apps | Limite de memória no Coolify (ex.: 1,5 GB) |
| Média | Tudo numa VPS só (app, Evolution, n8n, ~15 apps de outros projetos) | Queda da VPS = tudo fora; outro projeto pode consumir CPU/RAM (ex.: build do NR13 em 23/10) | Separar o Menuzia (ou ao menos o Evolution) dos outros projetos |
| Média | Teto de chamadas das APIs de entrega (600/dia sistema) | Com ~15–20 lojas usando entregador, corridas novas recusadas pela guarda | Subir `LIMITE_UBER_DIA`/`LIMITE_LALAMOVE_DIA`… conforme a adesão (as chamadas são grátis; o teto é anti-laço) |
| Média | Funções SECURITY DEFINER executáveis por anônimo (15) / logados (20) | São gatilhos e ajudantes de permissão (para anônimo devolvem vazio) — sem vazamento visto | Revogar `execute` de `anon` nas que não são da vitrine |
| Média | `painel_analytics_vitrine` (dashboard) 559 ms em média, até 2,8 s | Cresce com `vitrine_eventos`; com 100 lojas pode estourar o timeout de 2 min | Índice/agregação por dia; retenção (já ligada em 13 meses) |
| Baixa | Evolution com enxurrada | Tratado em 28/10: evento repetido = 0 consulta; loja desconectada parada | — |
| Baixa | Conexões do banco / timeouts | 25/120; `statement_timeout` 2 min | — |
| Baixa | Chamadas a parceiros sem resposta | Todas com tempo máximo (iFood, 99, MP, Uber, Lalamove, Foody, Maps, IA), exceto criar/conectar/deslogar instância na Evolution (ação do lojista) | Pôr timeout nessas 3 |
| Baixa | Logs crescendo | Docker com rotação 10 MB × 3; journal 634 MB | — |
| Baixa | Políticas RLS permissivas sobrepostas (84 avisos), 24 FKs sem índice, 22 índices sem uso | Custo de CPU por consulta; hoje irrelevante | Revisar quando o banco passar de 30% de CPU |

### Assistente de impressão (maior fonte de requisições)
- Hoje: espera longa de 20 s em `pedidos` e em `trabalhos`; no erro, espera crescente até 30 s. Medido: ~9 requisições/min por
  Assistente, cada uma ~5–6 consultas (autenticação do agente, configuração, impressoras, rota da cozinha) ≈ **50 consultas/min por
  PC** → ~35% do banco no pico.
- Proposta (sem atrasar a impressão — quem acorda é o aviso em tempo real, não o relógio): espera longa de 20 → 50 s; guardar no
  servidor por 30 s a configuração/impressoras/rota por agente; com a loja fechada, `trabalhos` a cada 60 s. Estimativa: −60 a −70%
  das consultas do Assistente (~−20% do banco). Mexe no Assistente (regra do CLAUDE.md: medir criado→impresso antes/depois).

### Crons (10 no Coolify, todos com `$CRON_SECRET`, tempo máximo 120–300 s)
| Cron | Freq. | Trava contra dobra | Batida | Obs. |
|---|---|---|---|---|
| Robô WhatsApp (+ vigia de saúde) | 1 min | fila com `skip locked`; vigia `umaPorVez` | sim | monitor do WhatsApp sem trava (curto) |
| Disparo de mensagens | 1 min | reserva por RPC | sim | — |
| Push do app | 1 min | trava de 10 min por loja | sim | — |
| Canais externos | 1 min | **não** | sim | rodada lenta pode reenviar status/consultar corrida em dobro (baixo) |
| Entregas | 1 min | `umaPorVez` (solta em 10 min) | sim | timeout 120 s |
| Pix online | 1 min | `umaPorVez` | sim | — |
| Loja aberta/fechada | 1 min | memória | sim | — |
| Vigia financeiro | 15 min | não | sim | máx. 21 s (22/10) |
| Financeiro diário | 1 h | não | sim | — |
| Âncora diária | 1×/dia | não | sim | — |

### Loops / repetições que ainda existem (todos baixos, nenhum gasta sem limite)
- Áudio pode ser transcrito 2× numa reentrega do webhook (centavos; dentro do teto por loja).
- Tela do Pix do cliente consulta a cada 3 s mesmo com a aba escondida; vitrine clássica consulta o pedido com a aba escondida.
- Aviso de rastreio da corrida: webhook e cron ao mesmo tempo podem mandar 2 WhatsApps.
- Evento do iFood/99 tratado em dobro se chegar 2× ao mesmo tempo (importação protegida; status não).

## 5. Vigilância
O vigia (Super Admin › Saúde do sistema) cobre: requisições × média, egress **estimado**, banco, storage, CPU/memória/disco da VPS
(do próprio servidor), CPU/memória/disco/IO do banco (Prometheus oficial), APIs pagas e IA, crons parados, WhatsApp caído, bloqueio do
Supabase, alertas da guarda de custo.
**Falta:** (1) monitor externo — se a VPS cair, o vigia cai junto; (2) egress oficial (Supabase não tem API; requisições por tipo
precisam do `SUPABASE_ACCESS_TOKEN`); (3) Assistente de impressão **desligado com a loja aberta** (hoje ninguém é avisado);
(4) taxa de erros 5xx do app; (5) Evolution (memória e nº de instâncias); (6) conexões do banco e Realtime; (7) espaço que os
deploys vão ocupar (alerta só em 70% do disco); (8) Hostinger (precisa do `HOSTINGER_API_TOKEN`).

**Monitor externo gratuito recomendado:** UptimeRobot (grátis, 50 monitores, checagem a cada 5 min, alerta por e-mail e app no celular)
— ou Better Stack (grátis, 10 monitores, a cada 3 min). Como configurar (UptimeRobot):
1. uptimerobot.com → criar conta (você) → "Add New Monitor".
2. Monitor 1 — HTTP(s): `https://app.menuzia.com.br/loja/menuzia` (depende do banco: se o Supabase cair, ela falha), intervalo 5 min.
3. Monitor 2 — HTTP(s): `https://app.menuzia.com.br/login` (só o app).
4. Monitor 3 — Keyword: mesma URL da vitrine, palavra que sempre aparece no HTML (ex.: o nome da loja).
5. Contatos de alerta: seu e-mail + app UptimeRobot no celular (push). Opcional: Telegram.

## 6. Correções recomendadas (você escolhe)

| # | Correção | Risco | Esforço | Ganho |
|---|---|---|---|---|
| 1 | Monitor externo (UptimeRobot) — você cria a conta | baixo | 15 min | aviso mesmo com tudo fora |
| 2 | Limpeza automática do Docker no Coolify (manter 2–3 imagens) | baixo | 10 min | disco não enche com deploys |
| 3 | Healthcheck do app no Coolify (`/login`, 200) | baixo | 10 min | reinício automático; deploy ruim não sobe |
| 4 | Limite de memória do app (1,5 GB) | baixo | 5 min | um vazamento não derruba Evolution/VPS |
| 5 | Alerta "Assistente desligado com a loja aberta" no vigia | baixo | 1–2 h | impressão parada é avisada |
| 6 | Subir os tetos das APIs de entrega conforme adesão (variáveis no Coolify) | baixo | 5 min | corrida não recusada com 15+ lojas |
| 7 | Decidir o teto de gasto do Supabase (ligado = cai na cota; desligado = paga excedente US$ 0,09/GB) | médio | decisão | evita outro 27/10 |
| 8 | Assistente: espera longa 50 s + cache de 30 s da configuração no servidor | médio (mexe na impressão) | 1 dia + medição | −20% do banco |
| 9 | Imagem enxuta (Next `standalone`) e/ou build fora da VPS | médio | 0,5–1 dia | deploy sem travar as lojas; −2 GB por deploy |
| 10 | Página "voltamos já" na vitrine quando o banco falha (em vez do erro genérico) | baixo | 2 h | cliente não vê tela quebrada |
| 11 | `SUPABASE_ACCESS_TOKEN` e `HOSTINGER_API_TOKEN` (você cola) | baixo | 10 min | números oficiais na Saúde |
| 12 | Revogar `execute` de anônimo nas 15 funções SECURITY DEFINER internas; ligar proteção de senha vazada | médio | 2 h | menos superfície |
| 13 | `umaPorVez` nos crons de canais e WhatsApp; timeout nas 3 chamadas da Evolution sem prazo | baixo | 1 h | sem dobra em rodada lenta |
| 14 | Tela do Pix e vitrine clássica pausarem com a aba escondida | baixo | 1 h | menos requisições |
| 15 | SMTP próprio para e-mails do Auth (ex.: Resend grátis) | baixo | 1 h | reset de senha não trava com mais lojas |
| 16 | Separar o Menuzia (ou o Evolution) dos outros projetos da VPS / KVM 4 a partir de ~30 lojas | médio | 1 dia + custo | queda/consumo de um não derruba o outro |
| 17 | Otimizar `painel_analytics_vitrine` (agregado por dia) | médio | 0,5 dia | dashboard rápido com muitas lojas |
| 18 | Revisar políticas RLS sobrepostas e FKs sem índice | médio | 1 dia | CPU do banco quando crescer |

## 7. Se cair, faça isso
- **Site não abre (nenhuma loja):** 1) Coolify (187.77.34.112:8000) → app "APP CARDAPIO" → Logs; 2) botão **Restart** (ou Redeploy da
  versão anterior); 3) se o Coolify também não abre: hPanel da Hostinger → VPS → **Reiniciar**. Me chame com o horário.
- **Abre mas sem cardápio / painel vazio / erro "restricted":** supabase.com → organização MENUZIA → **Usage** e **Billing**. Se for cota:
  subir o plano ou desligar o teto de gasto (passa a cobrar excedente). Ver status.supabase.com.
- **Impressão parou:** 1) no PC da loja, abrir o Assistente (ícone perto do relógio) e ver se está "conectado"; 2) fechar e abrir;
  3) enquanto isso, imprimir pelo painel do pedido. Super Admin › Saúde mostra os Assistentes vivos.
- **WhatsApp parou numa loja:** a loja abre Integrações → **Conectar WhatsApp** e lê o QR. (Por regra, o sistema não reconecta sozinho.)
- **Deploy falhou:** a versão anterior continua no ar (o Coolify só troca se o build passar). Me mande o horário.
- **Disco cheio / build falhando por espaço:** Coolify → Servers → o servidor → **Docker Cleanup**.
- **Pedidos do iFood/99 não entram:** aceitar pelo app do iFood/99 enquanto isso; ver Integrações → iFood/99 (estado).

## Aplicado em 29/10 (madrugada, aprovado pelo dono) — pendências em [PENDENCIAS.md](../PENDENCIAS.md)
| # | Feito | Conferido | Plano de volta |
|---|---|---|---|
| 2 | Limpeza do Docker: já rodava a cada 6 h (forçada); app agora guarda **3** imagens (era 2) | disco 55% → 33% depois da limpeza das 06h UTC | `docker_images_to_keep` = 2 |
| 3 | Healthcheck `/api/vivo` (sem banco), 30 s, 3 tentativas | container **healthy**; curl existe no container | `health_check_enabled` = false |
| 4 | Limite 1,5 GB (sem swap extra) + `NODE_OPTIONS=--max-old-space-size=1200` (só execução) | heap 1.224 MB; uso 233 MB; healthy | `limits_memory` = 0 e remover a variável |
| 5 | Alerta "Assistente desligado com a loja aberta" (7 dias de uso, 15 min sem sinal) | testes; 0 hoje (lojas fechadas) | reverter commit `5dd938d1` |
| 6 | Tetos de entrega 600 → 3.000/dia (1.800 por loja) | sem variável sobrescrevendo em produção | `LIMITE_*_DIA` no Coolify |
| 10 | Vitrine: banco fora não vira "loja não encontrada"; error.tsx "Voltamos já" (tenta a cada 20 s) | loja inexistente segue 404; vitrine 200 | reverter `223e6360` |
| 13 | `umaPorVez` nos crons de canais e WhatsApp; prazo nas 3 chamadas da Evolution | crons batendo depois do deploy | reverter `788caa3e` |
| 14 | Tela do Pix e vitrine clássica pausam com a aba escondida e leem ao voltar | testes | reverter `1a18e59c` |
| — | `/` da VPS sem `discard` (agendado 03h30) | log ok=1; fstrim.timer ativo | `cp /root/fstab.antes-nodiscard /etc/fstab && mount -o remount,discard /` |
