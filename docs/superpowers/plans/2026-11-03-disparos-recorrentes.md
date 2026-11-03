# Disparos recorrentes — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Três campanhas de WhatsApp sempre ligadas por loja (Recuperação, Nunca compraram, Promoções) que geram rodadas sozinhas na programação, com rodízio de imagens, cadência anti-bloqueio e carga mínima no banco; modelos dentro de Agendamentos; visão geral só com números; visual nas cores mestre.

**Architecture:** Uma tabela `campanha_recorrentes` (3 linhas por loja) guarda a programação e `proximo_disparo_em` já calculado por trigger. O cron de 60 s que já existe chama, no máximo a cada 10 min, uma RPC que transforma cards vencidos em linhas comuns de `campanhas` + `campanha_envios` (tudo em SQL, `skip locked`, trava pelo avanço de `proximo_disparo_em`). Daí em diante é a fila atual (reserva, teto, freio, pausa/retomada). Regras globais mudam em dois pontos: 60–150 s entre mensagens da loja e 2 dias por pessoa.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres 15, plpgsql, RLS), vitest, Playwright (e2e local com provedor simulado), Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md`

## Global Constraints

- Migration **aditiva**, numerada `0245_disparos_recorrentes.sql`, com `docs/rollback/0245_disparos_recorrentes.down.sql`. Nunca converte dado existente.
- Toda tabela nova: `restaurante_id`, RLS por `auth_restaurante_id()` + `auth_e_gestor()`, `grant` para `authenticated` (regra do projeto: sem grant o painel abre vazio).
- Funções chamadas pelo cron: `security definer`, `revoke … from public, anon, authenticated`, `grant execute … to service_role`.
- **Nenhum cron novo.** Só `app/api/cron/campanhas/route.ts` chama o que é de campanha (guarda B2 em `scripts/guardas/bugs-conhecidos.mjs`).
- Cadência: próxima mensagem da loja em **60–150 s** aleatório; `disparo_frequencia_dias` passa de 3 para **2**; janela global 09:00–21:30 e teto diário continuam.
- Público dos cards: só telefone presente em `whatsapp_conversas` da loja, nunca em `whatsapp_descadastros`; dedupe por `telefone_chave`.
- Cards nascem **desligados** (`ativa=false`). Default seguro.
- Código com `\` (regex) só por Edit/Write, nunca por `node -e`/sed (B1/B4).
- Antes de publicar: `npm run checar` limpo. Deploy fora do pico, conferir pedidos entrando depois.
- Visual (Tarefa 12, por último): `#112f6b` azul profundo, `#f6bd28` amarelo (toggle ligado, aba ativa, hover de ferramenta, sempre com texto `#1F2937`), `#ea1d2c` vermelho (desligar, cancelar, freio), `#FFA400` laranja (avisos). Radius e fonte do painel ficam.

## Decisões depois da revisão do construtor (03/11)

1. **Prioridade entre cards (meu):** na mesma loja, as rodadas nascem na ordem Recuperação → Nunca compraram → Promoções, com `agendado_em` escalonado em +0 s / +1 s / +2 s (a reserva ordena por `agendado_em`). Cada card **exclui quem já entrou em qualquer rodada da loja hoje** (`campanha_envios.criado_em >= hoje SP`). Promoções continua "todo mundo que conversou", menos quem já está em outro card hoje.
2. **"Conversou com a loja":** pergunta aberta ao dono (ver abaixo). Até a resposta, o SQL usa a definição estrita: conversa com **pelo menos uma mensagem recebida do cliente** (`whatsapp_mensagens.direcao = 'entrada'`). Se o dono preferir a ampla (qualquer linha em `whatsapp_conversas`, inclui quem só recebeu aviso de status), muda uma cláusula em `campanha_recorrente_publico`.
3. **Capacidade por rodada (meu):** o `limit` do insert é `least(disparo_limite_dia, floor(minutos_da_janela * 60 / 105))` (105 s = média de 60–150). Janela padrão 17:00–19:00 → ~68 pessoas. Ordem: quem **nunca recebeu** disparo da loja primeiro, depois quem recebeu há mais tempo, empate por `random()` (`order by max(enviado_em) nulls first, random()`), para a base inteira ser alcançada ao longo dos dias. O card mostra "cabem ~N por rodada; amplie a janela para alcançar mais".
4. **"Pular hoje" com rodada já nascida (meu):** o PATCH, além de gravar `pular_ate`, cancela os pendentes de `ultima_campanha_id` se `agendado_em` for hoje (`cancelarFila` de `lib/queries/campanhas.ts`).
5. **Nome e variáveis (meu):** `nome_cliente` = `clientes.nome` → `whatsapp_conversas.nome_contato` → `''` (o `{nome}` vazio já é tratado por `montarTextoCampanha`). `{ultimo_item}` só é aceito no card Recuperação; nos outros dois o PATCH recusa com "Esta variável só vale na Recuperação."
6. **"Sucesso (%)" (meu):** enviadas ÷ tentadas (campo `enviadas`/`tentados` que a RPC já devolve). Conversão fica implícita em Pedidos.

## Review Focus

1. Card ligado com `dias_semana = '{}'` nunca dispararia em silêncio → o PATCH recusa (400) e a trigger trata vazio como todos os dias. Teste na Tarefa 5.
2. Servidor reinicia (deploy) e zera a trava de 10 min → a RPC roda de novo mas não acha card vencido (já avançou) → zero rodada dupla. Teste na Tarefa 3 (duas chamadas seguidas = uma rodada).
3. `pular_ate` no passado (loja marcou "pular hoje" semana passada) → é ignorado, não pula. Teste na Tarefa 2.
4. Card com 0 imagens → rodada de texto, `imagem_indice` não avança. Teste na Tarefa 3.
5. Telefone na conversa com 55 e no descadastro sem 55 → dedupe por `telefone_chave` tira ele do público. Teste na Tarefa 3.

---

### Tarefa 1: Migration 0245 — tabela, coluna, config, trigger de agenda

**Files:**
- Create: `supabase/migrations/0245_disparos_recorrentes.sql`
- Create: `supabase/migrations/0245_disparos_recorrentes.test.ts`
- Create: `docs/rollback/0245_disparos_recorrentes.down.sql`

**Interfaces:**
- Produces: tabela `public.campanha_recorrentes` (colunas da spec §4.5, `tipo in ('recuperacao','nunca_compraram','promocoes')`, `unique (restaurante_id, tipo)`, índice `campanha_recorrentes_vencidos on (proximo_disparo_em) where ativa`); coluna `public.campanhas.recorrente_id uuid references campanha_recorrentes(id) on delete set null` + índice parcial; função `public.campanha_recorrente_proximo(p_dias smallint[], p_hora time, p_a_partir timestamptz) returns timestamptz` (próximo instante ≥ `p_a_partir` cujo dia da semana em `America/Sao_Paulo` está em `p_dias` e hora = `p_hora`; `p_dias` vazio = todos); trigger `campanha_recorrentes_agenda` `before insert or update of ativa, dias_semana, hora, pular_ate` que grava `proximo_disparo_em = campanha_recorrente_proximo(dias_semana, hora, greatest(now(), caso pular_ate = hoje SP então amanhã 00:00 SP))` quando `ativa`, e `null` quando não; `plataforma_config.disparo_frequencia_dias = 2`.

- [ ] **Step 1: Escrever o teste da migration (padrão regex, como `0243_assinaturas_asaas.test.ts`)**

```ts
const sql = readFileSync('supabase/migrations/0245_disparos_recorrentes.sql', 'utf8')
it('tabela com os 3 tipos, unique por loja e RLS de gestor', () => {
  expect(sql).toMatch(/create table if not exists public\.campanha_recorrentes/)
  expect(sql).toMatch(/tipo in \('recuperacao', 'nunca_compraram', 'promocoes'\)/)
  expect(sql).toMatch(/unique \(restaurante_id, tipo\)/)
  expect(sql).toMatch(/ativa boolean not null default false/)
  expect(sql).toMatch(/jsonb_array_length\(imagens\) <= 5/)
  expect(sql).toMatch(/alter table public\.campanha_recorrentes enable row level security/)
  expect(sql).toMatch(/auth_e_gestor\(\)/)
  expect(sql).toMatch(/grant select, insert, update on public\.campanha_recorrentes to authenticated/)
})
it('índice parcial dos vencidos e coluna recorrente_id em campanhas', () => {
  expect(sql).toMatch(/create index if not exists campanha_recorrentes_vencidos on public\.campanha_recorrentes \(proximo_disparo_em\) where ativa/)
  expect(sql).toMatch(/alter table public\.campanhas add column if not exists recorrente_id uuid references public\.campanha_recorrentes\(id\) on delete set null/)
})
it('frequência por cliente vai a 2 dias; trigger calcula a agenda', () => {
  expect(sql).toMatch(/update public\.plataforma_config set valor = '2'::jsonb[^;]*where chave = 'disparo_frequencia_dias'/)
  expect(sql).toMatch(/create or replace function public\.campanha_recorrente_proximo\(p_dias smallint\[\], p_hora time, p_a_partir timestamptz\)/)
  expect(sql).toMatch(/create trigger campanha_recorrentes_agenda before insert or update of ativa, dias_semana, hora, pular_ate/)
})
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run supabase/migrations/0245_disparos_recorrentes.test.ts` → FAIL (arquivo não existe).

- [ ] **Step 3: Escrever a migration** com cabeçalho no estilo das outras (data, o que faz, "Aditiva. Rollback: …"). `campanha_recorrente_proximo` em plpgsql: converte `p_a_partir` para SP, começa no dia de `p_a_partir` com `p_hora`; se já passou, dia seguinte; avança até `extract(dow)` ∈ `p_dias` (máx. 7 iterações); devolve `at time zone 'America/Sao_Paulo'`. Trigger function `campanha_recorrentes_agenda_fn()`.

- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS.

- [ ] **Step 5: Escrever o rollback** (`drop trigger`, `drop function`, `alter table campanhas drop column recorrente_id`, `drop table campanha_recorrentes`, `update plataforma_config … '3'`).

- [ ] **Step 6: Commit** — `feat(disparos): migration 0245 — campanha_recorrentes, agenda por trigger, frequência 2 dias`

---

### Tarefa 2: Público em SQL + contagem para a tela

**Files:**
- Modify: `supabase/migrations/0245_disparos_recorrentes.sql` (acrescenta)
- Modify: `supabase/migrations/0245_disparos_recorrentes.test.ts`

**Interfaces:**
- Produces: `public.campanha_recorrente_publico(p_restaurante uuid, p_tipo text) returns table (telefone text, nome_cliente text, ultimo_item text, ultimo_disparo_em timestamptz)` — security definer, service_role: base = `whatsapp_conversas` da loja (telefone 10–15 dígitos) **com ao menos uma `whatsapp_mensagens.direcao = 'entrada'`** (decisão 2, pode virar "qualquer conversa") **menos** `whatsapp_descadastros` (por `telefone_chave`) **menos** quem já tem `campanha_envios` da loja com `criado_em >= hoje SP` (decisão 1), deduplicado por `telefone_chave` (fica a conversa mais recente por `ultima_atividade_em`); `recuperacao` = tem pedido não cancelado e `max(criado_em) <= now() - interval '30 days'`; `nunca_compraram` = sem pedido não cancelado; `promocoes` = base inteira. `nome_cliente` = `clientes.nome` → `nome_contato` → `''`. `ultimo_item` = primeiro item do último pedido (como `resolverDestinatarios`), só para `recuperacao`. `ultimo_disparo_em` = `max(enviado_em)` em `campanha_envios` da loja para esse `telefone_chave` (null = nunca recebeu).
- Produces: `public.campanha_recorrente_estimativa(p_tipo text) returns integer` — para a sessão (`auth_restaurante_id()`, exige `auth_e_gestor()`), `grant execute to authenticated`; devolve `count(*)` do público.

- [ ] **Step 1: Teste (regex)** — `publico` usa `whatsapp_conversas`, exclui `whatsapp_descadastros`, agrupa por `telefone_chave`, `interval '30 days'`; `estimativa` tem `auth_e_gestor` e grant para authenticated; `publico` tem revoke de authenticated.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Escrever as duas funções.** Pedidos casam por `public.telefone_chave(p.cliente_telefone) = public.telefone_chave(c.telefone)`.
- [ ] **Step 4: Ver passar.**
- [ ] **Step 5: Commit** — `feat(disparos): público dos cards em SQL (conversou, nunca comprou, recuperação)`

---

### Tarefa 3: RPC que gera as rodadas

**Files:**
- Modify: `supabase/migrations/0245_disparos_recorrentes.sql` (acrescenta)
- Modify: `supabase/migrations/0245_disparos_recorrentes.test.ts`
- Modify: `scripts/seguranca/e2e-campanhas-metricas.mjs` (seção nova, Tarefa 11 completa)

**Interfaces:**
- Consumes: `campanha_recorrente_publico`, `campanha_recorrente_proximo`.
- Produces: `public.campanha_recorrentes_gerar_rodadas() returns table (recorrente_id uuid, campanha_id uuid, destinatarios integer, motivo text)` — security definer, service_role. Algoritmo:
  1. `for v in select r.* from campanha_recorrentes r join loja_modulos m on m.restaurante_id = r.restaurante_id and m.modulo = 'disparos' and m.liberado where r.ativa and r.proximo_disparo_em <= now() order by r.restaurante_id, case r.tipo when 'recuperacao' then 0 when 'nunca_compraram' then 1 else 2 end for update of r skip locked loop` (decisão 1: prioridade; `agendado_em = now() + make_interval(secs => prioridade)`)
  2. `update campanha_recorrentes set proximo_disparo_em = campanha_recorrente_proximo(dias_semana, hora, now() + interval '1 minute') where id = v.id` (sempre, antes de qualquer coisa: é a trava).
  3. Se `pular_ate = (now() at time zone 'America/Sao_Paulo')::date` → devolve `(v.id, null, 0, 'pulado')`, `continue`.
  4. `insert into campanhas (restaurante_id, nome, status, tipo_mensagem, mensagem, imagem_url, filtro, agendado_em, janela_inicio, janela_fim, incluir_link, incluir_descadastro, recorrente_id)` com `nome = ROTULO[tipo] || ' · ' || to_char(data SP, 'DD/MM')`, `tipo_mensagem = case when jsonb_array_length(imagens) > 0 then 'imagem' else 'texto'`, `imagem_url = imagens->>(imagem_indice mod n)`, `status = 'agendada'`, `agendado_em = now()`, `filtro = '{"tipo":"recorrente"}'`.
  5. `insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente, ultimo_item) select … from campanha_recorrente_publico(v.restaurante_id, v.tipo) order by ultimo_disparo_em nulls first, random() limit least(disparo_limite_dia, floor(extract(epoch from (v.janela_fim - v.hora)) / 105))` (decisão 3; mínimo 1).
  6. Se inseriu 0 → `delete from campanhas where id = nova`; grava `ultima_rodada_em = now(), ultima_rodada_motivo = 'sem_publico', ultima_campanha_id = null`; devolve `(v.id, null, 0, 'sem_publico')`.
  7. Senão → `update campanhas set total_destinatarios = n`; `update campanha_recorrentes set ultima_rodada_em = now(), ultima_campanha_id = nova, ultima_rodada_motivo = 'ok', imagem_indice = case when n_img > 0 then (imagem_indice + 1) mod n_img else imagem_indice`; devolve `(v.id, nova, n, 'ok')`.

- [ ] **Step 1: Teste regex** — `for update of r skip locked`, `proximo_disparo_em = public.campanha_recorrente_proximo` aparece antes do `insert into public.campanhas`, `order by random()`, `limit (select disparo_limite_dia`, `'sem_publico'`, `join public.loja_modulos`.
- [ ] **Step 2: Ver falhar.** **Step 3: Escrever.** **Step 4: Ver passar.**
- [ ] **Step 5: Teste de verdade no banco local** (o e2e da Tarefa 11 cobre: duas chamadas seguidas → 1 rodada; 0 imagens → `tipo_mensagem='texto'` e índice parado; descadastro sem 55 × conversa com 55 → fora). Nesta tarefa só anotar os três casos no cabeçalho da função.
- [ ] **Step 6: Commit** — `feat(disparos): RPC campanha_recorrentes_gerar_rodadas (trava por avanço da agenda)`

---

### Tarefa 4: Cadência nova e expiração de rodada na reserva; métricas em 72 h

**Files:**
- Modify: `supabase/migrations/0245_disparos_recorrentes.sql` (acrescenta: `drop function if exists public.campanha_reservar_envios(integer)` + `create function` copiada da 0190:79-180 com três mudanças)
- Modify: `supabase/migrations/0245_disparos_recorrentes.test.ts`
- Modify: `docs/rollback/0245_disparos_recorrentes.down.sql` (recria a versão da 0190)

**Interfaces:**
- Produces: `campanha_reservar_envios(p_limite integer)` igual à 0190 exceto: (a) `disparo_proximo_em = now() + make_interval(secs => 60 + floor(random() * 91)::int)` (60–150); (b) antes do laço, expiração de rodada: `update campanha_envios e set status = 'expirado', erro = 'Rodada do dia encerrada' from campanhas c where c.id = e.campanha_id and c.recorrente_id is not null and e.status = 'pendente' and (now() at time zone 'America/Sao_Paulo') > ((c.agendado_em at time zone 'America/Sao_Paulo')::date + coalesce(c.janela_fim, time '21:30'))`; (c) nada mais.
- Produces: `campanhas_metricas` e `campanha_atribuicoes` (0104:260-390) recriadas com `interval '72 hours'` no lugar de `'12 hours'` (copiar o corpo da 0104, trocar só o intervalo; manter assinaturas).

- [ ] **Step 1: Teste regex** — `60 \+ floor\(random\(\) \* 91\)`, `Rodada do dia encerrada`, `c\.recorrente_id is not null`, e para métricas: o trecho da 0245 que define `campanha_atribuicoes` não contém `'12 hours'` e contém `'72 hours'`.
- [ ] **Step 2: Ver falhar.** **Step 3: Escrever.** **Step 4: Ver passar.**
- [ ] **Step 5: Atualizar `lib/mensageria/disparo-regras.ts` cabeçalho (comentário: 60–150 s, 2 dias) e `components/admin/campanhas/visao-geral.tsx` texto do "ver detalhado" se citar 12 h** (grep `12 h`).
- [ ] **Step 6: Commit** — `feat(disparos): 60–150 s por loja, rodada expira no fim do dia, métricas detalhadas em 72 h`

---

### Tarefa 5: Regras puras em TS (validação do PATCH, trava de 10 min, rótulos)

**Files:**
- Create: `lib/mensageria/recorrentes.ts`
- Create: `lib/mensageria/recorrentes.test.ts`

**Interfaces:**
- Produces:
  - `export const TIPOS_RECORRENTES = ['recuperacao', 'nunca_compraram', 'promocoes'] as const; export type TipoRecorrente`
  - `export const ROTULO_RECORRENTE: Record<TipoRecorrente, { nome: string; publico: string; mensagemPadrao: string }>` (nomes: "Recuperação de clientes", "Quem nunca comprou", "Promoções"; `mensagemPadrao` curta com `{nome}`, `{loja}` e `{link}`; público em uma linha, espelhando a spec §4.1)
  - `export const IMAGENS_MAX = 5; export const CHECAGEM_CARDS_MS = 10 * 60_000`
  - `export function checagemDevida(ultimaMs: number | null, agoraMs: number): boolean` (igual a `horaDeFotografar`: null ou ≥ 10 min)
  - `export interface PatchRecorrente { ativa?: boolean; mensagem?: string; incluirLink?: boolean; imagens?: string[]; diasSemana?: number[]; hora?: string; janelaFim?: string; pularHoje?: boolean }`
  - `export function validarPatchRecorrente(tipo: TipoRecorrente, p: unknown): { ok: true; row: Record<string, unknown>; pularHoje: boolean } | { ok: false; erro: string }` — mensagem via `problemasDasVariaveis(mensagem, { incluirLink })` **e** `{ultimo_item}` só em `recuperacao` (erro "Esta variável só vale na Recuperação.", decisão 5); `imagens` ≤ 5 strings `https://`; `diasSemana` inteiros 0–6 únicos, **vazio = erro "Escolha pelo menos um dia."**; `hora`/`janelaFim` via `janelaDoDisparo(hora, janelaFim)` (devolve `hora` e `janela_fim` já encaixadas); `pularHoje: true` → `row.pular_ate = hoje SP (YYYY-MM-DD)` e `pularHoje = true` para a rota cancelar a rodada de hoje (decisão 4); `ativa` boolean; mapeia para colunas snake_case.
  - `export function cabemNaJanela(hora: string, janelaFim: string, limiteDia: number): number` = `max(1, min(limiteDia, floor(minutos * 60 / 105)))` (decisão 3; a tela mostra "cabem ~N por rodada").

- [ ] **Step 1: Testes**: `checagemDevida(null, t)` true; `(t-599_999, t)` false; `(t-600_000, t)` true. `validarPatchRecorrente({ diasSemana: [] })` → erro "Escolha pelo menos um dia."; `{ imagens: Array(6).fill('https://x/a.jpg') }` → erro; `{ mensagem: 'Oi {cupom}', incluirLink: true }` → erro (variável desconhecida); `{ hora: '08:00', janelaFim: '23:00' }` → `row.hora === '09:00'`, `row.janela_fim === '21:30'`; `{ pularHoje: true }` → `row.pular_ate` bate `/^\d{4}-\d{2}-\d{2}$/`; `{ ativa: 'sim' }` → erro.
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar.** **Step 4: Ver passar.**
- [ ] **Step 5: Commit** — `feat(disparos): regras puras dos cards recorrentes`

---

### Tarefa 6: Cron chama a RPC a cada 10 min; freio desliga o card

**Files:**
- Modify: `lib/mensageria/campanhas-envio.ts` (`processarCampanhas` e `aplicarFreio`)
- Modify: `lib/mensageria/campanhas-envio.test.ts`
- Modify: `app/api/cron/campanhas/route.ts` (só comentário: documenta a checagem de 10 min)

**Interfaces:**
- Consumes: `checagemDevida`, `CHECAGEM_CARDS_MS` (Tarefa 5).
- Produces: em `campanhas-envio.ts`, estado de módulo `let ultimaChecagemCards: number | null = null` e `export function gerarRodadasSeDevido(admin: SupabaseClient, agora = Date.now()): Promise<{ rodadas: number } | null>` — se `checagemDevida` → grava `ultimaChecagemCards = agora`, chama `admin.rpc('campanha_recorrentes_gerar_rodadas')`, devolve `{ rodadas: linhas com motivo 'ok' }`; erro na RPC é logado e **não derruba** o lote. `export function _resetChecagemCards()` para testes. `processarCampanhas` chama `gerarRodadasSeDevido(admin)` logo após `sincronizarPausas` e põe `rodadas` no `ResumoCampanhas`.
- `aplicarFreio`: depois de pausar, `select recorrente_id from campanhas where id` → se não nulo, `update campanha_recorrentes set ativa = false, desligado_motivo = motivo, atualizado_em = now() where id = recorrente_id`; alerta ganha o sufixo " O card recorrente foi desligado."

- [ ] **Step 1: Testes** (estilo `adminFalso` do arquivo): (a) duas chamadas de `processarCampanhas` seguidas → `rpc('campanha_recorrentes_gerar_rodadas')` chamada **1** vez; (b) após `_resetChecagemCards()` chama de novo; (c) RPC devolve `error` → `processarCampanhas` ainda processa os envios; (d) freio com campanha `recorrente_id='rc1'` → `from('campanha_recorrentes').update({ ativa: false, desligado_motivo: 'erro_alto', … })` chamado.
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar.** **Step 4: Ver passar** (`npx vitest run lib/mensageria/campanhas-envio.test.ts lib/mensageria/campanhas-freio.test.ts`).
- [ ] **Step 5: Rodar `node scripts/guardas/bugs-conhecidos.mjs`** → B2 continua ✓ (nenhuma função nova importada por duas rotas de cron).
- [ ] **Step 6: Commit** — `feat(disparos): cron gera rodadas a cada 10 min; freio desliga o card`

---

### Tarefa 7: API dos cards

**Files:**
- Create: `app/api/admin/campanhas/recorrentes/route.ts` (GET)
- Create: `app/api/admin/campanhas/recorrentes/[tipo]/route.ts` (PATCH)
- Create: `app/api/admin/campanhas/recorrentes/[tipo]/estimativa/route.ts` (GET)
- Create: `lib/queries/recorrentes.ts`
- Modify: `lib/queries/campanhas.ts` (`listarCampanhas`: `.is('recorrente_id', null)`; `CAMPANHA_SELECT` ganha `recorrente_id`)
- Modify: `lib/acessos.ts` **não muda** (prefixo `/api/admin/campanhas` já cobre).

**Interfaces:**
- Consumes: `validarPatchRecorrente`, `TIPOS_RECORRENTES`, `ROTULO_RECORRENTE`; `getAuthSupabase` (copiar o helper local das rotas vizinhas); `restauranteDaSessao`.
- Produces em `lib/queries/recorrentes.ts`:
  - `export interface Recorrente { id, tipo, ativa, mensagem, incluirLink, imagens: string[], imagemIndice, diasSemana: number[], hora, janelaFim, pularAte: string|null, proximoDisparoEm: string|null, ultimaRodadaEm, ultimaCampanhaId, ultimaRodadaMotivo, desligadoMotivo, ultimaRodada?: { enviados: number; erros: number; destinatarios: number; status: string } | null }`
  - `export async function garantirRecorrentes(supabase, restauranteId): Promise<Recorrente[]>` — `upsert` das 3 linhas `{ restaurante_id, tipo, mensagem: ROTULO[tipo].mensagemPadrao }` com `onConflict: 'restaurante_id,tipo', ignoreDuplicates: true`, depois `select` ordenado pela ordem de `TIPOS_RECORRENTES`, e para as que têm `ultima_campanha_id` lê `total_destinatarios, total_enviados, total_erros, status` de `campanhas`.
  - `export async function atualizarRecorrente(supabase, restauranteId, tipo, row): Promise<Recorrente>`.
- Rotas: GET → `garantirRecorrentes` (200 lista; 401 sem sessão). PATCH → 400 tipo inválido / validação; se `pularHoje` e `ultima_campanha_id` tem `agendado_em` de hoje (SP) → `cancelarFila(admin, ultimaCampanhaId)` (decisão 4); 200 `Recorrente`. Estimativa → `supabase.rpc('campanha_recorrente_estimativa', { p_tipo })` → `{ pessoas: n }`. Tudo com o cliente da sessão (RLS de gestor faz a permissão; garçom recebe 403 do Postgres → responder 403).

- [ ] **Step 1: Teste** em `lib/queries/recorrentes.test.ts`: `garantirRecorrentes` com supabase falso devolve 3 itens na ordem recuperacao, nunca_compraram, promocoes e chama `upsert` com `ignoreDuplicates: true`.
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar queries e rotas.** **Step 4: Ver passar + `npx tsc --noEmit -p .`.**
- [ ] **Step 5: Commit** — `feat(disparos): API dos cards recorrentes (GET, PATCH, estimativa)`

---

### Tarefa 8: Tela Campanhas = 3 cards (funcional, sem cor nova ainda)

**Files:**
- Create: `components/admin/campanhas/recorrentes.tsx`
- Modify: `app/admin/campanhas/page.tsx:573` (aba `campanhas` renderiza `<Recorrentes restauranteId=… onToast=… />`)
- Create: `components/admin/campanhas/recorrentes.test.tsx` (render básico)

**Interfaces:**
- Consumes: GET/PATCH/estimativa da Tarefa 7; `uploadMidiaCampanha(supabase, restauranteId, file, 'imagem')` (`lib/queries/campanhas.ts:183`) com o cliente de navegador já usado em `page.tsx`; `Confirmar`, `Ajuda`, `TextoComVariaveis` de `comum.tsx`; `AVISO_DISPAROS`.
- Produces: `export function Recorrentes({ restauranteId, onToast }: { restauranteId: string | null; onToast: (tom: 'ok'|'erro', t: string) => void })`. Cada card (`data-testid="card-<tipo>"`): placeholder da imagem de bordo (`div` 16:9 cinza, `data-bordo`), nome, linha do público, "~N pessoas hoje" (estimativa, carregada uma vez por card), botão **Galeria** (gaveta lateral com até 5 miniaturas, upload, remover, marca "próxima" = `imagemIndice`), programação (chips Dom–Sáb reutilizando `DIAS_SEMANA`, `input type=time` hora e fim), textarea da mensagem com contador e prévia, "última rodada: dd/mm hh:mm · X de Y enviados" ou "sem público" ou "desligado pelo freio (motivo)", rodapé com **toggle** (`role="switch"`, `aria-checked`, `data-testid="toggle-<tipo>"`) e botão **Pular hoje** (desabilitado se `pularAte === hoje`). Salvar: campo perde o foco → PATCH só do que mudou (debounce 600 ms) e toast "Salvo". Toggle e Pular: PATCH imediato. Estados: carregando (esqueleto 3 cards), erro (faixa com tentar de novo), módulo bloqueado (a página já trata pelo cadeado — nada a fazer aqui).

- [ ] **Step 1: Teste**: renderiza 3 cards com `fetch` mockado devolvendo as 3 linhas; clicar no toggle chama `fetch` com `PATCH /api/admin/campanhas/recorrentes/recuperacao` e body `{"ativa":true}`.
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar.** **Step 4: Ver passar + `next lint`.**
- [ ] **Step 5: Commit** — `feat(disparos): aba Campanhas com os 3 cards recorrentes`

---

### Tarefa 9: Agendamentos absorve a lista com ações e os Modelos

**Files:**
- Modify: `app/admin/campanhas/page.tsx` (`ABAS`: remove `modelos`; tipo `Aba` sem `'modelos'`; `:340-341`: `?aba=modelos` → `setAba('agendamentos')` e `router.replace('/admin/campanhas?aba=agendamentos')`; `:574`: aba agendamentos renderiza `<Modelos …/>` **acima** de `<ListaCampanhas …/>`; `:576` some)
- Modify: `components/admin/campanhas/listas.tsx` (`ListaCampanhas` ganha as colunas "Programada para" e "Enviada em" de `Agendamentos`; `Agendamentos` é removido ou vira alias de `ListaCampanhas`)
- Modify: `components/admin/campanhas/modelos.tsx` (título da seção "Modelos de mensagem" + texto "Use um modelo ao criar um agendamento.")
- Modify: `components/layout/sidebar.test.tsx`/`lib/menu-lateral*`: nada (submenu é interno da página).

- [ ] **Step 1: Teste** (`app/admin/campanhas/page.test.tsx` se existir; senão `listas.test.tsx`): `ListaCampanhas` mostra a coluna "Programada para" e os botões de ação; `ABAS` não contém `modelos`.
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar.** **Step 4: Ver passar.**
- [ ] **Step 5: Commit** — `feat(disparos): Agendamentos com modelos e lista única; submenu Modelos some`

---

### Tarefa 10: Visão geral só com números e um gráfico

**Files:**
- Modify: `components/admin/campanhas/visao-geral.tsx` (:130-144 vira duas linhas: 5 `Metrica` em `grid-cols-2 sm:grid-cols-5`, 4 `Indicador` em `grid-cols-2 lg:grid-cols-4`; :146-167 fica só a seção `grafico-dias` em largura total; :169-… tabela, `Paginacao`, `Th`, `ordem/pagina/porPagina` e `BarrasCampanhas` são removidos; estado vazio (`dados.envios.length === 0`) vira uma faixa curta abaixo do gráfico com o botão "Disparar mensagem")
- Modify: `components/admin/campanhas/visao-geral.test.tsx` (se existir) — ajustar seletores removidos.

- [ ] **Step 1: Teste**: com `fetch` mockado, não existe `tabela-envios` nem `grafico-campanhas`; existem `m-receita … m-tempo` e `grafico-dias`.
- [ ] **Step 2: Ver falhar.** **Step 3: Implementar.** **Step 4: Ver passar + `next lint` (imports mortos).**
- [ ] **Step 5: Commit** — `feat(disparos): visão geral enxuta (5 + 4 números, um gráfico)`

---

### Tarefa 11: E2E local de ponta a ponta

**Files:**
- Modify: `scripts/seguranca/e2e-campanhas-metricas.mjs` (seção "recorrentes")
- Modify: `docs/campanhas/README.md` (fluxo novo, cadência, expiração 7 d / fim do dia, 72 h; remove "24 h" e "12 h")
- Modify: `docs/CORRECOES-DE-BUGS.md` (regra geral nova: "checagem de agenda materializada: cron lê `proximo_*_em` vencido, nunca recalcula agenda a cada tique")

**Interfaces:** consome tudo acima; usa `pg` direto no banco local, `fetch` nas rotas com cookie da sessão (como o resto do script) e `POST /api/cron/campanhas` com `x-cron-secret`.

- [ ] **Step 1: Escrever a seção**: (1) liga card `promocoes` da loja A com hora = agora SP + 1 min e `dias_semana` = hoje; (2) `update campanha_recorrentes set proximo_disparo_em = now() - interval '1 minute'` (força o vencimento); (3) chama o cron 2× → `select count(*) from campanhas where recorrente_id = …` = **1**; (4) com `CAMPANHA_INTERVALO_MS=20` e `disparo_proximo_em` zerado à mão entre chamadas, os envios saem; (5) loja B (vizinha) não ganha linha nenhuma (RLS/isolamento); (6) descadastro sem 55 de um telefone com 55 na conversa → esse telefone não está em `campanha_envios`; (7) card com `imagens = '[]'` → `tipo_mensagem = 'texto'`; (8) força `erros` acima do freio → cron → `ativa = false`, `desligado_motivo = 'erro_alto'`; (9) `GET /api/admin/campanhas/visao-geral` do período inclui os envios da rodada; (10) screenshot da aba Campanhas.
- [ ] **Step 2: Rodar** conforme o cabeçalho do script (servidor local com provedor simulado). Expected: todas as linhas ✅.
- [ ] **Step 3: Atualizar os docs.**
- [ ] **Step 4: Commit** — `test(disparos): e2e dos cards recorrentes; docs de campanhas atualizados`

---

### Tarefa 12: Visual nas cores mestre (por último)

**Files:**
- Modify: `app/globals.css` (bloco `.campanhas-tema { --camp-azul:#112f6b; --camp-amarelo:#f6bd28; --camp-vermelho:#ea1d2c; --camp-laranja:#FFA400 }` + regras para `.fin-aba`/submenu ativo em amarelo com texto `#1F2937`, hover de ferramentas amarelo, `campanha-cartao` com borda superior azul)
- Modify: `app/admin/campanhas/page.tsx` (wrapper raiz ganha `campanhas-tema`)
- Modify: `components/admin/campanhas/recorrentes.tsx` (toggle ligado amarelo, desligado cinza; botão Pular hoje borda azul; aviso de freio vermelho; "sem público" laranja; cabeçalho do card azul com texto branco)
- Modify: `components/admin/campanhas/visao-geral.tsx` (números fortes em azul `#112f6b`; `Metrica` de receita com destaque amarelo)
- Modify: `components/admin/campanhas/listas.tsx`, `modelos.tsx` (botões primários azul `#112f6b`, perigo vermelho `#ea1d2c`, hover amarelo)

- [ ] **Step 1: Aplicar** seguindo `web-design-guidelines` (contraste ≥ 4,5:1: amarelo e laranja só como fundo com texto escuro ou como ícone/borda; nunca texto laranja em branco para corpo).
- [ ] **Step 2: Conferir no navegador** (perfil de teste, loja Menuzia) as três abas em 1366 px e no iframe 390 px; capturas em `.medidas/`.
- [ ] **Step 3: `npm run checar`** → limpo.
- [ ] **Step 4: Commit** — `style(disparos): cores mestre nas telas de campanhas`

---

### Tarefa 13: Publicar e acompanhar

- [ ] **Step 1:** `npm run checar` limpo; `git push origin publicar:main`.
- [ ] **Step 2:** Backup do banco antes da migration (regra do projeto); aplicar `0245` no Supabase de produção; conferir `select count(*) from campanha_recorrentes` = 0 (nasce vazio; linhas aparecem quando a loja abre a aba) e `plataforma_config.disparo_frequencia_dias = 2`.
- [ ] **Step 3:** Deploy pela API do Coolify; confirmar pelo CSS/JS servido (marcador ASCII: `campanhas-tema`).
- [ ] **Step 4:** Na Menuzia: abrir Campanhas (cria as 3 linhas, todas desligadas), ligar um card com hora de teste, ver a rodada nascer em ≤ 10 min no cron, ver os envios saírem com ≥ 60 s de intervalo, desligar o card. Conferir que nenhuma outra loja tem card ligado.
- [ ] **Step 5:** Acompanhar por 10 min se os pedidos das lojas continuam entrando. Registrar no relatório do dia.
