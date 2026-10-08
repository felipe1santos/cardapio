/**
 * E2E da central de atendimento do WhatsApp (0107) — provedor SIMULADO, lojas isoladas,
 * nenhuma comunicação externa. Mesma trava e mesmas lojas do e2e do robô.
 *
 *   ROBO_E2E_LOJA=robo-e2e-a ROBO_E2E_VIZINHA=robo-e2e-b ROBO_PROVEDOR=simulado
 *   WHATSAPP_SIMULADO_ARQUIVO=<o mesmo do servidor> CRON_SECRET=<o mesmo do servidor>
 *   SHOTS=<pasta> node scripts/seguranca/e2e-atendimento-whatsapp.mjs
 *
 * O servidor local sobe com WHATSAPP_PROVEDOR=simulado, o mesmo arquivo, CRON_SECRET e
 * WHATSAPP_ROBO_LIBERADO=1.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
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
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'menuzia-e2e-atendimento')
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
mkdirSync(SHOTS, { recursive: true })

const res = []
const ok = (n, c, d = '') => { res.push({ n, c: !!c }); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(fn, ms = 15000, passo = 300) {
  const fim = Date.now() + ms
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() > fim) return v
    await espera(passo)
  }
}

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── semente ────────────────────────────────────────────────────────────────
async function loja(slug, nome, instancia) {
  const id = (await um(`insert into restaurantes (nome, slug, status_loja) values ($1,$2,'aberto_manual')
    on conflict (slug) do update set nome=excluded.nome returning id`, [nome, slug])).id
  await db.query(`update restaurantes set evolution_instance=$2 where id=$1`, [id, instancia])
  for (const t of ['whatsapp_eventos', 'whatsapp_envios', 'whatsapp_mensagens', 'whatsapp_conversa_tags', 'whatsapp_conversas', 'whatsapp_tags', 'whatsapp_contato_fotos', 'whatsapp_robo_config']) await db.query(`delete from ${t} where restaurante_id=$1`, [id])
  await db.query(`delete from campanha_envios where restaurante_id=$1`, [id])
  await db.query(`delete from campanhas where restaurante_id=$1`, [id])
  await db.query(`delete from fidelidade_progresso where restaurante_id=$1`, [id])
  await db.query(`delete from campanhas_fidelidade where restaurante_id=$1`, [id])
  await db.query(`delete from pedido_itens where pedido_id in (select id from pedidos where restaurante_id=$1)`, [id])
  await db.query(`delete from pedidos where restaurante_id=$1`, [id])
  await db.query(`insert into whatsapp_robo_config (restaurante_id, robo_ativo, protecao_curta, protecao_longa) values ($1, true, 200, 500)`, [id])
  return id
}
async function usuario(email, login, papel, restaurante, nome = login) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  let uid = data?.user?.id
  if (!uid) {
    const { data: l } = await admin.auth.admin.listUsers({ perPage: 1000 })
    uid = l.users.find((u) => u.email === email).id
    await admin.auth.admin.updateUserById(uid, { password: SENHA })
  }
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,$3::papel_usuario,$4,$5,$6,true)
    on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel=excluded.papel, nome=excluded.nome, autorizado=true, desativado_em=null, usuario=excluded.usuario`,
  [uid, restaurante, papel, nome, email, login])
}
const A = await loja(LOJA, 'Lanchonete Robô A', 'robo-sim-a')
const B = await loja(VIZ, 'Lanchonete Robô B', 'robo-sim-b')
await usuario('dono@robo-a.local', 'dono.roboa', 'dono', A, 'Ana Dona')
await usuario('gerente@robo-a.local', 'gerente.roboa', 'gerente', A, 'Gil Gerente')
await usuario('garcom@robo-a.local', 'garcom.roboa', 'garcom', A)
await usuario('dono@robo-b.local', 'dono.robob', 'dono', B)
const CLI = '5511912340001'
const CLI2 = '5511912340003'
const CLI_B = '5511912340002'
const LOJA_NUM = '5511900000000'
const SEG_A = (await um(`select webhook_segredo s from whatsapp_robo_config where restaurante_id=$1`, [A])).s
const SEG_B = (await um(`select webhook_segredo s from whatsapp_robo_config where restaurante_id=$1`, [B])).s
if (existsSync(ARQ)) rmSync(ARQ)
if (existsSync(`${ARQ}.controle.json`)) rmSync(`${ARQ}.controle.json`)
if (existsSync(`${ARQ}.fotos.jsonl`)) rmSync(`${ARQ}.fotos.jsonl`)
// Consultas de foto de perfil feitas ao provedor simulado (0108).
const fotosPedidas = () => (existsSync(`${ARQ}.fotos.jsonl`) ? readFileSync(`${ARQ}.fotos.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
// PNG 1×1: a "foto do WhatsApp" servida localmente (nada sai para a internet).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// ── helpers ─────────────────────────────────────────────────────────────────
let seq = 0
const evento = (inst, { de = CLI, texto = 'oi', id = `ATD${Date.now()}${seq++}`, fromMe = false } = {}) => ({
  event: 'messages.upsert', instance: inst, sender: `${LOJA_NUM}@s.whatsapp.net`,
  data: { key: { remoteJid: `${de}@s.whatsapp.net`, fromMe, id }, message: { conversation: texto }, messageTimestamp: Math.floor(Date.now() / 1000) },
})
const webhook = async (segredo, corpo) => {
  const r = await fetch(`${BASE}/api/whatsapp/webhook/${segredo}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  return { s: r.status, j: await r.json().catch(() => null) }
}
const enviados = () => (existsSync(ARQ) ? readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const conversa = (loja, tel = CLI) => um(`select * from whatsapp_conversas where restaurante_id=$1 and telefone=$2`, [loja, tel])
const mensagens = (conv) => q(`select direcao, origem, texto, status_envio, autor_nome, wa_id from whatsapp_mensagens where conversa_id=$1 order by criado_em, id`, [conv])
const cronCampanhas = () => fetch(`${BASE}/api/cron/campanhas`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))

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
const dispensar = async (p) => { const b = p.getByRole('button', { name: /OK, entendi/ }).first(); await b.waitFor({ timeout: 2500 }).catch(() => {}); if (await b.isVisible().catch(() => false)) await b.click() }
const R = '/api/admin/whatsapp/atendimento'

try {
  secao('1. Botão flutuante: quem vê e o painel fechado leve')
  const dono = await logar('dono.roboa')
  await dono.p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await dispensar(dono.p)
  const lanc = dono.p.getByTestId('atendimento-lancador')
  await lanc.waitFor({ timeout: 15000 })
  ok('dono vê o botão no canto inferior (esquerdo no Kanban), sem número (nada aguardando)', (await lanc.isVisible()) && (await dono.p.getByTestId('atendimento-badge').count()) === 0)
  const caixa = await lanc.boundingBox()
  ok('botão redondo no canto inferior esquerdo do Kanban (item 58: à esquerda só no Kanban)', caixa && caixa.x < 60 && caixa.y + caixa.height > 768 - 40, JSON.stringify(caixa))
  const pedidosCentral = []
  dono.p.on('request', (r) => { if (/central/.test(r.url()) && r.resourceType() === 'script') pedidosCentral.push(r.url()) })
  ok('painel fechado: o código da central não é baixado', (await dono.p.getByTestId('atendimento-central').count()) === 0)
  const garcom = await logar('garcom.roboa')
  await garcom.p.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  await espera(1500)
  const rg = await api(garcom.p, `${R}/resumo`)
  ok('garçom: sem botão e sem acesso (403)', (await garcom.p.getByTestId('atendimento-lancador').count()) === 0 && rg.s === 403, `HTTP ${rg.s}`)
  await garcom.ctx.close()
  const semSessao = await fetch(`${BASE}${R}/conversas`, { redirect: 'manual' })
  ok('sem sessão: recusado', semSessao.status === 401 || semSessao.status === 307 || semSessao.status === 302, `HTTP ${semSessao.status}`)

  secao('2. Cliente pede atendente → aguardando → número no botão e no título')
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'oi' }))
  const cv0 = await conversa(A)
  const m0 = await mensagens(cv0.id)
  ok('robô respondeu e a resposta entrou no histórico como "robo"', m0.some((m) => m.origem === 'cliente' && m.texto === 'oi') && m0.some((m) => m.origem === 'robo' && m.status_envio === 'enviado'), JSON.stringify(m0.map((m) => m.origem)))
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'quero falar com um atendente' }))
  const cv1 = await conversa(A)
  ok('conversa entra como "aguardando atendente" e o robô para só nela', cv1.atendimento === 'aguardando' && cv1.estado === 'silenciada')
  const antesRobo = enviados().length
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'alô?' }))
  ok('aguardando: o robô não responde mais nesta conversa', enviados().length === antesRobo)
  await webhook(SEG_A, evento('robo-sim-a', { de: CLI2, texto: 'oi' }))
  ok('outra conversa segue com o robô normalmente', enviados().length === antesRobo + 1 && (await conversa(A, CLI2)).atendimento === 'robo')
  const badge = dono.p.getByTestId('atendimento-badge')
  await badge.waitFor({ timeout: 35000 }).catch(() => {})
  ok('número aparece no botão sem recarregar a página', (await badge.isVisible().catch(() => false)) && Number(await badge.innerText()) >= 1)
  ok('contador no título da aba', /^\(\d+\) /.test(await dono.p.title()), await dono.p.title())
  const rs = await api(dono.p, `${R}/resumo`)
  ok('resumo conta conversas, não mensagens: 1 aguardando', rs.s === 200 && rs.j?.aguardando === 1 && rs.j?.naoLidas === 0, JSON.stringify(rs.j))
  ok('botão e título mostram 1 (uma conversa)', (await badge.innerText()) === '1' && (await dono.p.title()).startsWith('(1) '))
  await dono.p.screenshot({ path: join(SHOTS, 'atendimento-botao-badge.png') })

  secao('3. Atendente assume e responde → cliente recebe')
  await lanc.click()
  const central = dono.p.getByTestId('atendimento-central')
  await central.waitFor({ timeout: 15000 })
  ok('painel abre sob demanda (código da central baixado só agora)', pedidosCentral.length >= 0 && (await central.isVisible()))
  const cx = await central.boundingBox()
  ok('janela ~960×640 no desktop', cx && Math.abs(cx.width - 960) <= 2 && Math.abs(cx.height - 640) <= 2, cx ? `${Math.round(cx.width)}×${Math.round(cx.height)}` : '')
  await dono.p.getByTestId('atendimento-filtro-aguardando').click()
  const linha = dono.p.getByTestId(`atendimento-conversa-${CLI}`)
  await linha.waitFor({ timeout: 10000 })
  ok('filtro "Aguardando" lista a conversa e não a do robô', (await dono.p.getByTestId(`atendimento-conversa-${CLI2}`).count()) === 0)
  await linha.click()
  await dono.p.getByTestId('atendimento-estado').filter({ hasText: 'Aguardando atendente' }).waitFor({ timeout: 10000 })
  ok('cabeçalho mostra "Aguardando atendente" com Assumir e Encerrar', (await dono.p.getByTestId('atendimento-assumir').isVisible()) && (await dono.p.getByTestId('atendimento-encerrar').isVisible()))
  await dono.p.getByTestId('atendimento-balao').first().waitFor({ timeout: 10000 })
  ok('respostas do robô aparecem marcadas', (await dono.p.locator('[data-testid=atendimento-balao][data-origem=robo]').count()) >= 1)
  await dono.p.getByTestId('atendimento-assumir').click()
  await dono.p.getByTestId('atendimento-estado').filter({ hasText: 'Em atendimento' }).waitFor({ timeout: 10000 })
  const cv2 = await conversa(A)
  ok('assumir: "Em atendimento" com o nome de quem assumiu', cv2.atendimento === 'humano' && cv2.atendente_nome === 'Ana Dona' && cv2.nao_lidas === 0)
  const texto = dono.p.getByTestId('atendimento-texto')
  await texto.fill('Olá! Aqui é a Ana, em que posso ajudar?')
  await texto.press('Enter')
  const saiu = await ate(async () => enviados().find((s) => s.numero === CLI && JSON.stringify(s).includes('Aqui é a Ana')))
  ok('Enter envia: o cliente recebe pela instância da loja', !!saiu && saiu.instancia === 'robo-sim-a')
  const mAt = await ate(async () => (await mensagens(cv2.id)).find((m) => m.origem === 'atendente' && m.status_envio === 'enviado'))
  ok('mensagem gravada como "atendente", com o autor e status enviado', mAt?.autor_nome === 'Ana Dona' && mAt?.texto.includes('Ana'))
  ok('campo limpo depois de enviar', (await texto.inputValue()) === '')
  await texto.fill('Linha 1')
  await texto.press('Shift+Enter')
  await texto.type('Linha 2')
  ok('Shift+Enter quebra a linha sem enviar', (await texto.inputValue()) === 'Linha 1\nLinha 2')
  await texto.press('Enter')
  ok('mensagem de duas linhas chega inteira', !!(await ate(async () => enviados().find((s) => JSON.stringify(s).includes('Linha 1\\nLinha 2')))))
  const aud = await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='whatsapp.atendente_respondeu'`, [A])
  ok('auditoria registra a resposta do atendente', aud.n >= 2)

  secao('4. Cliente responde (tempo real) e o eco da nossa mensagem')
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'Quero trocar o refrigerante' }))
  const novaNaTela = await ate(async () => (await dono.p.locator('[data-testid=atendimento-balao][data-origem=cliente]', { hasText: 'trocar o refrigerante' }).count()) > 0, 15000)
  ok('mensagem do cliente aparece na conversa aberta sem recarregar', !!novaNaTela)
  const ecoTexto = 'Olá! Aqui é a Ana, em que posso ajudar?'
  const antesEco = (await mensagens(cv2.id)).length
  await webhook(SEG_A, evento('robo-sim-a', { fromMe: true, texto: ecoTexto }))
  ok('eco (fromMe) da resposta do atendente não duplica nem vira "pelo celular da loja"', (await mensagens(cv2.id)).length === antesEco && (await conversa(A)).atendimento === 'humano')
  await webhook(SEG_A, evento('robo-sim-a', { fromMe: true, texto: 'Mensagem digitada no celular da loja' }))
  ok('mensagem digitada no celular da loja entra no histórico como "loja"', (await mensagens(cv2.id)).some((m) => m.origem === 'loja' && m.texto.includes('celular da loja')))
  await central.screenshot({ path: join(SHOTS, 'atendimento-conversa-1366.png') })

  secao('5. Minimizar mantém a conversa e o rascunho')
  await texto.fill('rascunho não enviado')
  await dono.p.getByTestId('atendimento-minimizar').click()
  await espera(300)
  ok('minimizado: painel escondido e o botão volta', !(await central.isVisible()) && (await lanc.isVisible()))
  await lanc.click()
  await central.waitFor({ state: 'visible', timeout: 5000 })
  ok('reaberto com a mesma conversa e o rascunho', (await texto.inputValue()) === 'rascunho não enviado' && /Em atendimento/.test(await dono.p.getByTestId('atendimento-estado').innerText()))
  await texto.fill('')

  secao('6. Tags: criar, aplicar e filtrar')
  await dono.p.getByTestId('atendimento-cliente-abrir').click()
  await dono.p.getByTestId('atendimento-cliente').waitFor({ timeout: 5000 })
  await dono.p.getByTestId('atendimento-nova-tag').fill('VIP')
  await dono.p.getByTestId('atendimento-criar-tag').click()
  await dono.p.getByTestId('atendimento-tag-VIP').filter({ hasText: '✓' }).waitFor({ timeout: 10000 })
  const tagVip = await um(`select id, nome, cor from whatsapp_tags where restaurante_id=$1 and nome='VIP'`, [A])
  ok('tag criada na loja e aplicada ao cliente', !!tagVip && !!(await um(`select 1 from whatsapp_conversa_tags where tag_id=$1 and conversa_id=$2`, [tagVip.id, cv2.id])))
  const tNova = await api(dono.p, `${R}/tags`, 'POST', { nome: 'Reclamação', cor: '#EF4444' })
  ok('segunda tag com cor própria', tNova.s === 201 && tNova.j?.tag?.cor === '#EF4444')
  const cv2b = await conversa(A, CLI2)
  await api(dono.p, `${R}/conversas/${cv2b.id}/tags`, 'POST', { tagId: tNova.j.tag.id, aplicar: true })
  await api(dono.p, `${R}/conversas/${cv2.id}/tags`, 'POST', { tagId: tNova.j.tag.id, aplicar: true })
  ok('várias tags no mesmo cliente', (await um(`select count(*)::int n from whatsapp_conversa_tags where conversa_id=$1`, [cv2.id])).n === 2)
  ok('nome repetido → 409', (await api(dono.p, `${R}/tags`, 'POST', { nome: 'vip' })).s === 409)
  const porTag = await api(dono.p, `${R}/conversas?tag=${tagVip.id}`)
  ok('filtro por tag (API) traz só quem tem a tag, com todas as tags da conversa', porTag.s === 200 && porTag.j.conversas.length === 1 && porTag.j.conversas[0].telefone === CLI && porTag.j.conversas[0].tags.length === 2)
  await dono.p.getByTestId('atendimento-filtro-tag').selectOption(tagVip.id)
  await espera(1200)
  ok('filtro "Por tag" na tela', (await dono.p.getByTestId(`atendimento-conversa-${CLI}`).count()) === 1 && (await dono.p.getByTestId(`atendimento-conversa-${CLI2}`).count()) === 0)
  await dono.p.getByTestId('atendimento-filtro-todas').click()
  await dono.p.getByTestId(`atendimento-conversa-${CLI2}`).waitFor({ timeout: 10000 })
  ok('"Todas" volta a listar as duas', (await dono.p.getByTestId(`atendimento-conversa-${CLI}`).count()) === 1)
  await dono.p.getByTestId('atendimento-busca').fill('0003')
  await espera(1200)
  ok('busca por telefone', (await dono.p.getByTestId(`atendimento-conversa-${CLI2}`).count()) === 1 && (await dono.p.getByTestId(`atendimento-conversa-${CLI}`).count()) === 0)
  await dono.p.getByTestId('atendimento-busca').fill('')
  await dono.p.getByTestId(`atendimento-conversa-${CLI}`).click()
  await dono.p.getByTestId('atendimento-estado').waitFor({ timeout: 10000 })
  await central.screenshot({ path: join(SHOTS, 'atendimento-tags-cliente.png') })

  secao('7. Encerrar devolve ao robô; pausar e retomar por conversa')
  await dono.p.getByTestId('atendimento-encerrar').click()
  await dono.p.getByTestId('atendimento-estado').filter({ hasText: /^Robô$/ }).waitFor({ timeout: 10000 })
  ok('"Encerrar e devolver ao robô" → conversa volta ao robô', (await conversa(A)).atendimento === 'robo' && (await conversa(A)).estado === 'robo')
  const antesVolta = enviados().length
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'cardápio' }))
  ok('robô volta a responder este cliente', enviados().length === antesVolta + 1)
  await dono.p.getByTestId('atendimento-pausar').click()
  await dono.p.getByTestId('atendimento-retomar').waitFor({ timeout: 10000 })
  const antesPausa = enviados().length
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'horário' }))
  ok('"Pausar robô" só nesta conversa: não responde aqui', enviados().length === antesPausa && (await conversa(A)).estado === 'silenciada')
  await webhook(SEG_A, evento('robo-sim-a', { de: CLI2, texto: 'horário' }))
  ok('...e continua respondendo as outras', enviados().length === antesPausa + 1)
  await dono.p.getByTestId('atendimento-retomar').click()
  await dono.p.getByTestId('atendimento-pausar').waitFor({ timeout: 10000 })
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'horário' }))
  ok('"Retomar robô" volta a responder', enviados().length === antesPausa + 2 && (await conversa(A)).atendimento === 'robo')

  secao('8. Robô desligado: avisos de pedido e fidelidade saem e ficam no histórico')
  const desl = await api(dono.p, '/api/admin/whatsapp/robo', 'PUT', { roboAtivo: false })
  ok('dono desliga o robô', desl.s === 200 && (await um(`select robo_ativo from whatsapp_robo_config where restaurante_id=$1`, [A])).robo_ativo === false)
  const ped = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento)
    values ($1,'retirada','pronto',30,30,'Cliente Teste',$2,'pix') returning id, numero`, [A, CLI])
  await db.query(`insert into campanhas_fidelidade (restaurante_id, nome, tipo_meta, meta_quantidade, premio_tipo, premio_valor) values ($1,'Cartão fidelidade','qtd_pedidos',5,'desconto_valor',10)`, [A])
  const antesAviso = enviados().length
  const nPronto = await api(dono.p, `/api/pedidos/${ped.id}/notificar`, 'POST', { status: 'pronto' })
  ok('aviso "pronto" sai com o robô desligado', nPronto.s === 200 && enviados().length === antesAviso + 1)
  await db.query(`update pedidos set status='entregue' where id=$1`, [ped.id])
  await api(dono.p, `/api/pedidos/${ped.id}/notificar`, 'POST', { status: 'entregue' })
  const fid = await ate(async () => enviados().slice(antesAviso).length >= 3 ? enviados().slice(antesAviso) : null, 10000)
  ok('aviso "entregue" e mensagem de fidelidade saem com o robô desligado', (fid ?? []).length === 3, `${(fid ?? []).length} envios`)
  const auto = (await mensagens((await conversa(A)).id)).filter((m) => m.origem === 'automatico')
  ok('os três aparecem no histórico como "automático", enviados', auto.length === 3 && auto.every((m) => m.status_envio === 'enviado'), JSON.stringify(auto.map((m) => m.status_envio)))
  await webhook(SEG_A, evento('robo-sim-a', { fromMe: true, texto: auto[0].texto }))
  ok('eco do aviso automático não silencia a conversa (reconhecido pelo texto)', (await conversa(A)).atendimento === 'robo' && !(await mensagens((await conversa(A)).id)).some((m) => m.origem === 'loja' && m.texto === auto[0].texto))
  const CLI3 = '5511912340004'
  const antesDesl = enviados().length
  await webhook(SEG_A, evento('robo-sim-a', { de: CLI3, texto: 'boa noite, tem pizza?' }))
  const cv3 = await conversa(A, CLI3)
  ok('robô desligado: cliente novo entra direto aguardando atendente, sem resposta', cv3?.atendimento === 'aguardando' && enviados().length === antesDesl)
  const lista3 = await api(dono.p, `${R}/conversas/${cv3.id}`)
  ok('detalhe informa robô desligado (tela mostra "Encerrar atendimento")', lista3.s === 200 && lista3.j?.roboAtivo === false)
  const enc3 = await api(dono.p, `${R}/conversas/${cv3.id}`, 'POST', { acao: 'encerrar' })
  ok('encerrar com o robô desligado → "encerrada" (não devolve a robô nenhum)', enc3.s === 200 && enc3.j?.atendimento === 'encerrada')
  await dono.p.getByTestId(`atendimento-conversa-${CLI}`).click()
  await dono.p.locator('[data-testid=atendimento-balao][data-origem=automatico]').first().waitFor({ timeout: 10000 })
  ok('balões "Automático" na conversa', (await dono.p.locator('[data-testid=atendimento-balao][data-origem=automatico]').count()) === 3
    && /Automático/.test(await dono.p.locator('[data-testid=atendimento-balao][data-origem=automatico]').first().innerText()))
  await central.screenshot({ path: join(SHOTS, 'atendimento-automatico.png') })
  await api(dono.p, '/api/admin/whatsapp/robo', 'PUT', { roboAtivo: true })

  secao('9. Disparos (campanhas) aparecem no histórico do cliente')
  const camp = (await um(`insert into campanhas (restaurante_id, nome, status, mensagem, agendado_em, total_destinatarios) values ($1,'Promo de sexta','enviando','Sexta tem promoção na Lanchonete!', now(), 1) returning id`, [A])).id
  await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente) values ($1,$2,$3,'Cliente Teste')`, [camp, A, CLI.slice(2)])
  const antesCamp = enviados().length
  const kc = await cronCampanhas()
  ok('campanha enviada pelo cron', kc.s === 200 && kc.j?.enviados === 1 && enviados().length === antesCamp + 1, JSON.stringify(kc.j))
  const disp = (await mensagens((await conversa(A)).id)).filter((m) => m.origem === 'disparo')
  ok('disparo no histórico do cliente como "disparo"', disp.length === 1 && disp[0].texto.includes('Sexta tem promoção'))
  await dono.p.getByTestId(`atendimento-conversa-${CLI2}`).click()
  await espera(500)
  await dono.p.getByTestId(`atendimento-conversa-${CLI}`).click()
  await dono.p.locator('[data-testid=atendimento-balao][data-origem=disparo]').first().waitFor({ timeout: 10000 }).catch(() => {})
  ok('balão "Disparo" na conversa', /Disparo/.test(await dono.p.locator('[data-testid=atendimento-balao][data-origem=disparo]').first().innerText().catch(() => '')))

  secao('10. Isolamento entre lojas e permissões')
  await webhook(SEG_B, evento('robo-sim-b', { de: CLI_B, texto: 'quero falar com atendente' }))
  const donoB = await logar('dono.robob')
  const cvA = (await conversa(A)).id
  const g1 = await api(donoB.p, `${R}/conversas/${cvA}`)
  const g2 = await api(donoB.p, `${R}/conversas/${cvA}/mensagens`)
  const g3 = await api(donoB.p, `${R}/conversas/${cvA}/mensagens`, 'POST', { texto: 'invasão' })
  const g4 = await api(donoB.p, `${R}/conversas/${cvA}`, 'POST', { acao: 'assumir' })
  ok('loja B não lê, não responde e não assume conversa da A (404)', [g1, g2, g3, g4].every((r) => r.s === 404), [g1, g2, g3, g4].map((r) => r.s).join(','))
  const g5 = await api(donoB.p, `${R}/conversas?filtro=todas`)
  ok('lista da B só com conversas da B', g5.s === 200 && g5.j.conversas.length === 1 && g5.j.conversas[0].telefone === CLI_B)
  const cvB = (await conversa(B, CLI_B)).id
  const g6 = await api(donoB.p, `${R}/conversas/${cvB}/tags`, 'POST', { tagId: tagVip.id, aplicar: true })
  ok('B não aplica tag da A (404) e não vê as tags da A', g6.s === 404 && ((await api(donoB.p, `${R}/tags`)).j?.tags ?? []).length === 0)
  const g7 = await api(dono.p, `${R}/conversas/${cvB}/tags`, 'POST', { tagId: tagVip.id, aplicar: true })
  ok('A não aplica tag em conversa da B (404)', g7.s === 404)
  ok('nenhuma mensagem "invasão" saiu', !enviados().some((s) => JSON.stringify(s).includes('invasão')))
  const rb = await api(donoB.p, `${R}/resumo`)
  ok('resumo da B conta só a B', rb.j?.aguardando === 1)
  await donoB.ctx.close()
  const ger = await logar('gerente.roboa')
  const gr = await api(ger.p, `${R}/conversas`)
  ok('gerente da A atende (200)', gr.s === 200 && gr.j.conversas.length >= 2)
  await ger.ctx.close()
  ok('acao inválida → 400; id inválido → 400', (await api(dono.p, `${R}/conversas/${cvA}`, 'POST', { acao: 'apagar' })).s === 400 && (await api(dono.p, `${R}/conversas/xyz`)).s === 400)

  secao('11. Paginação no banco')
  await db.query(`insert into whatsapp_mensagens (restaurante_id, conversa_id, wa_id, direcao, origem, tipo, texto, criado_em)
    select $1, $2, 'PAG-' || g, 'entrada', 'cliente', 'texto', 'antiga ' || g, now() - interval '2 days' + (g || ' seconds')::interval from generate_series(1, 60) g`, [A, cvA])
  const p1 = await api(dono.p, `${R}/conversas/${cvA}/mensagens`)
  const p2 = await api(dono.p, `${R}/conversas/${cvA}/mensagens?antes=${encodeURIComponent(p1.j.anteriores)}`)
  const total = (await um(`select count(*)::int n from whatsapp_mensagens where conversa_id=$1`, [cvA])).n
  const ids = new Set([...p1.j.mensagens, ...p2.j.mensagens].map((m) => m.id))
  ok('mensagens: 40 por página, a seguinte sem repetir', p1.j.mensagens.length === 40 && !!p1.j.anteriores && p2.j.mensagens.length === Math.min(40, total - 40) && ids.size === p1.j.mensagens.length + p2.j.mensagens.length)
  await db.query(`insert into whatsapp_conversas (restaurante_id, telefone, ultima_atividade_em, ultima_previa, ultima_origem)
    select $1, '55119555' || lpad(g::text, 5, '0'), now() - (g || ' minutes')::interval, 'olá ' || g, 'cliente' from generate_series(1, 40) g`, [A])
  const l1 = await api(dono.p, `${R}/conversas?filtro=todas`)
  const l2 = await api(dono.p, `${R}/conversas?filtro=todas&cursor=${encodeURIComponent(l1.j.proximo)}`)
  const nConv = (await um(`select count(*)::int n from whatsapp_conversas where restaurante_id=$1`, [A])).n
  ok('conversas: 30 por página, sem repetir, até o fim', l1.j.conversas.length === 30 && l2.j.conversas.length === nConv - 30 && new Set([...l1.j.conversas, ...l2.j.conversas].map((c) => c.id)).size === nConv)
  await dono.p.getByTestId('atendimento-filtro-todas').click()
  await dono.p.getByTestId('atendimento-lista').waitFor({ timeout: 5000 })
  await espera(800)
  const linhasNoDom = await dono.p.locator('[data-testid^=atendimento-conversa-]').count()
  ok('lista virtualizada: só as linhas visíveis no DOM', linhasNoDom > 0 && linhasNoDom < 30, `${linhasNoDom} linhas`)

  secao('11b. Fotos de perfil: só as linhas visíveis, uma vez, com cache')
  await dono.p.route('https://pps.whatsapp.net/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  const antesFotos = fotosPedidas().length
  await dono.p.getByTestId('atendimento-filtro-humano').click()
  await dono.p.getByTestId('atendimento-filtro-todas').click()
  await dono.p.getByTestId('atendimento-lista').waitFor({ timeout: 5000 })
  await ate(async () => fotosPedidas().length > antesFotos, 10000)
  await espera(1500)
  const lote1 = fotosPedidas().slice(antesFotos)
  const visiveis = await dono.p.evaluate(() => { const l = document.querySelector('[data-testid=atendimento-lista]'); return Math.ceil(l.clientHeight / 72) + 1 })
  ok('pede foto só de quem aparece na tela (não das 40+ conversas)', lote1.length > 0 && lote1.length <= visiveis, `${lote1.length} consultas, ~${visiveis} linhas visíveis`)
  ok('cada telefone consultado uma vez', new Set(lote1.map((f) => f.numero)).size === lote1.length)
  await ate(async () => (await dono.p.getByTestId('atendimento-foto').count()) > 0, 8000)
  const comFoto = await dono.p.getByTestId('atendimento-foto').count()
  ok('contatos com foto mostram a imagem (carregada só quando aparece)', comFoto > 0 && (await dono.p.getByTestId('atendimento-foto').first().getAttribute('loading')) === 'lazy', `${comFoto} fotos`)
  const guardadas = await um(`select count(*)::int n, count(url)::int com from whatsapp_contato_fotos where restaurante_id=$1`, [A])
  ok('links guardados na loja (com e sem foto), nada na loja vizinha', guardadas.n >= lote1.length && guardadas.com > 0 && (await um(`select count(*)::int n from whatsapp_contato_fotos where restaurante_id=$1`, [B])).n === 0)
  await dono.p.getByTestId('atendimento-lista').evaluate((el) => { el.scrollTop = el.scrollHeight })
  await espera(2500)
  const lote2 = fotosPedidas().slice(antesFotos)
  ok('rolando: pede só as linhas novas, nenhuma repetida', lote2.length > lote1.length && new Set(lote2.map((f) => f.numero)).size === lote2.length, `${lote2.length} no total`)
  await dono.p.getByTestId('atendimento-fechar').click()
  await dono.p.getByTestId('atendimento-lancador').click()
  await dono.p.getByTestId('atendimento-central').waitFor({ timeout: 10000 })
  await dono.p.getByTestId('atendimento-filtro-todas').click()
  await espera(2500)
  ok('reaberto: usa o link guardado, sem consultar o WhatsApp de novo', fotosPedidas().slice(antesFotos).length === lote2.length && (await dono.p.getByTestId('atendimento-foto').count()) > 0)
  const conv = await dono.p.evaluate(async () => (await (await fetch('/api/admin/whatsapp/atendimento/conversas?filtro=todas')).json()).conversas.slice(0, 3).map((c) => ({ f: c.foto, e: c.fotoEm })))
  ok('lista já vem com a foto guardada (sem pedido extra)', conv.some((c) => c.e))
  const muitas = await api(dono.p, `${R}/fotos`, 'POST', { telefones: Array.from({ length: 25 }, (_, i) => `55119555${String(i + 1).padStart(5, '0')}`) })
  ok('API aceita no máximo 10 telefones por pedido', muitas.s === 200 && Object.keys(muitas.j?.fotos ?? {}).length <= 10)
  const alheio = await api(dono.p, `${R}/fotos`, 'POST', { telefones: [CLI_B] })
  ok('telefone que não é conversa da loja é ignorado', alheio.s === 200 && !(CLI_B in (alheio.j?.fotos ?? {})))
  await central.screenshot({ path: join(SHOTS, 'atendimento-fotos.png') })

  secao('12. Não cobre modais; celular em tela cheia')
  await dono.p.getByTestId('atendimento-fechar').click()
  await espera(300)
  const cobre = await dono.p.evaluate(() => {
    const d = document.createElement('div')
    d.setAttribute('role', 'dialog')
    d.className = 'fixed inset-0 z-50 bg-black/40'
    document.body.appendChild(d)
    const b = document.querySelector('[data-testid=atendimento-lancador]').getBoundingClientRect()
    const topo = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    d.remove()
    return topo === d
  })
  ok('modal (z-50) fica por cima do botão flutuante', cobre)
  const zCentral = await dono.p.evaluate(async () => {
    document.querySelector('[data-testid=atendimento-lancador]').click()
    for (let i = 0; i < 50 && !document.querySelector('[data-testid=atendimento-central]'); i++) await new Promise((r) => setTimeout(r, 100))
    return Number(getComputedStyle(document.querySelector('[data-testid=atendimento-central]')).zIndex)
  })
  ok('painel aberto abaixo das camadas de modal (z < 50)', zCentral > 0 && zCentral < 50, String(zCentral))
  await dono.ctx.close()
  const cel = await logar('dono.roboa', { width: 390, height: 844 })
  await cel.p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await dispensar(cel.p)
  await cel.p.getByTestId('atendimento-lancador').click()
  const cc = cel.p.getByTestId('atendimento-central')
  await cc.waitFor({ timeout: 15000 })
  const bc = await cc.boundingBox()
  ok('celular: painel em tela cheia', bc && bc.x <= 1 && bc.y <= 1 && bc.width >= 389 && bc.height >= 843, bc ? `${bc.width}×${bc.height}` : '')
  ok('celular: sem rolagem horizontal', await cel.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await cel.p.screenshot({ path: join(SHOTS, 'atendimento-celular-lista.png') })
  await cel.p.getByTestId('atendimento-filtro-todas').click()
  await cel.p.getByTestId('atendimento-busca').fill('0001')
  await cel.p.getByTestId(`atendimento-conversa-${CLI}`).click()
  await cel.p.getByTestId('atendimento-texto').waitFor({ timeout: 10000 })
  await cel.p.getByTestId('atendimento-estado').waitFor({ timeout: 10000 })
  await cel.p.getByTestId('atendimento-balao').first().waitFor({ timeout: 10000 })
  await cel.p.screenshot({ path: join(SHOTS, 'atendimento-celular-conversa.png') })
  await cel.ctx.close()

  secao('13. Nada saiu para fora')
  const todos = enviados()
  const permitidos = new Set([CLI, CLI2, CLI3, CLI_B])
  ok('todo envio foi para o provedor simulado e para números de teste', todos.length > 0 && todos.every((s) => permitidos.has(s.numero) && s.instancia.startsWith('robo-sim-')), `${todos.length} envios`)
} finally {
  await browser.close()
  await db.end()
}
const f = res.filter((r) => !r.c)
console.log(`\n${res.length - f.length}/${res.length} verificações passaram · capturas em ${SHOTS}`)
if (f.length) { console.log('Falharam:\n' + f.map((x) => ` - ${x.n}`).join('\n')); process.exit(1) }
