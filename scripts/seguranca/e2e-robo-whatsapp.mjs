/**
 * E2E do robô de atendimento do WhatsApp (0103) e da fila de avisos — provedor SIMULADO,
 * lojas isoladas, nenhuma comunicação externa.
 *
 * Trava obrigatória (aborta antes de QUALQUER escrita):
 *   ROBO_E2E_LOJA=robo-e2e-a  ROBO_E2E_VIZINHA=robo-e2e-b  (slugs começando com robo-e2e)
 *   ROBO_PROVEDOR=simulado     WHATSAPP_SIMULADO_ARQUIVO=<arquivo>  (o MESMO do servidor)
 * O servidor local precisa subir com WHATSAPP_PROVEDOR=simulado, o mesmo
 * WHATSAPP_SIMULADO_ARQUIVO, CRON_SECRET e WHATSAPP_ROBO_LIBERADO=1.
 * Fase "bloqueado" (ROBO_E2E_FASE=bloqueado): servidor SEM WHATSAPP_ROBO_LIBERADO — prova
 * que publicar o código não responde ninguém. O servidor-local.mjs já apaga as variáveis da
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
  for (const t of ['whatsapp_eventos', 'whatsapp_envios', 'whatsapp_mensagens', 'whatsapp_conversas', 'whatsapp_robo_config']) await db.query(`delete from ${t} where restaurante_id=$1`, [id])
  await db.query(`delete from pedido_itens where pedido_id in (select id from pedidos where restaurante_id=$1)`, [id])
  await db.query(`delete from pedidos where restaurante_id=$1`, [id])
  await db.query(`delete from taxas_entrega_bairro where restaurante_id=$1`, [id])
  await db.query(`delete from taxas_entrega_raio where restaurante_id=$1`, [id])
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

if (process.env.ROBO_E2E_FASE === 'bloqueado') {
  try {
    secao('0. Servidor NÃO liberado (produção recém-publicada)')
    await db.query(`update whatsapp_robo_config set robo_ativo=true where restaurante_id=$1`, [A])
    const r0 = await webhook(SEG_A, evento('robo-sim-a', { texto: 'oi', id: 'BLOQ-1' }))
    ok('webhook aceito, mas nada gravado nem respondido', r0.s === 200 && r0.j?.ignoradas?.robo_nao_liberado_no_servidor === 1 && (await envios(A)).length === 0 && !(await conversa(A)))
    ok('evento do webhook registrado (só metadado)', (await um(`select count(*)::int n from whatsapp_eventos where restaurante_id=$1 and tipo='webhook'`, [A])).n === 1)
    await db.query(`insert into whatsapp_envios (restaurante_id, chave, tipo, telefone, texto) values ($1,'bloq-manual','robo',$2,'teste')`, [A, CLI])
    const cr = await cron()
    const e0 = await um(`select estado, ultimo_erro from whatsapp_envios where chave='bloq-manual'`)
    ok('resposta que estivesse na fila não sai (cron recusa)', cr.s === 200 && e0.estado === 'falhou' && /não liberado/.test(e0.ultimo_erro ?? ''))
    await db.query(`update whatsapp_robo_config set robo_ativo=false where restaurante_id=$1`, [A])
    const dono = await logar('dono.roboa')
    const lig = await api(dono.p, '/api/admin/whatsapp/robo', 'PUT', { roboAtivo: true })
    ok('painel não deixa ligar (409 nao_liberado)', lig.s === 409 && lig.j?.codigo === 'nao_liberado')
    await dono.p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'networkidle' })
    await dispensar(dono.p)
    await dono.p.getByTestId('robo-bloqueado').waitFor({ timeout: 10000 })
    ok('tela avisa que não foi liberado e o botão de ligar fica desabilitado', await dono.p.getByTestId('robo-alternar').isDisabled())
    await dono.p.getByTestId('robo-whatsapp').screenshot({ path: join(SHOTS, 'integracoes-robo-bloqueado.png') })
    ok('nenhum envio saiu para o provedor', enviados().length === 0)
    await dono.ctx.close()
  } finally {
    await browser.close()
    await db.end()
  }
  const fb = res.filter((r) => !r.c)
  console.log(`\n${res.length - fb.length}/${res.length} verificações passaram (fase bloqueada)`)
  process.exit(fb.length ? 1 : 0)
}

try {
  secao('1. Webhook: segredo, corpo e robô desligado')
  ok('segredo inexistente → 404', (await webhook('0'.repeat(48), evento('robo-sim-a'))).s === 404)
  ok('segredo fora do formato → 404', (await webhook('abc', evento('robo-sim-a'))).s === 404)
  ok('corpo inválido → 400', (await webhook(SEG_A, '{nao-json')).s === 400)
  ok('corpo acima de 256 KB → 413', (await webhook(SEG_A, JSON.stringify({ x: 'a'.repeat(300 * 1024) }))).s === 413)
  const desl = await webhook(SEG_A, evento('robo-sim-a'))
  ok('robô desligado: nada gravado nem respondido', desl.s === 200 && desl.j?.ignoradas?.robo_desligado === 1 && (await envios(A)).length === 0 && !(await conversa(A)))
  ok('evento do webhook registrado sem conteúdo', JSON.stringify((await um(`select resultado from whatsapp_eventos where restaurante_id=$1 and tipo='webhook' order by criado_em desc limit 1`, [A])).resultado).includes('robo_desligado'))
  ok('evento de outra coisa que não mensagem (connection.update) → 200 sem nada', (await webhook(SEG_A, { event: 'connection.update', instance: 'robo-sim-a', data: { state: 'open' } })).s === 200 && (await envios(A)).length === 0)
  ok('JSON válido mas sem forma de mensagem → 200 sem nada', (await webhook(SEG_A, { event: 'messages.upsert', data: 'lixo' })).s === 200 && (await envios(A)).length === 0)

  secao('2. Painel: ligar o robô (dono) e permissões')
  const dono = await logar('dono.roboa')
  await dono.p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'networkidle' })
  await dispensar(dono.p)
  ok('todas as lojas nascem com o robô desligado', (await um(`select count(*)::int n from whatsapp_robo_config where robo_ativo`)).n === 0)
  await dono.p.getByTestId('robo-whatsapp').getByTestId('robo-alternar').click()
  await dono.p.getByTestId('robo-confirmar-ligar').click()
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
  ok('GET do painel não expõe o segredo do webhook (só os 4 últimos)', g.s === 200 && !JSON.stringify(g.j).includes(SEG_A) && !('webhookSegredo' in (g.j ?? {})) && g.j?.webhookMascarado?.endsWith(SEG_A.slice(-4)))
  ok('painel mostra liberado, instância e quem alterou', g.j?.liberadoNoServidor === true && g.j?.instancia === 'robo-sim-a' && !!g.j?.atualizadoPor)
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
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'asdfgh qwerty' }))
  const env2 = await ultimo(A)
  ok('texto não reconhecido dentro da janela → resposta padrão (sem boas-vindas de novo)', (await envios(A)).length === 2 && /Não entendi/.test(env2.texto) && env2.texto.includes(`/loja/${LOJA}`) && !env2.texto.includes('atendimento automático'))
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'hmm' }))
  ok('resposta padrão no máximo 1 a cada 10 min (sem excesso de mensagens)', (await envios(A)).length === 2)
  for (const [nome, message, marca] of [['áudio', { audioMessage: {} }, /ouvir áudios/], ['imagem', { imageMessage: {} }, /ver imagens/], ['figurinha', { stickerMessage: {} }, /figurinha/], ['localização', { locationMessage: {} }, /taxa\* e o seu bairro/]]) {
    await db.query(`update whatsapp_conversas set resposta_padrao_em = null where restaurante_id=$1 and telefone=$2`, [A, CLI])
    await webhook(SEG_A, evento('robo-sim-a', { message }))
    const u = await ultimo(A)
    ok(`${nome} → resposta própria do tipo, com link e opção de atendente`, marca.test(u.texto) && u.texto.includes(`/loja/${LOJA}`) && u.texto.includes('*2*'))
  }
  await recuar(A, 13)
  const antes12 = (await envios(A)).length
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'boa noite' }))
  ok('depois de 12h sem conversa → boas-vindas de novo', (await envios(A)).length === antes12 + 1 && (await ultimo(A)).texto.includes('atendimento automático'))

  secao('3b. Cardápio, horário e taxa de entrega por bairro')
  await db.query(`insert into taxas_entrega_bairro (restaurante_id, bairro, taxa) values ($1,'Centro',5),($1,'Praia do Canto',0)`, [A])
  await db.query(`update restaurantes set status_loja='automatico', horario_funcionamento=$2 where id=$1`, [A, JSON.stringify({ '1': [{ abre: '18:00', fecha: '23:00' }], '5': [{ abre: '11:00', fecha: '14:00' }, { abre: '18:00', fecha: '23:30' }] })])
  await webhook(SEG_A, evento('robo-sim-a', { texto: '3' }))
  ok('"3" → link do cardápio', (await ultimo(A)).texto.includes(`Nosso cardápio`) && (await ultimo(A)).texto.includes(`/loja/${LOJA}`))
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'que horas vocês abrem?' }))
  const hor = (await ultimo(A)).texto
  ok('horário: aberto/fechado agora e a grade da semana', /(abertos|fechados)/.test(hor) && hor.includes('Segunda: 18:00–23:00') && hor.includes('Sexta: 11:00–14:00 e 18:00–23:30'), hor.split('\n')[0])
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'qual a taxa pro Centro?' }))
  ok('taxa de bairro cadastrado (regra da loja), com o link para o valor final', /Centro\* é \*R\$\s?5,00\*/.test((await ultimo(A)).texto) && (await ultimo(A)).texto.includes('valor final'))
  await webhook(SEG_A, evento('robo-sim-a', { texto: '5 praia do canto' }))
  ok('taxa grátis do bairro', (await ultimo(A)).texto.includes('*grátis*'))
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'taxa' }))
  ok('"taxa" sem bairro → pede o bairro', (await ultimo(A)).texto.includes('taxa Centro'))
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'taxa Marte' }))
  ok('bairro fora da lista (loja bloqueia) → não promete, oferece atendente', /Não encontrei \*Marte\*/.test((await ultimo(A)).texto))
  await db.query(`insert into taxas_entrega_raio (restaurante_id, ate_km, taxa) values ($1, 3, 2)`, [A])
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'taxa Marte' }))
  ok('loja com faixa por distância → "depende da distância", sem inventar valor', /depende da distância/.test((await ultimo(A)).texto) && !/R\$/.test((await ultimo(A)).texto))
  await db.query(`delete from taxas_entrega_raio where restaurante_id=$1`, [A])
  ok('consultar taxa não mexe na loja (sem geocodificar, sem gravar coordenadas)', (await um(`select latitude from restaurantes where id=$1`, [A])).latitude === null)
  await webhook(SEG_A, evento('robo-sim-a', { texto: '0' }))
  ok('"0" → menu de novo', /\*5\* Taxa de entrega/.test((await ultimo(A)).texto))

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
  ok('passagem para atendente registrada (whatsapp_eventos)', !!(await um(`select 1 from whatsapp_eventos where conversa_id=$1 and tipo='atendente'`, [cv.id])))
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
  await db.query(`update whatsapp_conversas set silenciada_em = now() - interval '3 hours', resposta_padrao_em = null where restaurante_id=$1 and telefone=$2`, [A, CLI])
  const n3h = (await envios(A)).length
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'alguém?' }))
  ok('3h depois (padrão 12h) continua em atendimento humano, sem resposta', (await envios(A)).length === n3h && (await conversa(A)).estado === 'silenciada')
  await db.query(`update whatsapp_conversas set ultima_mensagem_em = now() - interval '13 hours', silenciada_em = now() - interval '13 hours', resposta_padrao_em = null where restaurante_id=$1 and telefone=$2`, [A, CLI])
  const nVolta = (await envios(A)).length
  await webhook(SEG_A, evento('robo-sim-a', { texto: 'oi de novo' }))
  ok('silenciada há mais de 12h sem mensagens → volta sozinho', (await envios(A)).length === nVolta + 1 && (await conversa(A)).estado === 'robo')
  ok('volta ao robô registrada (whatsapp_eventos)', !!(await um(`select 1 from whatsapp_eventos where conversa_id=$1 and tipo='retorno_robo'`, [(await conversa(A)).id])))
  const outra = await logar('dono.robob')
  const r = await api(outra.p, '/api/admin/whatsapp/conversas', 'POST', { conversaId: (await conversa(A)).id, acao: 'devolver' })
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

  secao('9. Avisos de etapa do pedido continuam no envio de sempre (fora da fila do robô)')
  const r9 = await api(dono.p, `/api/pedidos/${pedA.id}/notificar`, 'POST', { status: 'pronto' })
  ok('avisar etapa do pedido não cria nada na fila do robô', r9.s === 200 && (await q(`select 1 from whatsapp_envios where pedido_id=$1 or tipo='aviso_pedido'`, [pedA.id])).length === 0)

  secao('9b. Robô desligado com resposta na fila: nada sai depois')
  await db.query(`update whatsapp_robo_config set robo_ativo=false where restaurante_id=$1`, [A])
  await db.query(`insert into whatsapp_envios (restaurante_id, chave, tipo, telefone, texto) values ($1,'desligou-no-meio','robo',$2,'teste')`, [A, CLI])
  const antes9b = enviados().length
  await cron()
  const e9b = await um(`select estado, ultimo_erro from whatsapp_envios where chave='desligou-no-meio'`)
  ok('envio pendente de loja que desligou o robô → falhou, sem sair', e9b.estado === 'falhou' && /desligado/.test(e9b.ultimo_erro ?? '') && enviados().length === antes9b)
  await db.query(`update whatsapp_robo_config set robo_ativo=true where restaurante_id=$1`, [A])

  secao('9c. Trocar o segredo derruba o endereço antigo')
  const rot = await api(dono.p, '/api/admin/whatsapp/robo', 'POST', { acao: 'rotacionar_segredo' })
  const SEG_A2 = (await um(`select webhook_segredo s from whatsapp_robo_config where restaurante_id=$1`, [A])).s
  ok('segredo novo gerado e mascarado na resposta', rot.s === 200 && SEG_A2 !== SEG_A && rot.j?.webhookMascarado?.endsWith(SEG_A2.slice(-4)) && !JSON.stringify(rot.j).includes(SEG_A2))
  ok('segredo antigo → 404 (replay com endereço vazado não funciona)', (await webhook(SEG_A, evento('robo-sim-a', { texto: 'oi' }))).s === 404)
  ok('segredo novo funciona', (await webhook(SEG_A2, evento('robo-sim-a', { texto: 'oi' }))).s === 200)
  await db.query(`update whatsapp_robo_config set webhook_segredo=$2 where restaurante_id=$1`, [A, SEG_A])

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
  const evA = await cDonoA.from('whatsapp_eventos').select('restaurante_id')
  ok('dono A lê só eventos da A', !evA.error && evA.data.length > 0 && evA.data.every((x) => x.restaurante_id === A))
  ok('garçom não lê eventos', ((await cGar.from('whatsapp_eventos').select('id')).data ?? []).length === 0)
  ok('dono B não vê eventos da A', ((await cDonoB.from('whatsapp_eventos').select('restaurante_id')).data ?? []).every((x) => x.restaurante_id === B))
  const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  ok('anônimo não lê nada', ((await anon.from('whatsapp_mensagens').select('id')).data ?? []).length === 0)
  const rpc = await cDonoA.rpc('whatsapp_registrar_entrada', { p_restaurante: B, p_telefone: CLI, p_wa_id: 'X', p_de_mim: false, p_tipo: 'texto', p_texto: 'x', p_instante: null, p_intencao: 'outro' })
  ok('usuário logado não chama as funções do robô', !!rpc.error)

  secao('11. Retenção: conteúdo 90 dias, metadado 12 meses')
  const cvA = await conversa(A)
  await db.query(`insert into whatsapp_mensagens (restaurante_id, conversa_id, wa_id, direcao, tipo, texto, criado_em) values
    ($1,$2,'VELHA-91D','entrada','texto','conteúdo antigo', now() - interval '91 days'),
    ($1,$2,'VELHA-13M','entrada','texto','muito antigo', now() - interval '13 months')`, [A, cvA.id])
  await db.query(`insert into whatsapp_envios (restaurante_id, chave, tipo, telefone, texto, estado, criado_em) values
    ($1,'env-91d','robo',$2,'resposta antiga','enviado', now() - interval '91 days'),
    ($1,'env-13m','robo',$2,'resposta muito antiga','enviado', now() - interval '13 months')`, [A, CLI])
  await db.query(`insert into whatsapp_eventos (restaurante_id, tipo, criado_em) values ($1,'webhook', now() - interval '13 months'), ($1,'webhook', now() - interval '91 days')`, [A])
  const { data: limp } = await admin.rpc('whatsapp_limpar_antigos')
  const m91 = await um(`select texto from whatsapp_mensagens where wa_id='VELHA-91D'`)
  ok('91 dias: a mensagem fica, sem o texto (anonimizada)', !!m91 && m91.texto === null)
  ok('13 meses: a mensagem sai', !(await um(`select 1 from whatsapp_mensagens where wa_id='VELHA-13M'`)))
  ok('91 dias: envio fica sem o conteúdo; 13 meses: sai', (await um(`select texto from whatsapp_envios where chave='env-91d'`)).texto.startsWith('[conteúdo removido') && !(await um(`select 1 from whatsapp_envios where chave='env-13m'`)))
  ok('eventos: 91 dias ficam, 13 meses saem', (await um(`select count(*)::int n from whatsapp_eventos where restaurante_id=$1 and criado_em < now() - interval '12 months'`, [A])).n === 0 && (await um(`select count(*)::int n from whatsapp_eventos where restaurante_id=$1 and criado_em < now() - interval '90 days'`, [A])).n >= 1)
  ok('recentes intactas', (await q(`select 1 from whatsapp_mensagens where restaurante_id=$1 and texto is not null`, [A])).length > 0 && limp?.anonimizadas?.mensagens >= 1, JSON.stringify(limp))

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
