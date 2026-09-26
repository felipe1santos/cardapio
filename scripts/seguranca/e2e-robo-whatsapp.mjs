/**
 * E2E do robô de atendimento do WhatsApp (0102) e da fila de avisos — provedor SIMULADO,
 * lojas isoladas, nenhuma comunicação externa.
 *
 * Trava obrigatória (aborta antes de QUALQUER escrita):
 *   ROBO_E2E_LOJA=robo-e2e-a  ROBO_E2E_VIZINHA=robo-e2e-b  (slugs começando com robo-e2e)
 *   ROBO_PROVEDOR=simulado     WHATSAPP_SIMULADO_ARQUIVO=<arquivo>  (o MESMO do servidor)
 * O servidor local precisa subir com WHATSAPP_PROVEDOR=simulado, o mesmo
 * WHATSAPP_SIMULADO_ARQUIVO e CRON_SECRET. O servidor-local.mjs já apaga as variáveis da
 * Evolution: mesmo sem simulado, nada sairia para fora.
 *
 *   SHOTS=<pasta> node scripts/seguranca/e2e-robo-whatsapp.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const LOJA = process.env.ROBO_E2E_LOJA
const VIZ = process.env.ROBO_E2E_VIZINHA
const ARQ = process.env.WHATSAPP_SIMULADO_ARQUIVO
if (!LOJA || !VIZ || !LOJA.startsWith('robo-e2e') || !VIZ.startsWith('robo-e2e') || LOJA === VIZ
  || process.env.ROBO_PROVEDOR !== 'simulado' || !ARQ || !process.env.CRON_SECRET) {
  console.error('Trava: informe ROBO_E2E_LOJA e ROBO_E2E_VIZINHA (robo-e2e-*), ROBO_PROVEDOR=simulado,\n'
    + 'WHATSAPP_SIMULADO_ARQUIVO (o mesmo do servidor) e CRON_SECRET. Nada foi escrito.')
  process.exit(2)
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'menuzia-e2e-robo')
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, ANON_KEY, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
mkdirSync(SHOTS, { recursive: true })

const res = []
const ok = (n, c, d = '') => { res.push({ n, c: !!c }); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── semente das duas lojas isoladas ─────────────────────────────────────────
async function loja(slug, nome, instancia) {
  const id = (await um(`insert into restaurantes (nome, slug, status_loja) values ($1,$2,'aberto_manual')
    on conflict (slug) do update set nome=excluded.nome returning id`, [nome, slug])).id
  await db.query(`update restaurantes set evolution_instance=$2 where id=$1`, [id, instancia])
  for (const t of ['whatsapp_envios', 'whatsapp_mensagens', 'whatsapp_conversas', 'whatsapp_robo_config']) await db.query(`delete from ${t} where restaurante_id=$1`, [id])
  await db.query(`delete from pedido_itens where pedido_id in (select id from pedidos where restaurante_id=$1)`, [id])
  await db.query(`delete from pedidos where restaurante_id=$1`, [id])
  await db.query(`insert into whatsapp_robo_config (restaurante_id, robo_ativo) values ($1, false)`, [id])
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
const A = await loja(LOJA, 'Lanchonete Robô A', 'robo-sim-a')
const B = await loja(VIZ, 'Lanchonete Robô B', 'robo-sim-b')
await usuario('dono@robo-a.local', 'dono.roboa', 'dono', A)
await usuario('gerente@robo-a.local', 'gerente.roboa', 'gerente', A)
await usuario('garcom@robo-a.local', 'garcom.roboa', 'garcom', A)
await usuario('dono@robo-b.local', 'dono.robob', 'dono', B)
const CLI = '5511912340001' // cliente A (fictício; DDD 11, prefixo reservado de teste)
const CLI_B = '5511912340002' // telefone "parecido", cliente só da loja B
const LOJA_NUM = '5511900000000'
async function pedido(restaurante, telefone, status, tipo = 'retirada') {
  return um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento)
    values ($1,$2,$3,20,20,'Cliente Teste',$4,'pix') returning id, numero`, [restaurante, tipo, status, telefone])
}
// Pedido de A gravado SEM o nono dígito e com 55 (formato antigo): o robô tem que achar.
const pedA = await pedido(A, '551112340001', 'preparando')
const pedB = await pedido(B, CLI_B, 'em_rota', 'entrega')
await pedido(B, CLI, 'cancelado') // mesmo telefone do cliente A, mas na loja B: nunca aparece em A
const SEG_A = (await um(`select webhook_segredo s from whatsapp_robo_config where restaurante_id=$1`, [A])).s
const SEG_B = (await um(`select webhook_segredo s from whatsapp_robo_config where restaurante_id=$1`, [B])).s
if (existsSync(ARQ)) rmSync(ARQ)
if (existsSync(`${ARQ}.controle.json`)) rmSync(`${ARQ}.controle.json`)

// ── helpers ─────────────────────────────────────────────────────────────────
let seq = 0
const evento = (inst, { de = CLI, texto = 'oi', id = `WAID${Date.now()}${seq++}`, fromMe = false, jid, message } = {}) => ({
  event: 'messages.upsert', instance: inst, sender: `${LOJA_NUM}@s.whatsapp.net`, apikey: 'segredo-da-instancia-nao-logar',
  data: { key: { remoteJid: jid ?? `${de}@s.whatsapp.net`, fromMe, id }, message: message ?? { conversation: texto }, messageTimestamp: Math.floor(Date.now() / 1000) },
})
const webhook = async (segredo, corpo) => {
  const r = await fetch(`${BASE}/api/whatsapp/webhook/${segredo}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) })
  return { s: r.status, j: await r.json().catch(() => null) }
}
const enviados = () => (existsSync(ARQ) ? readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const envios = (loja) => q(`select tipo, estado, telefone, texto, tentativas, chave from whatsapp_envios where restaurante_id=$1 order by criado_em`, [loja])
const conversa = (loja, tel = CLI) => um(`select * from whatsapp_conversas where restaurante_id=$1 and telefone=$2`, [loja, tel])
const cron = () => fetch(`${BASE}/api/cron/whatsapp`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const controle = (c) => writeFileSync(`${ARQ}.controle.json`, JSON.stringify(c))
const recuar = (loja, horas, tel = CLI) => db.query(`update whatsapp_conversas set ultima_mensagem_em = now() - ($3 || ' hours')::interval where restaurante_id=$1 and telefone=$2`, [loja, tel, String(horas)])
const ultimo = async (loja) => (await envios(loja)).at(-1)

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

try {
  secao('1. Webhook: segredo, corpo e robô desligado')
  ok('segredo inexistente → 404', (await webhook('0'.repeat(48), evento('robo-sim-a'))).s === 404)
  ok('segredo fora do formato → 404', (await webhook('abc', evento('robo-sim-a'))).s === 404)
  ok('corpo inválido → 400', (await webhook(SEG_A, '{nao-json')).s === 400)
  ok('corpo acima de 256 KB → 413', (await webhook(SEG_A, JSON.stringify({ x: 'a'.repeat(300 * 1024) }))).s === 413)
  const desl = await webhook(SEG_A, evento('robo-sim-a'))
  ok('robô desligado: nada gravado nem respondido', desl.s === 200 && desl.j?.ignoradas?.robo_desligado === 1 && (await envios(A)).length === 0 && !(await conversa(A)))

  secao('2. Painel: ligar o robô (dono) e permissões')
  const dono = await logar('dono.roboa')
  await dono.p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'networkidle' })
  await dispensar(dono.p)
  await dono.p.getByTestId('robo-whatsapp').getByTestId('robo-alternar').click()
  await dono.p.getByTestId('robo-estado').filter({ hasText: /^Ligado$/ }).waitFor({ timeout: 10000 })
  ok('dono liga o robô pela tela', (await um(`select robo_ativo from whatsapp_robo_config where restaurante_id=$1`, [A])).robo_ativo === true)
  for (const [login, esperado] of [['gerente.roboa', 403], ['garcom.roboa', 403]]) {
    const s = await logar(login)
    const r = await api(s.p, '/api/admin/whatsapp/robo', 'PUT', { roboAtivo: false })
    ok(`${login.split('.')[0]}: não configura o robô (${esperado})`, r.s === esperado && (await um(`select robo_ativo from whatsapp_robo_config where restaurante_id=$1`, [A])).robo_ativo === true, `HTTP ${r.s}`)
    await s.ctx.close()
  }
  const semSessao = await fetch(`${BASE}/api/admin/whatsapp/robo`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"roboAtivo":false}' })
  ok('sem sessão: recusado', semSessao.status === 401 || semSessao.status === 307 || semSessao.redirected, `HTTP ${semSessao.status}`)
  const g = await api(dono.p, '/api/admin/whatsapp/robo')
  ok('GET do painel não expõe o segredo do webhook', g.s === 200 && !JSON.stringify(g.j).includes(SEG_A) && !('webhookSegredo' in (g.j ?? {})))
  await db.query(`update whatsapp_robo_config set robo_ativo=true where restaurante_id=$1`, [B])

  secao('3. Boas-vindas, duplicada, padrão e janela de 12h')
  const e1 = evento('robo-sim-a', { texto: 'oi', id: 'MSG-OI-1' })
  const r1 = await webhook(SEG_A, e1)
  const env1 = await envios(A)
  ok('primeira mensagem → boas-vindas com nome da loja e link', r1.s === 200 && env1.length === 1 && env1[0].tipo === 'robo' && env1[0].estado === 'enviado' && env1[0].texto.includes('Lanchonete Robô A') && env1[0].texto.includes(`/loja/${LOJA}`))
  const sim1 = enviados()
  ok('provedor simulado recebeu 1 envio, para o cliente, pela instância da loja A', sim1.length === 1 && sim1[0].numero === CLI && sim1[0].instancia === 'robo-sim-a')
  const r1b = await webhook(SEG_A, e1)
  ok('mesma mensagem reentregue → ignorada, sem segunda resposta', r1b.j?.ignoradas?.duplicada === 1 && (await envios(A)).length === 1 && enviados().length === 1)
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'qual o horário de vocês?' }))
  const env2 = await ultimo(A)
  ok('texto não reconhecido dentro da janela → resposta padrão (sem boas-vindas de novo)', (await envios(A)).length === 2 && env2.texto.includes('cardápio') && !env2.texto.includes('atendimento automático'))
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'hmm' }))
  ok('resposta padrão no máximo 1 a cada 10 min (sem excesso de mensagens)', (await envios(A)).length === 2)
  for (const [nome, message] of [['áudio', { audioMessage: {} }], ['imagem', { imageMessage: {} }], ['figurinha', { stickerMessage: {} }], ['localização', { locationMessage: {} }]]) {
    await db.query(`update whatsapp_conversas set resposta_padrao_em = null where restaurante_id=$1 and telefone=$2`, [A, CLI])
    await webhook(SEG_A, evento('robo-sim-a', { message }))
    const u = await ultimo(A)
    ok(`${nome} → resposta padrão com link e opção de atendente`, u.texto.includes(`/loja/${LOJA}`) && u.texto.includes('*2*'))
  }
  await recuar(A, 13)
  const antes12 = (await envios(A)).length
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'boa noite' }))
  ok('depois de 12h sem conversa → boas-vindas de novo', (await envios(A)).length === antes12 + 1 && (await ultimo(A)).texto.includes('atendimento automático'))

  secao('4. Status do pedido — só do telefone e da loja certos')
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'cadê meu pedido?' }))
  const st = await ultimo(A)
  ok('status do último pedido deste telefone (gravado sem o 9) com o rótulo da vitrine', st.texto.includes(`#${pedA.numero}`) && st.texto.includes('Preparando'), st.texto.slice(0, 80))
  ok('não revela o pedido da loja B do mesmo telefone (cancelado)', !st.texto.includes('Cancelado'))
  await webhook(SEG_A, evento('robo-sim-a', { de: CLI_B, texto: '1' }))
  const stB = await ultimo(A)
  ok('telefone parecido, com pedido só na loja B → "não encontrei" na loja A', stB.telefone === CLI_B && stB.texto.includes('Não encontrei pedido'))
  await webhook(SEG_B, evento('robo-sim-b', { de: CLI_B, texto: 'status' }))
  const stB2 = await ultimo(B)
  ok('na loja B, o mesmo cliente vê o pedido da B', stB2.texto.includes(`#${pedB.numero}`) && stB2.texto.includes('Saiu para entrega'))
  ok('instância do corpo de outra loja com o segredo da A → ignorado', (await webhook(SEG_A, evento('robo-sim-b', { texto: 'oi' }))).j?.ignoradas?.instancia_de_outra_loja === 1)
  ok('conversas separadas por loja', (await q(`select restaurante_id from whatsapp_conversas where telefone=$1`, [CLI_B])).length === 2)

  secao('5. Atendente, silêncio, devolução e volta após 2h')
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'quero falar com uma pessoa' }))
  const at = await ultimo(A)
  const cv = await conversa(A)
  ok('"falar com pessoa" → aviso de atendente e conversa silenciada (cliente)', at.texto.includes('Vou chamar alguém') && cv.estado === 'silenciada' && cv.silenciada_motivo === 'cliente')
  const nAt = (await envios(A)).length
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'alô?' }))
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'cadê meu pedido' }))
  ok('silenciada: o robô não responde mais nada', (await envios(A)).length === nAt)
  await dono.p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'networkidle' })
  await dispensar(dono.p)
  await dono.p.getByTestId('robo-silenciadas').waitFor({ timeout: 10000 })
  const lista = await dono.p.getByTestId('robo-silenciadas').innerText()
  ok('painel lista a conversa com o número mascarado', lista.includes('5511*****0001') && !lista.includes(CLI))
  await dono.p.screenshot({ path: join(SHOTS, 'integracoes-robo-silenciada-1366.png'), fullPage: true })
  await dono.p.getByTestId('robo-reativar').first().click()
  await dono.p.getByTestId('robo-sem-silenciadas').waitFor({ timeout: 10000 })
  ok('"Devolver ao robô" reativa', (await conversa(A)).estado === 'robo')
  await db.query(`update whatsapp_conversas set resposta_padrao_em = null where restaurante_id=$1 and telefone=$2`, [A, CLI])
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'e agora?' }))
  ok('depois de devolvido, o robô volta a responder', (await envios(A)).length === nAt + 1)
  await webhook(SEG_A, evento('robo-sim-a', { texto: '2' }))
  await recuar(A, 3)
  await db.query(`update whatsapp_conversas set resposta_padrao_em = null where restaurante_id=$1 and telefone=$2`, [A, CLI])
  const nVolta = (await envios(A)).length
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'oi de novo' }))
  ok('silenciada há mais de 2h sem mensagens → volta sozinho', (await envios(A)).length === nVolta + 1 && (await conversa(A)).estado === 'robo')
  const outra = await logar('dono.robob')
  const r = await api(outra.p, '/api/admin/whatsapp/robo/reativar', 'POST', { conversaId: (await conversa(A)).id })
  ok('dono da loja B não mexe em conversa da A', r.s === 404)
  await outra.ctx.close()

  secao('6. fromMe, grupos, status e número da loja')
  const nFm = (await envios(A)).length
  const rob = await ultimo(A)
  await webhook(SEG_A, evento('robo-sim-a', { fromMe: true, texto: rob.texto }))
  ok('eco da resposta do próprio robô (fromMe) → ignorado, conversa segue com o robô', (await conversa(A)).estado === 'robo')
  await webhook(SEG_A, evento('robo-sim-a', { fromMe: true, texto: 'Oi, aqui é o João da loja' }))
  ok('loja respondeu pelo celular (fromMe) → conversa silenciada (loja), sem resposta', (await conversa(A)).estado === 'silenciada' && (await conversa(A)).silenciada_motivo === 'loja' && (await envios(A)).length === nFm)
  const ig = await webhook(SEG_A, { ...evento('robo-sim-a'), data: [
    { key: { remoteJid: '120363000000000000@g.us', fromMe: false, id: 'G1', participant: `${CLI}@s.whatsapp.net` }, message: { conversation: 'oi grupo' } },
    { key: { remoteJid: 'status@broadcast', fromMe: false, id: 'S1' }, message: { conversation: 'status' } },
    { key: { remoteJid: `${LOJA_NUM}@s.whatsapp.net`, fromMe: false, id: 'L1' }, message: { conversation: 'eu mesmo' } },
    { key: { remoteJid: '999@lid', fromMe: false, id: 'LID1' }, message: { conversation: 'sem número' } },
  ] })
  ok('grupo, status/broadcast, número da loja e @lid sem número → ignorados', igual(ig.j?.ignoradas, { grupo: 1, difusao: 1, numero_da_loja: 1, sem_numero: 1 }) && (await envios(A)).length === nFm, JSON.stringify(ig.j?.ignoradas))

  secao('7. Concorrência: mensagens simultâneas e reentrega em paralelo')
  const NOVO = '5511912340009'
  const [x, y] = await Promise.all([
    webhook(SEG_A, evento('robo-sim-a', { de: NOVO, texto: 'oi', id: 'SIM-1' })),
    webhook(SEG_A, evento('robo-sim-a', { de: NOVO, texto: 'tudo bem?', id: 'SIM-2' })),
  ])
  const envNovo = (await envios(A)).filter((e) => e.telefone === NOVO)
  ok('duas mensagens simultâneas → uma boas-vindas só (a outra, padrão)', x.s === 200 && y.s === 200 && envNovo.filter((e) => e.texto.includes('atendimento automático')).length === 1 && envNovo.length === 2)
  const par = evento('robo-sim-a', { de: NOVO, texto: 'cadê', id: 'PAR-1' })
  await Promise.all([webhook(SEG_A, par), webhook(SEG_A, par), webhook(SEG_A, par)])
  ok('mesma mensagem entregue 3x em paralelo → uma resposta', (await envios(A)).filter((e) => e.telefone === NOVO).length === 3 && (await q(`select count(*)::int n from whatsapp_mensagens where wa_id='PAR-1'`))[0].n === 1)

  secao('8. Falha do provedor e novas tentativas')
  const TR = '5511912340010'
  controle({ falhar: 'transitorio', restantes: 1 })
  await webhook(SEG_A, evento('robo-sim-a', { de: TR, texto: 'oi' }))
  let e8 = (await envios(A)).find((e) => e.telefone === TR)
  ok('falha transitória → volta à fila com espera (tentativa 1)', e8.estado === 'pendente' && e8.tentativas === 1)
  ok('cron sem segredo → 401', (await fetch(`${BASE}/api/cron/whatsapp`, { method: 'POST' })).status === 401)
  await db.query(`update whatsapp_envios set proxima_tentativa_em = now() where telefone=$1`, [TR])
  const [c1, c2] = await Promise.all([cron(), cron()])
  e8 = (await envios(A)).find((e) => e.telefone === TR)
  const saidas = enviados().filter((s) => s.numero === TR)
  ok('dois crons em paralelo → reenviado UMA vez e marcado enviado', c1.s === 200 && c2.s === 200 && e8.estado === 'enviado' && e8.tentativas === 2 && saidas.filter((s) => s.resultado === 'ok').length === 1, JSON.stringify(saidas.map((s) => s.resultado)))
  const DF = '5511912340011'
  controle({ falhar: 'definitivo', restantes: 1 })
  await webhook(SEG_A, evento('robo-sim-a', { de: DF, texto: 'oi' }))
  await cron()
  ok('falha definitiva → "falhou", sem nova tentativa', (await envios(A)).find((e) => e.telefone === DF).estado === 'falhou' && enviados().filter((s) => s.numero === DF).length === 1)
  const IN = '5511912340012'
  controle({ falhar: 'incerto', restantes: 1 })
  await webhook(SEG_A, evento('robo-sim-a', { de: IN, texto: 'oi' }))
  await cron()
  ok('tempo esgotado (pode ter saído) → "incerto", sem reenvio automático', (await envios(A)).find((e) => e.telefone === IN).estado === 'incerto' && enviados().filter((s) => s.numero === IN).length === 1)
  await db.query(`update whatsapp_envios set estado='enviando', travado_ate=now() - interval '1 minute', tentativas=1 where telefone=$1`, [DF])
  await cron()
  ok('processo que caiu no meio do envio → "incerto", não reenviado', (await envios(A)).find((e) => e.telefone === DF).estado === 'incerto' && enviados().filter((s) => s.numero === DF).length === 1)

  secao('9. Aviso de etapa do pedido pela fila, sem duplicar')
  const antesAv = enviados().filter((s) => s.numero === '551112340001' && /pronto/i.test(s.texto ?? '')).length
  const cliques = await Promise.all([1, 2, 3].map(() => api(dono.p, `/api/pedidos/${pedA.id}/notificar`, 'POST', { status: 'pronto' })))
  await espera(500)
  const avisos = await q(`select estado, chave from whatsapp_envios where pedido_id=$1`, [pedA.id])
  const saiu = enviados().filter((s) => s.numero === '551112340001' && /pronto/i.test(s.texto ?? '')).length - antesAv
  ok('triplo clique em "pronto" → 1 aviso na fila e 1 envio', cliques.every((c) => c.s === 200) && avisos.length === 1 && avisos[0].chave === `pedido:${pedA.id}:pronto` && saiu === 1, JSON.stringify({ avisos, saiu }))
  const txt = enviados().filter((s) => s.numero === '551112340001').at(-1)?.texto ?? ''
  ok('texto do aviso é o de sempre', txt.includes(`Seu pedido *#${pedA.numero}* está *pronto*`))
  controle({ falhar: 'transitorio', restantes: 1 })
  await api(dono.p, `/api/pedidos/${pedA.id}/notificar`, 'POST', { status: 'entregue' })
  const avE = await um(`select estado, tentativas from whatsapp_envios where chave=$1`, [`pedido:${pedA.id}:entregue`])
  await db.query(`update whatsapp_envios set proxima_tentativa_em=now() where chave=$1`, [`pedido:${pedA.id}:entregue`])
  await cron()
  const avE2 = await um(`select estado, tentativas from whatsapp_envios where chave=$1`, [`pedido:${pedA.id}:entregue`])
  ok('aviso com falha transitória → nova tentativa pelo cron e enviado', avE.estado === 'pendente' && avE2.estado === 'enviado' && avE2.tentativas === 2)

  secao('10. RLS: leitura só da própria loja e só gestão')
  const cliente = async (email) => {
    const c = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
    await c.auth.signInWithPassword({ email, password: SENHA })
    return c
  }
  const cDonoA = await cliente('dono@robo-a.local')
  const vA = await cDonoA.from('whatsapp_conversas').select('restaurante_id')
  ok('dono A vê só conversas da A', !vA.error && vA.data.length > 0 && vA.data.every((x) => x.restaurante_id === A))
  const cfgA = await cDonoA.from('whatsapp_robo_config').select('webhook_segredo')
  ok('dono não lê a configuração (segredo) pelo navegador', !!cfgA.error || (cfgA.data ?? []).length === 0)
  const ins = await cDonoA.from('whatsapp_envios').insert({ restaurante_id: A, chave: 'x', tipo: 'robo', telefone: CLI, texto: 'x' })
  ok('dono não grava na fila pelo navegador', !!ins.error)
  const cGer = await cliente('gerente@robo-a.local')
  ok('gerente A lê as conversas da A', ((await cGer.from('whatsapp_conversas').select('id')).data ?? []).length > 0)
  const cGar = await cliente('garcom@robo-a.local')
  ok('garçom não lê conversas', ((await cGar.from('whatsapp_conversas').select('id')).data ?? []).length === 0)
  const cDonoB = await cliente('dono@robo-b.local')
  const vB = await cDonoB.from('whatsapp_mensagens').select('restaurante_id')
  ok('dono B não vê mensagens da A', (vB.data ?? []).every((x) => x.restaurante_id === B))
  const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  ok('anônimo não lê nada', ((await anon.from('whatsapp_mensagens').select('id')).data ?? []).length === 0)
  const rpc = await cDonoA.rpc('whatsapp_registrar_entrada', { p_restaurante: B, p_telefone: CLI, p_wa_id: 'X', p_de_mim: false, p_tipo: 'texto', p_texto: 'x', p_instante: null, p_intencao: 'outro' })
  ok('usuário logado não chama as funções do robô', !!rpc.error)

  secao('11. Retenção de 90 dias')
  const cvA = await conversa(A)
  await db.query(`insert into whatsapp_mensagens (restaurante_id, conversa_id, wa_id, direcao, tipo, texto, criado_em) values ($1,$2,'VELHA','entrada','texto','antiga', now() - interval '91 days')`, [A, cvA.id])
  const { data: limp } = await admin.rpc('whatsapp_limpar_antigos')
  ok('mensagem com mais de 90 dias é apagada; as recentes ficam', limp.mensagens >= 1 && !(await um(`select 1 from whatsapp_mensagens where wa_id='VELHA'`)) && (await q(`select 1 from whatsapp_mensagens where restaurante_id=$1`, [A])).length > 0)

  secao('12. Tela em Integrações nas larguras pedidas')
  for (const [w, h] of [[360, 780], [390, 844], [412, 915], [768, 1024], [1366, 768], [1920, 1080]]) {
    await dono.p.setViewportSize({ width: w, height: h })
    await dono.p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'networkidle' })
    await dispensar(dono.p)
    const card = dono.p.getByTestId('robo-whatsapp')
    await card.getByTestId('robo-alternar').waitFor({ timeout: 10000 })
    await card.scrollIntoViewIfNeeded()
    const sem = await dono.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('[data-testid=robo-whatsapp] *')].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || r.right <= window.innerWidth + 1 }))
    ok(`${w}px: cartão do robô sem rolagem horizontal`, sem)
    await card.screenshot({ path: join(SHOTS, `integracoes-robo-${w}.png`) })
  }
  await dono.p.setViewportSize({ width: 1366, height: 768 })
  await dono.p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'networkidle' })
  await dispensar(dono.p)
  await dono.p.getByTestId('robo-boas-vindas').fill('Bem-vindo à Lanchonete Robô A!')
  await dono.p.getByRole('button', { name: 'Salvar boas-vindas' }).click()
  await espera(800)
  ok('dono salva boas-vindas próprias', (await um(`select boas_vindas from whatsapp_robo_config where restaurante_id=$1`, [A])).boas_vindas === 'Bem-vindo à Lanchonete Robô A!')
  await webhook(SEG_A, evento('robo-sim-a', { de: '5511912340020', texto: 'oi' }))
  const bv = await ultimo(A)
  ok('boas-vindas próprias usadas, com link e menu', bv.texto.startsWith('Bem-vindo à Lanchonete Robô A!') && bv.texto.includes(`/loja/${LOJA}`) && bv.texto.includes('*1*'))
  const aud = await q(`select acao from eventos_auditoria where restaurante_id=$1 and acao like 'whatsapp.%'`, [A])
  ok('auditoria: robô configurado e conversa reativada', aud.some((a) => a.acao === 'whatsapp.robo_configurado') && aud.some((a) => a.acao === 'whatsapp.conversa_reativada'))
  await dono.ctx.close()

  secao('13. Nada saiu para fora e ninguém fora da lista recebeu')
  const todos = enviados()
  const permitidos = new Set(['551112340001', CLI, CLI_B, NOVO, TR, DF, IN, '5511912340020'])
  ok('todo envio foi para o provedor simulado e para números de teste', todos.length > 0 && todos.every((s) => permitidos.has(s.numero) && s.instancia.startsWith('robo-sim-')), `${todos.length} envios simulados`)
} finally {
  await browser.close()
  await db.end()
}
const f = res.filter((r) => !r.c)
console.log(`\n${res.length - f.length}/${res.length} verificações passaram · capturas em ${SHOTS}`)
if (f.length) { console.log('Falharam:\n' + f.map((x) => ` - ${x.n}`).join('\n')); process.exit(1) }
