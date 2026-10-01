/**
 * E2E das campanhas e das métricas (0104) — provedor SIMULADO, lojas isoladas, nenhuma
 * comunicação externa.
 *
 * Trava obrigatória (aborta antes de QUALQUER escrita):
 *   CAMP_E2E_LOJA=camp-e2e-a  CAMP_E2E_VIZINHA=camp-e2e-b  (slugs começando com camp-e2e)
 *   CAMP_PROVEDOR=simulado    WHATSAPP_SIMULADO_ARQUIVO=<arquivo>  (o MESMO do servidor)
 * O servidor local sobe com WHATSAPP_PROVEDOR=simulado, o mesmo arquivo, CRON_SECRET,
 * WHATSAPP_ROBO_LIBERADO=1 e CAMPANHA_INTERVALO_MS=20 (servidor-local.mjs já apaga as
 * variáveis da Evolution: nada sairia para fora de qualquer jeito).
 *
 *   SHOTS=<pasta> node scripts/seguranca/e2e-campanhas-metricas.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

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
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'menuzia-e2e-campanhas')
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, ANON_KEY, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
mkdirSync(SHOTS, { recursive: true })

const res = []
const ok = (n, c, d = '') => { res.push({ n, c: !!c }); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── semente ──────────────────────────────────────────────────────────────────
async function loja(slug, nome, instancia) {
  const id = (await um(`insert into restaurantes (nome, slug, status_loja) values ($1,$2,'aberto_manual')
    on conflict (slug) do update set nome=excluded.nome returning id`, [nome, slug])).id
  await db.query(`update restaurantes set evolution_instance=$2 where id=$1`, [id, instancia])
  await db.query(`delete from campanhas where restaurante_id=$1`, [id])
  for (const t of ['whatsapp_eventos', 'whatsapp_envios', 'whatsapp_mensagens', 'whatsapp_conversas', 'whatsapp_robo_config', 'clientes']) await db.query(`delete from ${t} where restaurante_id=$1`, [id])
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
const A = await loja(LOJA, 'Lanchonete Campanha A', 'camp-sim-a')
const B = await loja(VIZ, 'Lanchonete Campanha B', 'camp-sim-b')
await usuario('dono@camp-a.local', 'dono.campa', 'dono', A)
await usuario('gerente@camp-a.local', 'gerente.campa', 'gerente', A)
await usuario('garcom@camp-a.local', 'garcom.campa', 'garcom', A)
await usuario('dono@camp-b.local', 'dono.campb', 'dono', B)
// Telefones fictícios (DDD 11, prefixo 91234 reservado para teste).
const C = { c1: '5511912340101', c2: '5511912340102', c3: '5511912340103', c4: '5511912340104' }
const C1_SEM_9 = '551112340101' // o mesmo C1 em formato antigo: tem que ser deduplicado
const OUTRO = '5511912340199' // nunca recebeu campanha
for (const [n, t] of Object.entries(C)) await db.query(`insert into clientes (restaurante_id, telefone, nome) values ($1,$2,$3)`, [A, t, `Cliente ${n.toUpperCase()}`])
await db.query(`insert into clientes (restaurante_id, telefone, nome) values ($1,$2,'C1 duplicado')`, [A, C1_SEM_9])
await db.query(`insert into clientes (restaurante_id, telefone, nome) values ($1,$2,'Cliente da B')`, [B, C.c1])
const SEG_A = (await um(`select webhook_segredo s from whatsapp_robo_config where restaurante_id=$1`, [A])).s
if (existsSync(ARQ)) rmSync(ARQ)
if (existsSync(`${ARQ}.controle.json`)) rmSync(`${ARQ}.controle.json`)

// ── helpers ──────────────────────────────────────────────────────────────────
const enviados = () => (existsSync(ARQ) ? readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const controle = (c) => writeFileSync(`${ARQ}.controle.json`, JSON.stringify(c))
const cron = () => fetch(`${BASE}/api/cron/campanhas`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const webhook = async (corpo) => {
  const r = await fetch(`${BASE}/api/whatsapp/webhook/${SEG_A}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  return { s: r.status, j: await r.json().catch(() => null) }
}
const statusEvt = (waId, status) => ({ event: 'messages.update', instance: 'camp-sim-a', data: { keyId: waId, remoteJid: 'x@s.whatsapp.net', fromMe: true, status } })
let seq = 0
const msgEvt = (de, { texto = 'oi', id = `CWA${Date.now()}${seq++}`, fromMe = false } = {}) => ({
  event: 'messages.upsert', instance: 'camp-sim-a', sender: '5511900000000@s.whatsapp.net',
  data: { key: { remoteJid: `${de}@s.whatsapp.net`, fromMe, id }, message: { conversation: texto }, messageTimestamp: Math.floor(Date.now() / 1000) },
})
const envios = (camp) => q(`select * from campanha_envios where campanha_id=$1 order by telefone`, [camp])
const clique = (token, ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36', metodo = 'GET') =>
  fetch(`${BASE}/c/${token}`, { method: metodo, redirect: 'manual', headers: { 'user-agent': ua } }).then((r) => ({ s: r.status, loc: r.headers.get('location') }))
async function pedido(restaurante, telefone, status = 'entregue', total = 50) {
  return um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento)
    values ($1,'retirada',$2,$3,$3,'Cliente Teste',$4,'pix') returning id, numero, criado_em`, [restaurante, status, total, telefone])
}

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
const metricas = (p, extra = '') => api(p, `/api/admin/campanhas/metricas?de=${encodeURIComponent(new Date(Date.now() - 3 * 86400e3).toISOString())}&ate=${encodeURIComponent(new Date(Date.now() + 60e3).toISOString())}${extra}`)

try {
  secao('1. Banco: função de telefone, status e permissões')
  const chaves = await um(`select telefone_chave('5527999887766') a, telefone_chave('27999887766') b, telefone_chave('552799887766') c, telefone_chave('55999887766') d, telefone_chave('123') e`)
  ok('telefone_chave igual ao TS (com/sem 55, com/sem 9, DDD 55)', chaves.a === '2799887766' && chaves.b === chaves.a && chaves.c === chaves.a && chaves.d === '5599887766' && chaves.e === null)
  const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const r1 = await anon.rpc('campanha_reservar_envios', { p_limite: 5 })
  const r2 = await anon.rpc('campanha_registrar_clique', { p_token: 'a'.repeat(24) })
  const r3 = await anon.rpc('campanhas_metricas', { p_de: new Date(0).toISOString(), p_ate: new Date().toISOString() })
  ok('visitante não reserva envio, não registra clique direto, não lê métricas', !!r1.error && !!r2.error && !!r3.error)
  const chk = await um(`select pg_get_constraintdef(oid) d from pg_constraint where conname='campanha_envios_status_check'`)
  ok('status do envio restrito ao conjunto conhecido', !!chk && /expirado/.test(chk.d) && !/inventado/.test(chk.d))

  secao('2. Fila antiga parada não sai (trava de 24h)')
  const velha = (await um(`insert into campanhas (restaurante_id, nome, status, mensagem, agendado_em, total_destinatarios) values ($1,'Antiga travada','enviando','promo velha', now() - interval '3 days', 1) returning id`, [A])).id
  await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente) values ($1,$2,$3,'Velho')`, [velha, A, C.c4])
  const cv = await cron()
  const ev = await um(`select status from campanha_envios where campanha_id=$1`, [velha])
  ok('envio de campanha agendada há 3 dias expira sem sair', cv.s === 200 && ev.status === 'expirado' && enviados().length === 0, JSON.stringify(cv.j))
  ok('campanha antiga fica concluída (nada na fila)', (await um(`select status from campanhas where id=$1`, [velha])).status === 'concluida')
  await db.query(`delete from campanhas where id=$1`, [velha])

  secao('3. Criar e disparar pelo painel (dono)')
  const dono = await logar('dono.campa')
  const cria = await api(dono.p, '/api/admin/campanhas', 'POST', {
    nome: 'Promo de quinta', tipoMensagem: 'texto', mensagem: 'Hoje tem promoção! Peça aqui: {link}', filtro: { tipo: 'todos' },
    incluirLink: true, disparar: true, agendadoEm: new Date().toISOString(),
  })
  const camp1 = cria.j?.id
  ok('campanha criada (201)', cria.s === 201 && !!camp1)
  const c1row = await um(`select status, total_destinatarios, duplicados_bloqueados, incluir_link from campanhas where id=$1`, [camp1])
  ok('destinatários: 4 únicos (C1 em formato antigo barrado como duplicado)', c1row.total_destinatarios === 4 && c1row.duplicados_bloqueados === 1 && c1row.incluir_link === true, JSON.stringify(c1row))
  const fila = await envios(camp1)
  ok('cada destinatário tem token próprio de 24 hex', fila.length === 4 && new Set(fila.map((e) => e.token)).size === 4 && fila.every((e) => /^[0-9a-f]{24}$/.test(e.token)))
  let dupBanco = false
  try { await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone) values ($1,$2,$3)`, [camp1, A, '11912340101']) } catch { dupBanco = true }
  ok('banco recusa o mesmo telefone duas vezes na campanha (outro formato)', dupBanco)

  secao('4. Envio simulado com falha temporária e nova tentativa')
  controle({ falhar: 'transitorio', restantes: 1 })
  // Dois crons ao mesmo tempo: skip locked — ninguém recebe duas vezes.
  const [k1, k2] = await Promise.all([cron(), cron()])
  const depois1 = await envios(camp1)
  ok('dois crons simultâneos: 4 reservas, sem repetição', k1.s === 200 && k2.s === 200 && (k1.j.processados + k2.j.processados) === 4, `${JSON.stringify(k1.j)} ${JSON.stringify(k2.j)}`)
  const pend = depois1.filter((e) => e.status === 'pendente')
  ok('falha temporária volta para a fila com espera', pend.length === 1 && pend[0].tentativas === 1 && new Date(pend[0].proxima_tentativa_em) > new Date())
  ok('campanha em "enviando" enquanto há fila', (await um(`select status from campanhas where id=$1`, [camp1])).status === 'enviando')
  const k3 = await cron()
  ok('antes da espera acabar, a nova tentativa não sai', k3.j.processados === 0)
  await db.query(`update campanha_envios set proxima_tentativa_em = now() where campanha_id=$1 and status='pendente'`, [camp1])
  const k4 = await cron()
  const depois2 = await envios(camp1)
  ok('nova tentativa enviada; campanha concluída', k4.j.enviados === 1 && depois2.every((e) => e.status === 'enviado') && (await um(`select status, total_enviados from campanhas where id=$1`, [camp1])).status === 'concluida')
  const saidas = enviados().filter((x) => x.resultado === 'ok')
  const porNumero = new Map(); for (const s of saidas) porNumero.set(s.numero, (porNumero.get(s.numero) ?? 0) + 1)
  ok('cada cliente recebeu exatamente uma mensagem', saidas.length === 4 && [...porNumero.values()].every((n) => n === 1))
  const linkC1 = saidas.find((s) => s.numero === C.c1)?.texto ?? ''
  const tokC1 = depois2.find((e) => e.telefone === C.c1).token
  ok('texto com o link do próprio cliente no lugar de {link}', linkC1 === `Hoje tem promoção! Peça aqui: https://app.menuzia.com.br/c/${tokC1}`)
  const caminhos = saidas.flatMap((s) => [...s.texto.matchAll(/\/c\/(\S*)/g)].map((m) => m[1]))
  ok('link é só /c/<24 hex>: sem telefone, nome ou id de campanha', caminhos.length === 4 && caminhos.every((c) => /^[0-9a-f]{24}$/.test(c)) && caminhos.every((c) => !Object.values(C).some((t) => c.includes(t.slice(-8)))))
  ok('id do provedor guardado em cada envio', depois2.every((e) => e.id_externo?.startsWith('SIM')))
  ok('tentativas contadas (retry = 1)', depois2.reduce((s, e) => s + e.tentativas, 0) === 5)

  secao('5. Webhook: entregue, lida, duplicado, eco da campanha, resposta')
  const porTel = Object.fromEntries(depois2.map((e) => [e.telefone, e]))
  const w1 = await webhook(statusEvt(porTel[C.c1].id_externo, 'DELIVERY_ACK'))
  await webhook(statusEvt(porTel[C.c2].id_externo, 'DELIVERY_ACK'))
  await webhook(statusEvt(porTel[C.c3].id_externo, 'DELIVERY_ACK'))
  await webhook(statusEvt(porTel[C.c1].id_externo, 'READ'))
  await webhook(statusEvt(porTel[C.c2].id_externo, 'READ'))
  const wDup = await webhook(statusEvt(porTel[C.c1].id_externo, 'DELIVERY_ACK'))
  const wOutra = await webhook(statusEvt('ID-DE-OUTRA-MENSAGEM', 'READ'))
  ok('entrega registrada (robô desligado não impede métrica)', w1.s === 200 && w1.j?.ignoradas?.campanha_entregue === 1)
  ok('entrega repetida é barrada', wDup.j?.ignoradas?.campanha_status_repetido === 1)
  ok('status de mensagem que não é campanha é ignorado', wOutra.j?.ignoradas?.status_de_outra_mensagem === 1)
  const contaEv = async () => (await um(`select count(*)::int n from whatsapp_eventos where restaurante_id=$1 and tipo='webhook'`, [A])).n
  const antesEv = await contaEv()
  await webhook(statusEvt('OUTRA-2', 'DELIVERY_ACK'))
  await webhook(statusEvt('OUTRA-3', 'READ'))
  const semNovo = (await contaEv()) === antesEv
  await db.query(`delete from whatsapp_eventos where restaurante_id=$1 and resultado @> '{"so_status": true}'::jsonb`, [A])
  const base = await contaEv()
  await webhook(statusEvt('OUTRA-4', 'DELIVERY_ACK'))
  const umMarcador = (await contaEv()) === base + 1
  await webhook(statusEvt('OUTRA-5', 'READ'))
  await webhook(statusEvt('OUTRA-6', 'READ'))
  ok('status de aviso/conversa comum não enche o registro: um marcador por hora', semNovo && umMarcador && (await contaEv()) === base + 1)
  const st = await um(`select count(*) filter (where entregue_em is not null)::int e, count(*) filter (where lido_em is not null)::int l from campanha_envios where campanha_id=$1`, [camp1])
  ok('3 entregues e 2 lidas gravadas', st.e === 3 && st.l === 2)
  // Robô ligado: o eco da campanha (fromMe) não pode silenciar o cliente.
  await db.query(`update whatsapp_robo_config set robo_ativo=true where restaurante_id=$1`, [A])
  const eco = await webhook(msgEvt(C.c3, { fromMe: true, id: porTel[C.c3].id_externo, texto: 'Hoje tem promoção!' }))
  ok('eco da campanha reconhecido; conversa segue com o robô', eco.j?.ignoradas?.enviada_pela_campanha === 1 && !(await um(`select 1 x from whatsapp_conversas where restaurante_id=$1 and telefone=$2 and estado='silenciada'`, [A, C.c3])))
  const respId = `RESP${Date.now()}`
  const resp = await webhook(msgEvt(C.c2, { texto: 'oi', id: respId }))
  ok('resposta do cliente chega e o robô responde (robô intacto)', resp.s === 200 && resp.j?.respostas === 1, JSON.stringify(resp.j))
  const respDup = await webhook(msgEvt(C.c2, { texto: 'oi', id: respId }))
  ok('mesma mensagem reentregue não é processada de novo', respDup.j?.ignoradas?.duplicada === 1 && respDup.j?.respostas === 0)
  await db.query(`update whatsapp_robo_config set robo_ativo=false where restaurante_id=$1`, [A])

  secao('6. Clique no link rastreável')
  const pv = await clique(tokC1, 'WhatsApp/2.24.1 A')
  const hd = await clique(tokC1, undefined, 'HEAD')
  ok('pré-visualização do WhatsApp e HEAD redirecionam sem contar', pv.s === 302 && hd.s === 302 && (await um(`select cliques from campanha_envios where token=$1`, [tokC1])).cliques === 0)
  const ck = await clique(tokC1)
  ok('clique do cliente conta e vai para o cardápio da loja', ck.s === 302 && ck.loc === `https://app.menuzia.com.br/loja/${LOJA}` && (await um(`select cliques from campanha_envios where token=$1`, [tokC1])).cliques === 1, ck.loc)
  const ck2 = await clique(tokC1)
  ok('toque duplo em menos de 10s não conta de novo (duplicidade barrada)', ck2.s === 302 && (await um(`select cliques from campanha_envios where token=$1`, [tokC1])).cliques === 1)
  const inval = await clique('zz' + 'a'.repeat(22))
  const inex = await clique('f'.repeat(24))
  const inicio = (l) => l === 'https://app.menuzia.com.br' || l === 'https://app.menuzia.com.br/'
  ok('token inválido ou inexistente: vai para a página inicial, sem erro', inval.s === 302 && inicio(inval.loc) && inex.s === 302 && inicio(inex.loc), `${inval.s} ${inval.loc} ${inex.s} ${inex.loc}`)

  secao('7. Pedidos e conversão em 12h')
  const p1 = await pedido(A, C.c1, 'entregue', 60) // depois do clique: confirmada
  const p2 = await pedido(A, '11912340102', 'preparando', 40) // C2 em outro formato, sem clique: provável
  await db.query(`update campanha_envios set enviado_em = now() - interval '13 hours' where campanha_id=$1 and telefone=$2`, [camp1, C.c3])
  await pedido(A, C.c3, 'entregue', 99) // 13h depois do envio: fora da janela
  await pedido(A, C.c4, 'cancelado', 77) // cancelado não conta
  await pedido(A, OUTRO, 'entregue', 55) // telefone que não recebeu campanha
  await pedido(B, C.c1, 'entregue', 88) // mesmo telefone, outra loja
  const m1 = await metricas(dono.p)
  const t = m1.j?.totais ?? {}
  ok('métricas: 200 para o dono', m1.s === 200 && Array.isArray(m1.j?.campanhas), JSON.stringify(m1.j).slice(0, 200))
  ok('enviadas 4 · entregues 3 · lidas 2 · respondidas 1', t.enviadas === 4 && t.entregues === 3 && t.lidas === 2 && t.respondidas === 1, JSON.stringify(t))
  ok('cliques: 1 pessoa, 1 clique', t.clicaram === 1 && t.cliques === 1)
  ok('pedidos em 12h: 2 (1 com clique, 1 provável); fora da janela, cancelado, outro telefone e outra loja fora', t.pedidos === 2 && t.pedidos_clique === 1 && t.convertidos === 2)
  ok('faturamento = 60 + 40', Number(t.faturamento) === 100)
  ok('retry 1, falhas 0, duplicidades barradas 3 (lista, webhook, clique)', t.retries === 1 && t.falhas === 0 && t.duplicados_bloqueados === 3, JSON.stringify({ r: t.retries, f: t.falhas, d: t.duplicados_bloqueados }))
  const det = await api(dono.p, `/api/admin/campanhas/metricas?detalhe=${camp1}`)
  const dC1 = det.j?.destinatarios?.find((d) => d.nome === 'Cliente C1')
  const dC2 = det.j?.destinatarios?.find((d) => d.nome === 'Cliente C2')
  ok('detalhe: pedido de C1 confirmado pelo clique; C2 provável e respondeu', det.s === 200 && dC1?.pedido?.numero === p1.numero && dC1?.pedido?.via_clique === true && dC2?.pedido?.numero === p2.numero && dC2?.pedido?.via_clique === false && dC2?.respondeu === true)
  ok('detalhe mostra telefone mascarado', (det.j?.destinatarios ?? []).every((d) => /^•••• \d{4}$/.test(d.telefone)))

  // Último toque: campanha mais recente para C2 antes do pedido leva o pedido.
  await db.query(`update campanha_envios set enviado_em = now() - interval '2 hours' where campanha_id=$1 and telefone=$2`, [camp1, C.c2])
  const camp3 = (await um(`insert into campanhas (restaurante_id, nome, status, mensagem, agendado_em) values ($1,'Lembrete','concluida','volta!', now() - interval '1 hour') returning id`, [A])).id
  await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente, status, enviado_em) values ($1,$2,$3,'Cliente C2','enviado', $4::timestamptz - interval '1 minute')`, [camp3, A, C.c2, p2.criado_em])
  const m2 = await metricas(dono.p)
  const c1m = m2.j.campanhas.find((c) => c.id === camp1)
  const c3m = m2.j.campanhas.find((c) => c.id === camp3)
  ok('pedido vai para a campanha mais recente (último toque), sem contar duas vezes', c1m.pedidos === 1 && c3m.pedidos === 1 && m2.j.totais.pedidos === 2)
  await db.query(`delete from campanhas where id=$1`, [camp3])

  secao('8. Campanha com falha, incerta e sem conversão; sem link')
  // {link} com o link desligado sairia literal para o cliente: o painel recusa (0112).
  const linkDesligado = await api(dono.p, '/api/admin/campanhas', 'POST', {
    nome: 'Sem link', tipoMensagem: 'texto', mensagem: 'Texto puro {link}', filtro: { tipo: 'todos' }, incluirLink: false, disparar: true, agendadoEm: new Date().toISOString(),
  })
  ok('{link} com o link desligado é recusado ao salvar', linkDesligado.s === 400 && /Incluir link/.test(linkDesligado.j?.error ?? ''), linkDesligado.j?.error)
  controle({ falhar: 'definitivo', restantes: 2 })
  const cria2 = await api(dono.p, '/api/admin/campanhas', 'POST', {
    nome: 'Sem link', tipoMensagem: 'texto', mensagem: 'Texto puro', filtro: { tipo: 'todos' }, incluirLink: false, disparar: true, agendadoEm: new Date().toISOString(),
  })
  const camp2 = cria2.j.id
  // Um destinatário fica para depois, para a tentativa "incerta".
  await db.query(`update campanha_envios set proxima_tentativa_em = now() + interval '1 hour' where id = (select id from campanha_envios where campanha_id=$1 order by criado_em desc limit 1)`, [camp2])
  await cron()
  controle({ falhar: 'incerto', restantes: 1 })
  await db.query(`update campanha_envios set proxima_tentativa_em = now() where campanha_id=$1 and status='pendente'`, [camp2])
  await cron()
  const e2 = await envios(camp2)
  const cont = e2.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] ?? 0) + 1 }), {})
  ok('2 falhas definitivas (sem nova tentativa) e 1 incerta (nunca reenviada)', cont.erro === 2 && cont.incerto === 1 && cont.enviado === 1, JSON.stringify(cont))
  ok('sem link: mensagem sai exatamente como escrita', enviados().filter((x) => x.resultado === 'ok').at(-1)?.texto === 'Texto puro')
  const m3 = await metricas(dono.p, `&campanha=${camp2}`)
  const c2m = m3.j.campanhas[0]
  ok('filtro por campanha + métricas da campanha com falha', m3.j.campanhas.length === 1 && c2m.falhas === 2 && c2m.incertos === 1 && c2m.enviadas === 1 && c2m.cliques === 0 && c2m.incluir_link === false)
  ok('campanha concluída mesmo com falhas', (await um(`select status from campanhas where id=$1`, [camp2])).status === 'concluida')
  ok('campanha sem conversão (pedidos anteriores ao envio não contam)', c2m.pedidos === 0 && c2m.pedidos_clique === 0 && c2m.convertidos === 0)

  secao('9. Cancelar e editar')
  const futura = await api(dono.p, '/api/admin/campanhas', 'POST', {
    nome: 'Amanhã', tipoMensagem: 'texto', mensagem: 'Até amanhã', filtro: { tipo: 'todos' }, incluirLink: true, disparar: true, agendadoEm: new Date(Date.now() + 86400e3).toISOString(),
  })
  const antes = enviados().length
  const canc = await api(dono.p, `/api/admin/campanhas/${futura.j.id}`, 'PATCH', { status: 'cancelada' })
  await cron()
  const ef = await envios(futura.j.id)
  ok('cancelar: fila vira "cancelado" e nada sai', canc.s === 200 && ef.length === 4 && ef.every((e) => e.status === 'cancelado') && enviados().length === antes)
  const edit = await api(dono.p, `/api/admin/campanhas/${camp1}`, 'PATCH', { nome: 'Outra', disparar: true, agendadoEm: new Date().toISOString() })
  ok('campanha já enviada não é editada nem redisparada (409)', edit.s === 409 && (await envios(camp1)).length === 4)
  const statusInvent = await api(dono.p, `/api/admin/campanhas/${camp1}`, 'PATCH', { status: 'agendada' })
  ok('status arbitrário recusado (400)', statusInvent.s === 400)

  secao('10. Isolamento e permissões')
  const gerente = await logar('gerente.campa')
  ok('gerente da loja vê as métricas', (await metricas(gerente.p)).s === 200)
  const garcom = await logar('garcom.campa')
  const mg = await metricas(garcom.p)
  ok('garçom não vê métricas de campanha', mg.s === 403, String(mg.s))
  const donoB = await logar('dono.campb')
  const mb = await metricas(donoB.p)
  ok('dono da outra loja: nenhuma campanha de A', mb.s === 200 && mb.j.campanhas.length === 0 && mb.j.totais.enviadas === 0)
  const db2 = await api(donoB.p, `/api/admin/campanhas/metricas?detalhe=${camp1}`)
  ok('dono da outra loja não abre o detalhe de A (404)', db2.s === 404)
  const mbf = await metricas(donoB.p, `&campanha=${camp1}`)
  ok('filtro com campanha de outra loja devolve vazio', mbf.s === 200 && mbf.j.campanhas.length === 0)
  const sbB = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  await sbB.auth.signInWithPassword({ email: 'dono@camp-b.local', password: SENHA })
  const { data: rlsB } = await sbB.from('campanha_envios').select('id').eq('campanha_id', camp1)
  const rReserva = await sbB.rpc('campanha_reservar_envios', { p_limite: 5 })
  ok('RLS: dono de B não lê envios de A e não mexe na fila', (rlsB ?? []).length === 0 && !!rReserva.error)
  const semSessao = await fetch(`${BASE}/api/admin/campanhas/metricas`).then((r) => r.status)
  ok('sem sessão: bloqueado', semSessao === 401 || semSessao === 307 || semSessao === 302, String(semSessao))

  secao('11. Tela')
  await dono.p.goto(`${BASE}/admin/campanhas`, { waitUntil: 'networkidle' })
  await dispensar(dono.p)
  await dono.p.getByTestId('ver-detalhado').click()
  const painel = dono.p.getByTestId('metricas-campanhas')
  await painel.getByText('Pedidos em 12h').first().waitFor({ timeout: 15000 })
  const txt = await painel.innerText()
  ok('painel mostra cards, funil e tabela', /enviadas\s*5\b/i.test(txt) && /Faturamento/.test(txt) && /Funil/.test(txt) && /Promo de quinta/.test(txt) && /Como contamos/.test(txt), txt.slice(0, 160).replace(/\n/g, ' | '))
  ok('textos no plural certo (2 clientes pediram, 1 provável, 1 clique)', txt.includes('2 clientes pediram') && /1 com clique · 1 provável\b/.test(txt) && txt.includes('1 clique no total') && !/\b1 clientes pediram/.test(txt))
  await dono.p.screenshot({ path: join(SHOTS, 'metricas-desktop.png'), fullPage: true })
  await painel.locator('tr', { hasText: 'Promo de quinta' }).click()
  await dono.p.getByTestId('destinatarios').waitFor({ timeout: 10000 })
  const dtxt = await dono.p.getByTestId('destinatarios').innerText()
  ok('detalhe da campanha abre com os destinatários e o pedido', /Pedido #/.test(dtxt) && /Clicou/.test(dtxt) && /provável/.test(dtxt))
  await dono.p.screenshot({ path: join(SHOTS, 'metricas-detalhe.png') })
  await dono.p.keyboard.press('Escape')
  const cel = await logar('dono.campa', { width: 390, height: 844 })
  await cel.p.goto(`${BASE}/admin/campanhas`, { waitUntil: 'networkidle' })
  await dispensar(cel.p)
  await cel.p.getByTestId('ver-detalhado').click()
  await cel.p.getByTestId('metricas-campanhas').getByText('Pedidos em 12h').first().waitFor({ timeout: 15000 })
  const larg = await cel.p.evaluate(() => document.documentElement.scrollWidth)
  ok('celular (390px): sem rolagem horizontal', larg <= 392, String(larg))
  await cel.p.screenshot({ path: join(SHOTS, 'metricas-celular.png'), fullPage: true })
  await donoB.p.goto(`${BASE}/admin/campanhas`, { waitUntil: 'networkidle' })
  await dispensar(donoB.p)
  await donoB.p.getByTestId('ver-detalhado').click()
  await donoB.p.getByText('Nenhuma campanha neste período').waitFor({ timeout: 15000 }).catch(() => {})
  ok('estado vazio para loja sem campanha', await donoB.p.getByText('Nenhuma campanha neste período').isVisible())
  await donoB.p.screenshot({ path: join(SHOTS, 'metricas-vazio.png') })
  // Formulário: opção de link e prévia com o link.
  // Repaginação 2026-10: o disparo fica no topo ("Disparar mensagem").
  await dono.p.getByTestId('disparar-mensagem').click()
  ok('formulário traz a opção de link ligada por padrão', await dono.p.getByTestId('incluir-link').isChecked())
  await dono.p.screenshot({ path: join(SHOTS, 'form-link.png') })

  secao('12. Nada foi enviado fora do simulado')
  ok('todas as saídas foram para o provedor simulado, só para os 4 clientes de teste', enviados().every((x) => Object.values(C).includes(x.numero) || x.numero === undefined))
} catch (e) {
  ok(`execução sem exceção: ${e.message}`, false)
  console.error(e)
} finally {
  await browser.close()
  await db.end()
}

const f = res.filter((x) => !x.c)
console.log(`\n${res.length - f.length}/${res.length} verificações passaram`)
if (f.length) { console.log('Falharam:\n' + f.map((x) => ` - ${x.n}`).join('\n')); process.exit(1) }
