# Sistema mais leve — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cortar as requisições que o sistema faz "sozinho, o tempo todo" (Assistente de impressão, telas do painel, vitrine) e o peso das builds na VPS, sem mudar nenhuma função para o lojista nem para o cliente.

**Architecture:** tudo do lado do servidor ou da tela — o programa do Assistente instalado nas lojas **não muda** (regra do CLAUDE.md). Três frentes: (A) servidor do Assistente grava/consulta só quando algo mudou; (B) leituras periódicas das telas pausam com a aba escondida ou viram "sob demanda"; (C) VPS: limpeza de imagens e imagem `standalone`.

**Tech Stack:** Next.js 15 (App Router), Supabase (PostgREST, Realtime, RPC), Vitest, Coolify (Docker), VPS Hostinger.

**Spec:** conversa de 29/10/2026 + [diagnóstico 29/10](../../relatorios/2026-10-29-diagnostico-custo-estabilidade.md) + [PENDENCIAS](../../PENDENCIAS.md) (itens 8 e 9).

## Global Constraints

- Programa do Assistente (`printer-agent/`) não é alterado nem republicado.
- Folha de impressão (layout do recibo) não muda; só disparo/consulta.
- Medir "pedido criado → impresso" antes e depois de toda tarefa da frente A; não pode piorar (docs/impressao/REGRA-CICLO-SEM-REDE.md).
- `npm run checar` passando antes de todo deploy; deploy só antes das 11h ou depois das 23h (BRT).
- Testes só na Menuzia (slug `menuzia`); Villa Lanches fica fora de qualquer teste de impressão.
- Cache sempre com a loja (`restauranteId`) na chave.
- Nada que decide **quem imprime** (destino da Cozinha, `impressaoAutomatica`, reserva) pode vir de cache sem invalidação na hora.
- O alarme de pedido novo (`components/admin/alarme-global.tsx`) continua tocando com a aba escondida — não pausar os relógios dele.
- Código com `\` só por Edit/Write (B1/B4).

## Review Focus

1. Loja troca a impressora da Cozinha e imprime em seguida → a ficha sai na NOVA, nunca na antiga nem nas duas (Task 5 tem o teste).
2. Impressora desligada/removida do Windows → o painel ainda mostra "não encontrada" em até ~1 min (Task 2 tem o teste: lista mudou = grava na hora).
3. Assistente fechado → painel mostra "sem sinal" em até ~40 s e o vigia avisa em 15 min, como hoje (Task 6).
4. Aba do painel em segundo plano por horas e volta → tela atualiza na hora ao voltar, sem esperar o próximo relógio (Task 7).
5. Cliente com pedido em andamento na vitrine → status continua atualizando (8/15 s); só quem NÃO tem pedido ativo para de consultar (Task 8).

---

## Fatos medidos (base do plano)

| Fonte | O que faz hoje | Arquivo |
|---|---|---|
| Lista de impressoras | Cada PC manda as impressoras do Windows **a cada 60 s**; o servidor autentica (gravação), faz upsert de todas, e para CADA impressora grava o diagnóstico e lê a largura (2 consultas × nº de impressoras, contando PDF/XPS/Fax) e ainda roda `tentarPassarParaNovo` | `printer-agent/src/main.js:689`, `app/api/agente/impressoras/route.ts`, `lib/impressao/servico.ts:557-582` |
| "Tem pedido?" | ~3/min por PC (espera de 20 s); ~15 consultas por volta; a lista `impressoras` vai em toda resposta, mas o Assistente só usa quando há pedido | `app/api/agente/pedidos/route.ts`, `printer-agent/src/main.js:271-276` |
| Despertador | Aviso de pedido acorda também a espera de **trabalhos** (mesma lista por loja); cada aviso refaz a conferência de dono 3× (0 / 0,4 / 1,2 s) | `lib/impressao/despertador.ts` (`avisar`, `esperarComBusca`) |
| Sinal de vida | A autenticação grava `visto_em` em **toda** chamada (~7/min por PC); "online" = sinal < 30 s | `supabase/migrations/0159_*.sql:41-42`, `lib/impressao/regras-modo.ts:18` |
| Telas | 13 relógios do painel não pausam com a aba escondida; os maiores: aprovações 10 s, Assistente-alarme 15 s, dinheiro com motoboys 15 s, Impressão 5 s, conta da mesa 5 s | relatório da varredura (abaixo, Task 7) |
| Builds | 5 imagens do Menuzia (2,42 GB cada no papel), cache de build 4,3 GB (3,5 GB livres), disco 36% | VPS, `docker system df` em 29/10 |
| Limite do Assistente | Desiste da pergunta em 35 s e sempre manda `esperar=20` → espera > ~30 s exige Assistente novo | `printer-agent/src/main.js:245,614` |

**Revisão do que eu disse antes:** o "cache de 30 s da configuração e do destino" NÃO entra como estava: a primeira busca da espera (`let lista = await buscar()`) roda sem a conferência de dono, então destino velho em cache poderia reservar a ficha para o computador antigo. O ganho grande vem das Tasks 2–6; o cache fica restrito à lista de impressoras (enfeite), que passa a ser lida só quando há pedido.

---

### Task 0: Medir a base (sem mudar nada)

**Files:** Create: `scripts/saude/medir-assistente.mjs` (só leitura; saída no scratchpad, nunca no repo — repo público)

- [ ] **Step 1:** script lê `pg_stat_statements` (somando por `queryid`, todos os papéis — lição de 28/10) duas vezes com 30 min de intervalo e imprime consultas/min das 15 maiores, marcando as das tabelas `impressao_agentes`, `impressao_dispositivos`, `impressao_trabalhos`, `impressao_funcoes`, `pedidos`.
- [ ] **Step 2:** consulta `impressao_agentes` (não revogados, sinal < 7 dias) agrupado por `versao` → quantos PCs no antigo × novo, e quais lojas.
- [ ] **Step 3:** 5 pedidos de teste na Menuzia fora do pico; anotar "criado → impresso" (mediana) no relatório do dia.
- [ ] **Step 4:** registrar os 3 números em `docs/relatorios/2026-10-30-sistema-mais-leve.md`. Commit.

### Task 1: Limpar builds antigas da VPS

**Files:** nenhum (operação). Registrar no relatório do dia.

- [ ] **Step 1:** `docker images` do app `co0swg8ko4scg0g4ssgwosww` → confirmar qual está rodando (`docker ps`) e manter ela + as 2 anteriores.
- [ ] **Step 2:** `docker rmi` só das tags mais antigas que essas 3; `docker builder prune -f --filter until=24h`.
- [ ] **Step 3:** verificar: `df -h /` (esperado ≈ 30%), `curl https://app.menuzia.com.br/api/vivo` = 200, `docker ps` com o app `healthy`. Imagens de outros projetos: não tocar.

### Task 2: Lista de impressoras só grava quando muda (+ botão "Atualizar lista")

**Files:**
- Create: `lib/impressao/descoberta-memo.ts`, Test: `lib/impressao/descoberta-memo.test.ts`
- Modify: `app/api/agente/impressoras/route.ts`
- Create: `app/api/admin/impressao/atualizar-lista/route.ts`
- Modify: `components/impressao/painel-impressao.tsx` (botão)

**Interfaces:**
- Produces: `precisaGravarDescoberta(agenteId: string, nomes: string[], diagnosticos: unknown, agora?: number): boolean` — `true` se a assinatura (nomes ordenados + diagnósticos saneados, JSON) mudou desde a última gravação deste agente ou se passaram ≥ 30 min (`DESCOBERTA_RENOVA_MS = 30 * 60_000`); `marcarDescobertaGravada(agenteId, nomes, diagnosticos, agora?)`; `esquecerDescoberta(agenteId?: string): void` (sem argumento = todos).

- [ ] **Step 1: testes que falham:** `mesma lista 2× em 60 s → 2ª false`; `impressora a mais/a menos → true`; `diagnóstico mudou (papel 58→80) → true`; `31 min depois → true`; `esquecerDescoberta(id) → true na próxima`; `agentes diferentes não se misturam`.
- [ ] **Step 2:** `npx vitest run lib/impressao/descoberta-memo.test.ts` → FAIL.
- [ ] **Step 3:** implementar (Map em memória por processo, limite de 2.000 agentes).
- [ ] **Step 4:** na rota POST: depois de `identificarAgente`, se `!precisaGravarDescoberta(...)` → `{ ok: true, total: nomes.length, semMudanca: true }` sem chamar `descobrir`; senão `descobrir` e `marcarDescobertaGravada` só se `r.ok`.
- [ ] **Step 5:** antes de mudar, confirmar quem lê `impressao_dispositivos.visto_em` (`grep -rn "visto_em" lib/impressao components/impressao`): se alguma regra usa esse campo com prazo < 30 min, baixar `DESCOBERTA_RENOVA_MS` para metade desse prazo e registrar.
- [ ] **Step 6:** rota admin `POST /api/admin/impressao/atualizar-lista` (mesma checagem de papel das outras rotas de `app/api/admin/impressao/`): chama `esquecerDescoberta()` dos agentes da loja e responde `{ ok: true }`. Botão "Atualizar lista de impressoras" no card do computador: após clicar, mostra "A lista chega em até 1 minuto" e o relógio da tela (Task 7) lê de novo em 60 s.
- [ ] **Step 7:** `npm run checar`; commit `perf(impressao): lista de impressoras só grava quando muda`.
- Ganho esperado: de ~15–20 consultas/min por PC para ~0 nessa rota (só a autenticação).

### Task 3: Resposta de "tem pedido?" sem a lista de impressoras quando não há pedido

**Files:** Modify: `app/api/agente/pedidos/route.ts`; Test: `app/api/agente/pedidos/route.test.ts` (criar se não existir; seguir o padrão de mocks de `lib/impressao/despertador*.test.ts`)

- [ ] **Step 1:** confirmar no Assistente antigo e no novo que `data.impressoras` só é usado depois de `if (!pedidos || pedidos.length === 0) return` (`printer-agent/src/main.js:271-276`; procurar outros usos em `printer-agent/src/*.js`). Se algum uso aparecer antes desse ponto, PARAR esta task e registrar.
- [ ] **Step 2: teste que falha:** `sem pedido → listarImpressoras não é chamado e a resposta traz impressoras: []`; `com pedido → traz a lista`.
- [ ] **Step 3:** tirar `listarImpressoras` do `Promise.all` inicial; ler depois de `pedidos`, só se `pedidos.length > 0`, com `comCacheDaLoja('impressoras', ...)` (60 s, já existe). Manter a chave `impressoras` sempre presente (vazia) no JSON.
- [ ] **Step 4:** teste passa; `npm run checar`; commit.

### Task 4: Despertador separado por tipo (pedido não acorda trabalho)

**Files:** Modify: `lib/impressao/despertador.ts`, `app/api/agente/pedidos/route.ts`, `app/api/agente/trabalhos/route.ts`; Test: `lib/impressao/despertador.test.ts`

**Interfaces:**
- Produces: `type TipoAviso = 'pedidos' | 'trabalhos'`; `esperarNovidade(restauranteId, ms, sinal?, tipo: TipoAviso = 'pedidos')`; `esperarComBusca(restauranteId, segundos, sinal, buscar, aindaVale?, devolverJa?, tipo: TipoAviso = 'pedidos')`. Ouvintes por chave `${tipo}:${restauranteId}`. INSERT em `impressao_trabalhos` avisa `trabalhos`; mudança em `pedidos` avisa `pedidos`.

- [ ] **Step 1: testes que falham:** `aviso de pedido não acorda espera de trabalhos`; `INSERT de trabalho não acorda espera de pedidos`; os testes atuais de despertador continuam verdes.
- [ ] **Step 2:** FAIL → implementar → PASS. Rota de trabalhos passa `'trabalhos'`.
- [ ] **Step 3:** na Menuzia: pré-conta e teste de impressão saem na hora; pedido novo imprime na hora. Medir criado→impresso.
- [ ] **Step 4:** `npm run checar`; commit.

### Task 5: Uma conferência de dono por aviso (não três)

**Files:** Modify: `lib/impressao/despertador.ts` (`esperarComBusca`); Test: `lib/impressao/despertador.test.ts`

- [ ] **Step 1: testes que falham:** `um aviso sem novidade chama aindaVale 1 vez e buscar até 3 vezes`; `aindaVale false no aviso → devolve [] e não chama buscar`; **Review Focus 1:** `dono muda durante a espera → nada é reservado para o antigo` (teste que já existe deve continuar verde — localizar e citar no commit).
- [ ] **Step 2:** FAIL → implementar: `aindaVale()` só na 1ª busca depois do aviso; as de 0,4 s e 1,2 s chamam só `buscar()` → PASS.
- [ ] **Step 3:** `npm run checar`; Menuzia: trocar a impressora da Cozinha e imprimir em seguida → sai na nova. Medir criado→impresso. Commit.

### Task 6: Sinal de vida gravado no máximo a cada 10 s

**Files:** Create: `supabase/migrations/0234_agente_visto_em_10s.sql`; Test: `lib/impressao/regras-modo.test.ts` (só confere que `ONLINE_MS` continua 30 000)

- [ ] **Step 1:** copiar a versão **atual** de `impressao_agente_autenticar` do banco (`pg_get_functiondef`) — não da 0159, que pode ter sido trocada depois — e recriar com `create or replace`, mudando só o `update ... set visto_em = now()` para acontecer quando `visto_em is null or visto_em < now() - interval '10 seconds'` ou quando `versao` mudou. O restante da função idêntico.
- [ ] **Step 2:** aplicar na produção fora do pico com backup da definição antiga salvo em `supabase/migrations/0234_..._volta.sql` (comentado).
- [ ] **Step 3:** verificar: painel de Impressão da Menuzia fica "conectado" sem piscar por 10 min; fechar o Assistente → "sem sinal" em ≤ 40 s (Review Focus 3); medir gravações em `impressao_agentes` com o script da Task 0 (esperado −80% ou mais).
- [ ] **Step 4:** commit.

### Task 7: Telas do painel — pausar com a aba escondida e afrouxar relógios

**Files (Modify):**
- `lib/realtime-fallback.ts` — novo hook `useHeartbeatVisivel(fn: () => void, intervaloMs: number): void` (igual a `useLeituraPeriodica`, mas **sem** ler ao montar) para os chamadores de `useRealtimeComFallback`
- `app/admin/pedidos/page.tsx:738`, `app/admin/kds/page.tsx:114`, `app/admin/lista-pedidos/page.tsx:329`, `app/admin/mesas/page.tsx:174`, `app/admin/mesas/[id]/page.tsx:233`, `components/pdv/central-balcao.tsx:101`, `components/pdv/conta-presencial.tsx:156` → trocar o `setInterval` por `useHeartbeatVisivel`
- `components/financeiro/faixa-aprovacoes.tsx:31` 10 s → 30 s e ler ao voltar a aba
- `components/logistica/motoboy-financeiro.tsx:66` 15 s → 60 s com `useLeituraPeriodica`
- `components/impressao/painel-impressao.tsx:143` 5 s → 15 s (2 s só durante o pareamento, como hoje); `:214` (Assistente antigo) 8 s → 30 s com pausa
- `app/admin/pedidos/page.tsx:469` despacho automático: pausar com a aba escondida (o cron do servidor continua despachando a cada 1 min)
- `app/admin/mesas/[id]/conta.tsx:112` 5 s → 10 s
- Test: `lib/realtime-fallback.test.ts`

**Fora desta task (de propósito):** `alarme-global.tsx` (tem que tocar com a aba escondida), `nova-versao.tsx`, `trava-sessao.tsx`, `motoboy/portal.tsx` (batida do motoboy), `tela-pix-online.tsx`, QR do WhatsApp em Integrações, aprovação remota em andamento (`apoio.tsx`).

- [ ] **Step 1: testes que falham** (`vi.useFakeTimers`, `document.visibilityState` mockado): `aba escondida → fn não roda no relógio`; `aba volta → fn roda na hora`; `não roda ao montar`.
- [ ] **Step 2:** FAIL → implementar hook → PASS.
- [ ] **Step 3:** trocar os chamadores um a um (só o relógio; nenhuma outra linha). Para KDS, Mesas e PDV, confirmar que ao voltar a aba a tela relê (Review Focus 4) — se o chamador não tinha leitura ao voltar, o hook passa a dar.
- [ ] **Step 4:** `npm run checar`; abrir Kanban, KDS, Logística, Mesas e PDV da Menuzia; esconder a aba 2 min e voltar → atualiza na hora; pedido novo continua aparecendo e o alarme tocando com a aba escondida. Commit.

### Task 8: Vitrine e mesa — consultar só quando há algo para acompanhar

**Files:** Modify: `app/loja/[slug]/vitrine.tsx:2607`, `app/loja/[slug]/vitrine-classica.tsx:2453`, `app/mesa/[token]/cardapio.tsx:264,698`; Test: arquivo de teste da função que decide o ritmo (extrair `ritmoPedidos(estado): number | null` para `lib/vitrine-ritmo.ts` + `lib/vitrine-ritmo.test.ts`)

**Interfaces:** `ritmoPedidos({ abaPedidosAberta: boolean, detalheAberto: boolean, temPedidoAtivo: boolean, entregaEmCurso: boolean }): number | null` — `8000` aba/detalhe aberto; `15000` entrega em curso; `30000` pedido ativo; `null` (não consulta) sem pedido ativo e sem aba aberta.

- [ ] **Step 1: testes que falham** com essas 4 combinações + `pedido entregue há 1 min conta como ativo até o status final ser lido` (não parar antes de mostrar "Entregue").
- [ ] **Step 2:** FAIL → implementar → PASS; usar no lugar do cálculo atual (relógio desligado quando `null`; abrir a aba "Meus pedidos" lê na hora).
- [ ] **Step 3:** mesa: `/api/mesa/:token/modo` (60 s) com `useLeituraPeriodica`; chamado do garçom (10 s) só enquanto houver chamado aberto.
- [ ] **Step 4:** Review Focus 5 na Menuzia: pedido de teste → status anda até "Entregue" sem recarregar. `npm run checar`; commit.

### Task 9: Imagem enxuta (Next `standalone`) — noite própria, depois das Tasks 1–8

**Files:** Modify: `next.config.ts`; Create: `Dockerfile`, `.dockerignore`; Coolify: tipo de build → Dockerfile.

- [ ] **Step 1:** no Coolify, confirmar o tipo de build atual (hipótese: Nixpacks) e listar as variáveis com "Build time".
- [ ] **Step 2:** `output: 'standalone'`; `outputFileTracingIncludes: { '/**': ['./node_modules/ffmpeg-static/**'] }`; manter `serverExternalPackages: ['ffmpeg-static']`.
- [ ] **Step 3:** Dockerfile em 2 estágios (Node da mesma versão de hoje): estágio 1 `npm ci` + `npm run build` (o prebuild com as guardas continua rodando), `ARG` para cada variável Build time; estágio 2 copia `.next/standalone`, `.next/static` → `.next/static`, `public`; `ENV HOSTNAME=0.0.0.0 PORT=3000 NODE_ENV=production`; `WORKDIR /app` (o volume `/app/dados/ancoras` continua no mesmo caminho); `CMD ["node","server.js"]`.
- [ ] **Step 4:** testar a imagem localmente (`docker build` + `docker run` com `.env` de teste fora do repo): login e redirecionamento por papel ficam no mesmo host (risco do `HOSTNAME` — ver memória "next start sem -H"); vitrine; upload de foto (sharp) e de vídeo (ffmpeg); `/api/versao` devolve o BUILD_ID; `/api/vivo` 200; download do instalador do Assistente.
- [ ] **Step 5:** publicar fora do pico; verificar tamanho da imagem (esperado ≤ 500 MB), memória do container, pedidos entrando, impressão saindo. Volta: tipo de build anterior + Redeploy.
- [ ] **Step 6:** commit + entrada no relatório do dia.

### Fechamento

- [ ] Rodar o script da Task 0 de novo (mesmo horário da medição base) e registrar antes → depois por fonte.
- [ ] Atualizar `docs/PENDENCIAS.md` (itens 8 e 9) e `docs/BUGS-CONHECIDOS.md` se algo novo aparecer.

## Ganho esperado (estimativa, a confirmar na Task 0 / fechamento)

| Frente | Hoje | Depois |
|---|---|---|
| Assistente (por PC) | ~50 consultas/min | ~10–15/min |
| Assistente no banco inteiro | ~35% | ~10% |
| Painel com aba escondida | relógios de 8–60 s rodando | 0 (lê ao voltar) |
| Vitrine sem pedido ativo | 1 consulta a cada 30 s | 0 |
| Imagem do app | ~2,4 GB | ~0,3–0,5 GB |

## Decisões em aberto (dono)

1. Lojas no Assistente antigo (lista sai na Task 0): migrar para o novo — combinado com cada loja.
2. Espera de 30 s no servidor (−30% das voltas sem pedido) exige subir `ONLINE_MS`; fica fora deste plano até você pedir.
3. Build fora da VPS (GitHub Actions → imagem pronta): fora deste plano; a Task 9 só diminui a imagem.
