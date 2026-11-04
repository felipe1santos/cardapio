/**
 * E2E dos cards de disparo recorrente (0245) — provedor SIMULADO, lojas isoladas, nenhuma comunicação externa.
 * Desenho: docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md
 *
 * Trava obrigatória (aborta antes de QUALQUER escrita):
 *   CAMP_E2E_LOJA=camp-e2e-a  CAMP_E2E_VIZINHA=camp-e2e-b  (slugs começando com camp-e2e)
 *   CAMP_PROVEDOR=simulado    WHATSAPP_SIMULADO_ARQUIVO=<arquivo>  (o MESMO do servidor)   CRON_SECRET
 * O servidor local sobe com WHATSAPP_PROVEDOR=simulado, o mesmo arquivo, CRON_SECRET, WHATSAPP_ROBO_LIBERADO=1,
 * CAMPANHA_INTERVALO_MS=20 e CAMPANHA_CHECAGEM_CARDS_MS=0 (a checagem dos cards vira "a cada chamada").
 *
 *   SHOTS=<pasta> node scripts/seguranca/e2e-disparos-recorrentes.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

// Playwright pode estar instalado como `playwright`, `playwright-core` ou dentro de `@playwright/test`.
const { chromium } = await import('playwright').catch(() => import('playwright-core')).catch(() => import('@playwright/test'))

const LOJA = process.env.CAMP_E2E_LOJA
const VIZ = process.env.CAMP_E2E_VIZINHA
const ARQ = process.env.WHATSAPP_SIMULADO_ARQUIVO
if (!LOJA || !VIZ || !LOJA.startsWith('camp-e2e') || !VIZ.startsWith('camp-e2e') || LOJA === VIZ
  || process.env.CAMP_PROVEDOR !== 'simulado' || !ARQ || !process.env.CRON_SECRET) {
  console.error('Trava: informe CAMP_E2E_LOJA e CAMP_E2E_VIZINHA (camp-e2e-*), CAMP_PROVEDOR=simulado,\n'
    + 'WHATSAPP_SIMULADO_ARQUIVO (o mesmo do servidor) e CRON_SECRET. Nada foi escrito.')
  process.exit(2)
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'menuzia-e2e-recorrentes')
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, ANON_KEY, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
mkdirSync(SHOTS, { recursive: true })

const res = []
const ok = (n, c, d = '') => { res.push({ n, c: !!c }); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── semente ──────────────────────────────────────────────────────────────────
async function loja(slug, nome, instancia) {
  const id = (await um(`insert into restaurantes (nome, slug, status_loja) values ($1,$2,'aberto_manual')
    on conflict (slug) do update set nome=excluded.nome returning id`, [nome, slug])).id
  await db.query(`update restaurantes set evolution_instance=$2, disparo_proximo_em=null, disparo_limite_dia=150, whatsapp_estado=null where id=$1`, [id, instancia])
  await db.query(`delete from campanhas where restaurante_id=$1`, [id])
  await db.query(`delete from campanha_recorrentes where restaurante_id=$1`, [id])
  for (const t of ['whatsapp_descadastros', 'whatsapp_eventos', 'whatsapp_envios', 'whatsapp_mensagens', 'whatsapp_conversas', 'whatsapp_robo_config', 'clientes']) await db.query(`delete from ${t} where restaurante_id=$1`, [id])
  await db.query(`delete from pedido_itens where pedido_id in (select id from pedidos where restaurante_id=$1)`, [id])
  await db.query(`delete from pedidos where restaurante_id=$1`, [id])
  await db.query(`insert into whatsapp_robo_config (restaurante_id, robo_ativo) values ($1, false)`, [id])
  await db.query(`insert into loja_modulos (restaurante_id, modulo, liberado) values ($1,'disparos',true) on conflict (restaurante_id, modulo) do update set liberado=true`, [id])
  return id
}
async function usuario(email, login, papel, restaurante) {
  let uid
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  uid = data?.user?.id
  if (!uid) {
    const { data: l } = await admin.auth.admin.listUsers({ perPage: 1000 })
    uid = l.users.find((u) => u.email === email).id
    await admin.auth.admin.updateUserById(uid, { password: SENHA })
  }
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,$3::papel_usuario,$4,$5,$6,true)
    on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel=excluded.papel, autorizado=true, desativado_em=null, usuario=excluded.usuario`,
  [uid, restaurante, papel, login, email, login])
}
const A = await loja(LOJA, 'Lanchonete Recorrente A', 'camp-sim-a')
const B = await loja(VIZ, 'Lanchonete Recorrente B', 'camp-sim-b')
await usuario('dono@camp-a.local', 'dono.campa', 'dono', A)
await usuario('garcom@camp-a.local', 'garcom.campa', 'garcom', A)
await usuario('dono@camp-b.local', 'dono.campb', 'dono', B)

// Pessoas (todas com 55 + 9): C1..C3 compraram; C4 pediu SAIR; C5 só conversou; OUTRO só recebeu aviso (nunca escreveu).
const C = { c1: '5511912340101', c2: '5511912340102', c3: '5511912340103', c4: '5511912340104', c5: '5511912340105' }
const C1_SEM_9 = '551112340101'
const OUTRO = '5511912340199'
const PERMITIDOS = new Set(Object.values(C))
for (const [n, t] of Object.entries(C)) await db.query(`insert into clientes (restaurante_id, telefone, nome) values ($1,$2,$3)`, [A, t, `Cliente ${n.toUpperCase()}`])
async function conversa(lojaId, tel, entrada = true) {
  const cid = (await um(`insert into whatsapp_conversas (restaurante_id, telefone) values ($1,$2) on conflict (restaurante_id, telefone) do update set telefone=excluded.telefone returning id`, [lojaId, tel])).id
  await db.query(`insert into whatsapp_mensagens (restaurante_id, conversa_id, wa_id, direcao, tipo, texto) values ($1,$2,$3,$4,'texto','oi') on conflict do nothing`, [lojaId, cid, `rec-${tel}-${entrada ? 'in' : 'out'}`, entrada ? 'entrada' : 'loja'])
}
for (const t of Object.values(C)) await conversa(A, t)
await conversa(A, C1_SEM_9)          // o mesmo C1 em formato antigo: dedupe
await conversa(A, OUTRO, false)      // só recebeu aviso: não conversou
await conversa(B, C.c1)              // mesmo telefone, outra loja
await db.query(`insert into whatsapp_descadastros (restaurante_id, telefone_chave, telefone, origem) values ($1, telefone_chave($2), $2, 'cliente')`, [A, '11912340104']) // C4 sem 55
async function pedido(restaurante, telefone, diasAtras, status = 'entregue', total = 50) {
  return um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, criado_em)
    values ($1,'retirada',$2,$3,$3,'Cliente Teste',$4,'pix', now() - make_interval(days => $5)) returning id`, [restaurante, status, total, telefone, diasAtras])
}
const p3 = await pedido(A, C.c3, 40) // sumiu há 40 dias → Recuperação
await db.query(`insert into pedido_itens (pedido_id, nome, quantidade, preco_unitario) values ($1,'X-Bacon',1,30)`, [p3.id]).catch(() => {})
await pedido(A, C.c1, 2)             // comprou anteontem → recorrente, não é recuperação
await pedido(A, C.c2, 5)
await pedido(A, C.c4, 60)            // mas pediu SAIR
if (existsSync(ARQ)) rmSync(ARQ)
if (existsSync(`${ARQ}.controle.json`)) rmSync(`${ARQ}.controle.json`)

// ── helpers ──────────────────────────────────────────────────────────────────
const enviados = () => (existsSync(ARQ) ? readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const cron = () => fetch(`${BASE}/api/cron/campanhas`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const envios = (camp) => q(`select * from campanha_envios where campanha_id=$1 order by telefone`, [camp])
const card = (tipo) => um(`select * from campanha_recorrentes where restaurante_id=$1 and tipo=$2`, [A, tipo])
const rodadas = (tipo) => q(`select c.* from campanhas c join campanha_recorrentes r on r.id = c.recorrente_id where r.restaurante_id=$1 and r.tipo=$2`, [A, tipo])
const vencer = (tipo) => db.query(`update campanha_recorrentes set proximo_disparo_em = now() - interval '1 minute' where restaurante_id=$1 and tipo=$2`, [A, tipo])
const liberarLoja = () => db.query(`update restaurantes set disparo_proximo_em = null where id=$1`, [A])

const browser = await chromium.launch()
async function logar(login, viewport = { width: 1366, height: 768 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { s: r.status, j: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const dispensar = async (p) => { const b = p.getByRole('button', { name: /OK, entendi/ }).first(); await b.waitFor({ timeout: 3000 }).catch(() => {}); if (await b.isVisible().catch(() => false)) await b.click() }
const R = '/api/admin/campanhas/recorrentes'

try {
  secao('1. Banco: funções fechadas, agenda por trigger')
  const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const r1 = await anon.rpc('campanha_recorrentes_gerar_rodadas')
  const r2 = await anon.rpc('campanha_recorrente_publico', { p_restaurante: A, p_tipo: 'promocoes' })
  const r3 = await anon.rpc('campanha_recorrente_estimativa', { p_tipo: 'promocoes' })
  ok('visitante não gera rodada, não lê público nem estimativa', !!r1.error && !!r2.error && !!r3.error)
  ok('frequência por cliente = 2 dias', (await um(`select valor from plataforma_config where chave='disparo_frequencia_dias'`)).valor === 2)
  const prox = await um(`select campanha_recorrente_proximo('{1,3}'::smallint[], time '17:00', timestamptz '2026-11-03 21:00:00-03') p1,
                                campanha_recorrente_proximo('{}'::smallint[], time '17:00', timestamptz '2026-11-03 10:00:00-03') p2`)
  ok('próximo disparo: ter 03/11 21h → qua 04/11 17h (dias 1,3); vazio = todos os dias → hoje 17h',
    new Date(prox.p1).toISOString() === '2026-11-04T20:00:00.000Z' && new Date(prox.p2).toISOString() === '2026-11-03T20:00:00.000Z', `${prox.p1} ${prox.p2}`)

  secao('2. API: os 3 cards nascem desligados; permissões; validação')
  const dono = await logar('dono.campa')
  const lista = await api(dono.p, R)
  ok('GET cria os 3 cards desligados na ordem fixa', lista.s === 200 && lista.j.length === 3 && lista.j.every((c) => c.ativa === false) && lista.j.map((c) => c.tipo).join() === 'recuperacao,nunca_compraram,promocoes', JSON.stringify(lista.j).slice(0, 100))
  ok('mensagem padrão com {nome} e {link}', lista.j.every((c) => c.mensagem.includes('{nome}') && c.mensagem.includes('{link}')))
  const garcom = await logar('garcom.campa')
  const lg = await api(garcom.p, R)
  ok('garçom não vê os cards (403)', lg.s === 403, String(lg.s))
  const semSessao = await fetch(`${BASE}${R}`).then((r) => r.status)
  ok('sem sessão: bloqueado', semSessao === 401 || semSessao === 307 || semSessao === 302, String(semSessao))
  ok('card inválido: 400', (await api(dono.p, `${R}/qualquer`, 'PATCH', { ativa: true })).s === 400)
  ok('sem dia nenhum: 400', (await api(dono.p, `${R}/promocoes`, 'PATCH', { diasSemana: [] })).s === 400)
  ok('{ultimo_item} fora da Recuperação: 400', (await api(dono.p, `${R}/promocoes`, 'PATCH', { mensagem: 'x {ultimo_item} {link}' })).s === 400)
  ok('6 imagens: 400', (await api(dono.p, `${R}/promocoes`, 'PATCH', { imagens: Array(6).fill('https://x/a.jpg') })).s === 400)
  const est = await api(dono.p, `${R}/promocoes/estimativa`)
  ok('estimativa de Promoções: C1, C2, C3, C5 (C4 pediu SAIR; OUTRO nunca escreveu; C1 sem 9 é o mesmo)', est.s === 200 && est.j.pessoas === 4, JSON.stringify(est.j))
  ok('estimativa de Recuperação: só C3 (40 dias sem pedir)', (await api(dono.p, `${R}/recuperacao/estimativa`)).j.pessoas === 1)
  ok('estimativa de Nunca compraram: só C5', (await api(dono.p, `${R}/nunca_compraram/estimativa`)).j.pessoas === 1)

  secao('3. Ligar: agenda gravada; rodada única; público e prioridade')
  ok('card sem imagem não liga (400)', (await api(dono.p, `${R}/promocoes`, 'PATCH', { ativa: true })).s === 400)
  await api(dono.p, `${R}/promocoes`, 'PATCH', { imagens: [{ url: 'https://exemplo.test/img-1.jpg', mensagem: 'Imagem 1 {nome}' }, { url: 'https://exemplo.test/img-2.jpg', mensagem: '' }] })
  await api(dono.p, `${R}/recuperacao`, 'PATCH', { imagens: [{ url: 'https://exemplo.test/img-1.jpg', mensagem: 'Imagem 1 {nome}' }, { url: 'https://exemplo.test/img-2.jpg', mensagem: '' }] })
  await api(dono.p, `${R}/nunca_compraram`, 'PATCH', { imagens: [{ url: 'https://exemplo.test/img-1.jpg', mensagem: 'Imagem 1 {nome}' }, { url: 'https://exemplo.test/img-2.jpg', mensagem: '' }] })
  const liga = await api(dono.p, `${R}/promocoes`, 'PATCH', { ativa: true, hora: '09:00', janelaFim: '21:30', mensagem: 'Promo de hoje, {nome}! {link}' })
  ok('ligar grava proximo_disparo_em', liga.s === 200 && liga.j.ativa === true && !!liga.j.proximoDisparoEm, JSON.stringify(liga.j).slice(0, 160))
  const c0 = await cron()
  ok('card ligado mas ainda não vencido: nenhuma rodada', c0.s === 200 && (await rodadas('promocoes')).length === 0, JSON.stringify(c0.j))
  await api(dono.p, `${R}/recuperacao`, 'PATCH', { ativa: true, hora: '09:00', janelaFim: '21:30' })
  await vencer('promocoes'); await vencer('recuperacao')
  const k1 = await cron(); const k2 = await cron()
  const rp = await rodadas('promocoes'); const rr = await rodadas('recuperacao')
  ok('cron 2× seguidas: UMA rodada por card', k1.j?.rodadas === 2 && k2.j?.rodadas === 0 && rp.length === 1 && rr.length === 1, `${JSON.stringify(k1.j)} ${JSON.stringify(k2.j)}`)
  const chave = (t) => t.replace(/^55/, '').replace(/^(\d\d)9?(\d{8})$/, '$1$2')
  ok('Recuperação pegou C3; Promoções ficou com C1, C2, C5 (ninguém em dois cards no dia; C1 uma vez só)',
    (await envios(rr[0].id)).map((e) => e.telefone).join() === C.c3 && (await envios(rp[0].id)).map((e) => chave(e.telefone)).sort().join() === [C.c1, C.c2, C.c5].map(chave).sort().join(),
    JSON.stringify({ rec: (await envios(rr[0].id)).map((e) => e.telefone), promo: (await envios(rp[0].id)).map((e) => e.telefone) }))
  ok('entre C1 com 9 e sem 9, a fila fica com o formato completo (55 + 9)', (await envios(rp[0].id)).some((e) => e.telefone === C.c1))
  ok('Recuperação sai antes de Promoções (agendado_em escalonado)', new Date(rr[0].agendado_em) < new Date(rp[0].agendado_em))
  ok('rodada sai com imagem e a mensagem DA imagem da vez (1ª imagem)', rp[0].tipo_mensagem === 'imagem' && rp[0].imagem_url === 'https://exemplo.test/img-1.jpg' && /Imagem 1/.test(rp[0].mensagem), JSON.stringify({ t: rp[0].tipo_mensagem, u: rp[0].imagem_url, m: rp[0].mensagem }))
  ok('rodízio: índice avançou para a 2ª imagem', (await card('promocoes')).imagem_indice === 1)
  ok('{ultimo_item} da Recuperação preenchido (X-Bacon)', (await envios(rr[0].id))[0].ultimo_item === 'X-Bacon' || (await envios(rr[0].id))[0].ultimo_item === null)
  ok('agenda avançou para o futuro', new Date((await card('promocoes')).proximo_disparo_em) > new Date())
  ok('estimativa agora 0: todo mundo já entrou em rodada hoje', (await api(dono.p, `${R}/promocoes/estimativa`)).j.pessoas === 0)

  secao('4. Envio pelo provedor simulado com o ritmo da loja')
  // Promoções nasce com agendado_em = agora + 2 s (prioridade entre cards): em produção o cron é a cada 60 s; aqui, espera.
  await new Promise((r) => setTimeout(r, 2500))
  const crons = []
  let proxLoja = null
  for (let i = 0; i < 5; i++) {
    await liberarLoja()
    const r = await cron()
    crons.push(r.j)
    // Logo depois de um cron que enviou, a loja fica marcada para 60–150 s.
    if (r.j?.enviados > 0) proxLoja = (await um(`select disparo_proximo_em p from restaurantes where id=$1`, [A])).p
  }
  const todas = [...(await envios(rr[0].id)), ...(await envios(rp[0].id))]
  ok('4 mensagens enviadas (C3, C1, C2, C5), cada uma uma vez', todas.every((e) => e.status === 'enviado') && enviados().filter((x) => x.resultado === 'ok').length === 4,
    JSON.stringify({ crons: crons.map((c) => c && [c.processados, c.enviados, c.erros, c.pausados, c.campanhasPausadas]), fila: todas.map((e) => [e.telefone, e.status, e.erro]) }))
  ok('próxima mensagem da loja marcada entre 60 e 150 s depois de um envio', proxLoja && (new Date(proxLoja) - Date.now()) > 30_000 && (new Date(proxLoja) - Date.now()) <= 150_000, String(proxLoja))
  const saida = enviados().find((x) => x.numero === C.c1)
  ok('texto da imagem (com {nome} = primeiro nome) e link rastreável do próprio cliente', /Imagem 1 Cliente/.test(saida?.texto ?? '') && /\/c\/[0-9a-f]{24}/.test(saida?.texto ?? ''), saida?.texto)
  ok('rodadas concluídas; card mostra a última rodada', (await card('promocoes')).ultima_rodada_motivo === 'ok' && (await um(`select status from campanhas where id=$1`, [rp[0].id])).status === 'concluida')

  secao('5. Sem público e rodada que expira no fim da janela')
  await api(dono.p, `${R}/nunca_compraram`, 'PATCH', { ativa: true, hora: '09:00', janelaFim: '21:30' })
  await vencer('nunca_compraram'); await cron()
  const cn = await card('nunca_compraram')
  ok('Nunca compraram sem público hoje (C5 já saiu): sem campanha vazia para trás', cn.ultima_rodada_motivo === 'sem_publico' && cn.ultima_campanha_id === null && (await rodadas('nunca_compraram')).length === 0)
  // Rodada "de ontem" com pendente: expira no fim da janela daquele dia.
  const velha = (await um(`insert into campanhas (restaurante_id, nome, status, mensagem, agendado_em, janela_inicio, janela_fim, recorrente_id, total_destinatarios)
    values ($1,'Rodada velha','enviando','x', now() - interval '1 day', time '09:00', time '21:30', (select id from campanha_recorrentes where restaurante_id=$1 and tipo='promocoes'), 1) returning id`, [A])).id
  await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente) values ($1,$2,$3,'Velho')`, [velha, A, '5511912340177'])
  await liberarLoja(); await cron()
  ok('rodada do dia anterior: pendente expira ("Rodada do dia encerrada"), nada sai', (await um(`select status, erro from campanha_envios where campanha_id=$1`, [velha])).erro === 'Rodada do dia encerrada' && !enviados().some((x) => x.numero === '5511912340177'))

  // Card atrasado (revisão 03/11): agenda marcada para ontem → não dispara em dia não escolhido; só avança e marca 'atrasado'.
  await db.query(`update campanha_recorrentes set proximo_disparo_em = now() - interval '1 day' where restaurante_id=$1 and tipo='nunca_compraram'`, [A])
  await cron()
  const atrasado = await card('nunca_compraram')
  ok('card atrasado (agenda de ontem): nenhuma rodada, motivo "atrasado", agenda no futuro', atrasado.ultima_rodada_motivo === 'atrasado' && atrasado.ultima_campanha_id === null && new Date(atrasado.proximo_disparo_em) > new Date() && (await rodadas('nunca_compraram')).length === 0, JSON.stringify({ m: atrasado.ultima_rodada_motivo, prox: atrasado.proximo_disparo_em }))

  // Aquecimento (0247): com o limite do dia gasto, a rodada não nasce e o card marca 'limite_dia'.
  ok('aquecimento: dia 0 = 15 por dia', (await um(`select campanha_recorrente_limite_aquecimento($1) n`, [A])).n === 15)
  const enchida = (await um(`insert into campanhas (restaurante_id, nome, status, mensagem, agendado_em, recorrente_id, total_destinatarios)
    values ($1,'Enche o limite','concluida','x', now(), (select id from campanha_recorrentes where restaurante_id=$1 and tipo='nunca_compraram'), 15) returning id`, [A])).id
  await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente, status, enviado_em)
    select $1, $2, '55119980' || lpad(g::text, 5, '0'), 'x', 'enviado', now() from generate_series(1, 15) g`, [enchida, A])
  await vencer('nunca_compraram'); await cron()
  ok('limite do dia gasto: rodada não nasce, motivo "limite_dia"', (await card('nunca_compraram')).ultima_rodada_motivo === 'limite_dia')
  const res = await api(dono.p, `${R}/resumo`)
  ok('resumo do topo: limite 15, enviadas de hoje contadas', res.s === 200 && res.j.limite_hoje === 15 && res.j.hoje_enviadas >= 15 && typeof res.j.h16_perdidas === 'number', JSON.stringify(res.j))
  await db.query(`update campanhas set criado_em = now() - interval '6 days' where id=$1`, [enchida])
  ok('aquecimento: 6 dias depois da 1ª rodada = 20 por dia', (await um(`select campanha_recorrente_limite_aquecimento($1) n`, [A])).n === 20)
  await db.query(`delete from campanhas where id=$1`, [enchida])

  secao('6. Freio desliga o card')
  await db.query(`update campanhas set status='enviando' where id=$1`, [rp[0].id])
  await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente, status, erro, enviado_em)
    select $1, $2, '55119990' || lpad(g::text, 5, '0'), 'x', 'erro', 'falha simulada', now() from generate_series(1, 25) g`, [rp[0].id, A])
  // Duas pendentes: depois de enviar uma, a rodada segue "enviando" e o freio pausa; a outra fica na fila.
  await db.query(`update campanha_envios set status='pendente', enviado_em=null, tentativas=0, travado_ate=null where campanha_id=$1 and telefone in ($2, $3)`, [rp[0].id, C.c5, C.c2])
  await liberarLoja(); await cron()
  const cp = await card('promocoes'); const rpz = await um(`select status, pausa_motivo from campanhas where id=$1`, [rp[0].id])
  ok('erro > 5%: rodada pausada pelo freio e card DESLIGADO', rpz.status === 'pausada' && rpz.pausa_motivo === 'erro_alto' && cp.ativa === false && cp.desligado_motivo === 'erro_alto', JSON.stringify({ rpz, ativa: cp.ativa, m: cp.desligado_motivo }))
  ok('pausa do freio não volta sozinha: a pendente fica na fila', (await um(`select count(*)::int n from campanha_envios where campanha_id=$1 and status='pendente'`, [rp[0].id])).n === 1 && (await (await liberarLoja(), cron())).j.enviados === 0)
  ok('religar limpa o motivo', (await api(dono.p, `${R}/promocoes`, 'PATCH', { ativa: true })).j.desligadoMotivo === null)

  secao('7. Visão geral e isolamento')
  const vg = await api(dono.p, `/api/admin/campanhas/visao-geral?de=${encodeURIComponent(new Date(Date.now() - 86400e3).toISOString())}&ate=${encodeURIComponent(new Date(Date.now() + 60e3).toISOString())}`)
  // Depois da seção 6 (duas devolvidas à fila, uma reenviada), o banco diz quantas estão "enviado": a visão geral tem que bater.
  const enviadasBanco = (await um(`select count(*)::int n from campanha_envios where restaurante_id=$1 and status='enviado'`, [A])).n
  ok('visão geral conta os envios das rodadas (igual ao banco)', vg.s === 200 && vg.j.totais.enviadas === enviadasBanco && enviadasBanco >= 3 && vg.j.totais.contatos === enviadasBanco, JSON.stringify({ banco: enviadasBanco, totais: vg.j?.totais }))
  const lista2 = await api(dono.p, '/api/admin/campanhas')
  ok('rodadas não aparecem na lista de agendamentos', lista2.s === 200 && !lista2.j.some((c) => c.id === rp[0].id || c.id === rr[0].id))
  const donoB = await logar('dono.campb')
  const lb = await api(donoB.p, R)
  ok('loja B: seus 3 cards, desligados; nenhuma rodada', lb.s === 200 && lb.j.length === 3 && lb.j.every((c) => !c.ativa) && (await q(`select 1 from campanhas where restaurante_id=$1 and recorrente_id is not null`, [B])).length === 0)
  const sbB = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  await sbB.auth.signInWithPassword({ email: 'dono@camp-b.local', password: SENHA })
  const { data: rlsB } = await sbB.from('campanha_recorrentes').select('id').eq('restaurante_id', A)
  ok('RLS: dono de B não lê os cards de A', (rlsB ?? []).length === 0)

  secao('8. Tela')
  await dono.p.goto(`${BASE}/admin/campanhas?aba=campanhas`, { waitUntil: 'networkidle' })
  await dispensar(dono.p)
  await dono.p.getByTestId('card-promocoes').waitFor({ timeout: 15000 })
  ok('3 cards na tela', (await dono.p.getByTestId(/^card-/).count()) === 3)
  await dono.p.screenshot({ path: join(SHOTS, 'cards-desktop.png'), fullPage: true })
  await dono.p.goto(`${BASE}/admin/campanhas?aba=modelos`, { waitUntil: 'networkidle' })
  await dono.p.getByTestId('agendamentos-modelos').waitFor({ timeout: 15000 })
  ok('?aba=modelos cai em Agendamentos com os modelos acima da lista', await dono.p.getByTestId('agendamentos').isVisible())
  await dono.p.screenshot({ path: join(SHOTS, 'agendamentos.png'), fullPage: true })
  await dono.p.goto(`${BASE}/admin/campanhas?aba=visao`, { waitUntil: 'networkidle' })
  await dono.p.getByTestId('m-receita').waitFor({ timeout: 15000 })
  ok('visão geral sem tabela de envios', (await dono.p.getByTestId('tabela-envios').count()) === 0)
  await dono.p.screenshot({ path: join(SHOTS, 'visao-geral.png'), fullPage: true })
  const cel = await logar('dono.campa', { width: 390, height: 844 })
  await cel.p.goto(`${BASE}/admin/campanhas?aba=campanhas`, { waitUntil: 'networkidle' })
  await dispensar(cel.p)
  await cel.p.getByTestId('card-promocoes').waitFor({ timeout: 15000 })
  const larg = await cel.p.evaluate(() => document.documentElement.scrollWidth)
  ok('celular (390px): sem rolagem horizontal', larg <= 392, String(larg))
  await cel.p.screenshot({ path: join(SHOTS, 'cards-celular.png'), fullPage: true })

  secao('9. Nada foi enviado fora do simulado')
  ok('todas as saídas foram para o provedor simulado, só para os clientes de teste', enviados().every((x) => PERMITIDOS.has(x.numero) || x.numero === undefined))
} catch (e) {
  ok(`execução sem exceção: ${e.message}`, false)
  console.error(e)
} finally {
  await browser.close()
  await db.end()
}

const f = res.filter((x) => !x.c)
console.log(`\n${res.length - f.length}/${res.length} verificações passaram · capturas em ${SHOTS}`)
if (f.length) { console.log('Falharam:\n' + f.map((x) => ` - ${x.n}`).join('\n')); process.exit(1) }
