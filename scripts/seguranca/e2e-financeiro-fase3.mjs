/**
 * E2E — Financeiro Fase 3: MOTOBOY (app com login, pagamento na entrega, troco e acerto cego) — 0136.
 * Loja descartável `fin-int` (semear-demo-mesas E2E_LOJA=fin-int E2E_VIZINHA=fin-int-viz E2E_SUFIXO=finint).
 * Só caminhos reais (as rotas e telas de verdade). Nexta e "entrega sem entregador" são simulados no
 * banco (sem chamar o Nexta de verdade).
 *
 *   node scripts/seguranca/e2e-financeiro-fase3.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'fin-int'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL, API_URL, ANON_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
if (!loja) { console.error('Rode antes a semente da fin-int.'); process.exit(2) }
const SENHA = 'demo-local-123456'
const SENHA_MOTO = 'moto-teste-8421'
const res = []
const ok = (n, cond, d = '') => { res.push(!!cond); console.log(`   ${cond ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const texto = (v) => JSON.stringify(v)
const browser = await chromium.launch()
const foto = async (p, nome) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`) }) }
const RAND = Math.random().toString(36).slice(2, 7)

async function logar(login, senha = SENHA, opcoes = { viewport: { width: 1366, height: 860 } }) {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', senha)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
async function ir(p, url) { await p.goto(url, { waitUntil: 'networkidle' }); await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {}) }
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { s: r.status, j: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const semSessao = (url, metodo = 'GET', corpo) => fetch(`${BASE}${url}`, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const item = async (nome) => um(`select id, preco from itens_cardapio where restaurante_id=$1 and nome=$2`, [loja.id, nome])
const saldoMoto = async (id) => Number((await um(`select coalesce(sum(valor_centavos),0)::bigint s from fin_lancamentos where restaurante_id=$1 and carteira='motoboy' and entregador_id=$2`, [loja.id, id])).s)
const registro = (pedidoId) => um(`select * from fin_entregas_pagamento where pedido_id=$1`, [pedidoId])
const linhas = (pedidoId) => q(`select carteira, tipo, valor_centavos::bigint v, entregador_id, turno_id from fin_lancamentos where pedido_id=$1 order by seq`, [pedidoId])

let RISOTO
/** Pedido de entrega pela vitrine (caminho do cliente). */
async function delivery(nome, pagamento, trocoPara = null, itens = null) {
  const r = await semSessao(`/api/loja/${SLUG}/pedido`, 'POST', {
    tipo: 'entrega', cliente: { nome: `TESTE ${nome}`, telefone: '27999990031' }, pagamento, trocoPara,
    endereco: { rua: 'Rua Teste', numero: '31', complemento: '', bairro: 'Centro', cep: '29000000', cidade: 'Vitória' },
    itens: itens ?? [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }],
  })
  if (r.s !== 201) throw new Error(`delivery ${nome}: ${r.s} ${r.j?.error}`)
  const p = await um(`select id, numero, total from pedidos where id=$1`, [r.j.id])
  return { id: p.id, numero: p.numero, totalC: Math.round(Number(p.total) * 100) }
}
let sbGer
/** Logística (RLS do gerente, como a tela): aceita → pronto → despacha ao motoboy. */
async function despachar(pedidoId, entregadorId) {
  for (const st of ['preparando', 'pronto']) await sbGer.from('pedidos').update({ status: st }).eq('id', pedidoId)
  const d = await sbGer.from('pedidos').update({ entregador_id: entregadorId, status: 'em_rota' }).eq('id', pedidoId).select('id')
  if (d.error || d.data?.length !== 1) throw new Error(`despachar: ${d.error?.message}`)
}

let dono, ger, ate, motoA, motoB, motoIos
try {
  // ── preparação ───────────────────────────────────────────────────────────
  await db.query(`update restaurantes set financeiro_ativo=true, pdv_v2=true, usa_logistica=true, entrega_sem_entregador=false where id=$1`, [loja.id])
  await db.query(`update caixa_turnos set fechado_em=now(), status='fechado', fechado_por_nome='e2e (limpeza)' where restaurante_id=$1 and fechado_em is null`, [loja.id])
  await db.query(`insert into fin_config (restaurante_id) values ($1) on conflict do nothing`, [loja.id])
  await db.query(`update fin_config set troco_modo='pedido', troco_modo_proximo=null where restaurante_id=$1`, [loja.id])
  await db.query(`update usuarios set pin_hash=null, pin_falhas=0, pin_bloqueado_ate=null, acessos=null where restaurante_id=$1`, [loja.id])
  // Motoboys de rodadas anteriores saem do caminho (desativados); os desta rodada são novos.
  await db.query(`update entregadores set desativado_em=now(), status='offline' where restaurante_id=$1 and nome like 'TESTE Moto F3%'`, [loja.id])
  RISOTO = await item('Risoto de Funghi')
  dono = await logar('dono.finint'); ger = await logar('gerente.finint'); ate = await logar('atendente.finint')
  sbGer = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  await sbGer.auth.signInWithPassword({ email: 'gerente.finint@demo.local', password: SENHA })
  const mA = await um(`insert into entregadores (restaurante_id, nome, telefone, status) values ($1, 'TESTE Moto F3 A ' || $2, '27999990041', 'online') returning id, token`, [loja.id, RAND])
  const mB = await um(`insert into entregadores (restaurante_id, nome, telefone, status) values ($1, 'TESTE Moto F3 B ' || $2, '27999990042', 'online') returning id, token`, [loja.id, RAND])
  const ab = await api(ate.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'abrir', fundoCentavos: 20000 })
  ok('operador abre o caixa com R$ 200 de fundo', ab.s === 200, `${ab.s} ${ab.j?.error ?? ''}`)
  // Rodadas anteriores interrompidas podem ter deixado dinheiro com motoboys de teste: acerta/baixa
  // pelo caminho normal, para "ninguém com dinheiro" valer no teste da troca de modo.
  for (const m of (await api(dono.p, '/api/admin/financeiro/motoboys')).j?.motoboys ?? []) {
    if (!m.saldoCentavos) continue
    if (m.saldoCentavos > 0) await api(dono.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: m.entregadorId, contadoCentavos: m.saldoCentavos, chave: `limpa-${uuid()}` })
    else await api(dono.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'baixar', entregadorId: m.entregadorId, motivo: 'TESTE limpeza de rodada anterior', chave: `limpa-${uuid()}` })
  }

  secao('1. Login do motoboy: criado na Logística, entra no app (Android emulado)')
  const loginA = `motof3a${RAND}`, loginB = `motof3b${RAND}`
  const cA = await api(ger.p, `/api/admin/entregadores/${mA.id}`, 'POST', { acao: 'criar_login', usuario: loginA, senha: SENHA_MOTO })
  const cB = await api(ger.p, `/api/admin/entregadores/${mB.id}`, 'POST', { acao: 'criar_login', usuario: loginB, senha: SENHA_MOTO })
  ok('gerente cria o login dos dois motoboys', cA.s === 200 && cB.s === 200, `${cA.s} ${cA.j?.error ?? ''} ${cB.s}`)
  ok('❌ esperado: criar login duas vezes', (await api(ger.p, `/api/admin/entregadores/${mA.id}`, 'POST', { acao: 'criar_login', usuario: `x${loginA}`, senha: SENHA_MOTO })).s === 409)
  ok('❌ esperado: atendente (sem Equipe) criar login', (await api(ate.p, `/api/admin/entregadores/${mA.id}`, 'POST', { acao: 'criar_login', usuario: `y${loginA}`, senha: SENHA_MOTO })).s === 403)
  const usuA = await um(`select u.papel, u.cargo, e.usuario_id from entregadores e join usuarios u on u.id=e.usuario_id where e.id=$1`, [mA.id])
  ok('login ligado ao entregador, papel "entregador"', usuA?.papel === 'entregador', texto(usuA))
  motoA = await logar(loginA, SENHA_MOTO, { ...devices['Pixel 7'] })
  ok('Android: depois do login cai direto em /motoboy', new URL(motoA.p.url()).pathname === '/motoboy', motoA.p.url())
  await motoA.p.getByTestId('motoboy-app').waitFor({ timeout: 10000 }).catch(() => {})
  ok('app abre com o nome do motoboy', /TESTE Moto F3 A/.test(await motoA.p.getByTestId('motoboy-app').innerText().catch(() => '')))
  const man = await api(motoA.p, '/api/motoboy/manifest')
  ok('app instalável (manifest com start_url /motoboy)', man.s === 200 && man.j?.start_url?.startsWith('/motoboy'), texto(man.j?.start_url))
  await ir(motoA.p, `${BASE}/admin/pedidos`)
  ok('❌ esperado: motoboy abrir o painel (/admin)', !new URL(motoA.p.url()).pathname.startsWith('/admin/pedidos') || (await motoA.p.locator('text=Pedido Recebido').count()) === 0, motoA.p.url())
  ok('❌ esperado: motoboy ler pedidos pela API do painel', (await api(motoA.p, '/api/admin/caixa')).s >= 401)
  await ir(motoA.p, `${BASE}/motoboy`)

  secao('2. Troco POR PEDIDO: Logística mostra o troco, valor editável, sai da gaveta para o motoboy')
  const p1 = await delivery('F3 Dinheiro Troco', 'dinheiro', 100)
  await despachar(p1.id, mA.id)
  const trocoNec = 10000 - p1.totalC
  await ir(ger.p, `${BASE}/admin/logistica`)
  const linhaTroco = ger.p.getByTestId('troco-linha').filter({ hasText: `#${p1.numero}` })
  await linhaTroco.waitFor({ timeout: 15000 }).catch(() => {})
  ok('Logística: "Troco para levar" com o valor necessário', /precisa de/.test(await linhaTroco.innerText().catch(() => '')) && (await linhaTroco.innerText().catch(() => '')).includes((trocoNec / 100).toFixed(2).replace('.', ',')))
  ok('campo "Troco entregue" pré-preenchido', (await linhaTroco.getByTestId('troco-entregue').inputValue().catch(() => '')) === (trocoNec / 100).toFixed(2).replace('.', ','))
  await foto(ger.p, '01-logistica-troco-para-levar')
  const trocoEntregue = trocoNec + 500 // operador arredonda: deu R$ 5 a mais
  await linhaTroco.getByTestId('troco-entregue').fill((trocoEntregue / 100).toFixed(2).replace('.', ','))
  await linhaTroco.getByTestId('troco-confirmar').click()
  await ger.p.waitForTimeout(1500)
  const lt = await q(`select carteira, valor_centavos::bigint v, turno_id from fin_lancamentos where pedido_id=$1 and tipo='troco_motoboy' order by seq`, [p1.id])
  ok('livro-caixa: gaveta −troco, motoboy +troco (valor editado), no turno aberto', lt.length === 2 && Number(lt.find((l) => l.carteira === 'gaveta')?.v) === -trocoEntregue && Number(lt.find((l) => l.carteira === 'motoboy')?.v) === trocoEntregue && !!lt[0].turno_id, texto(lt))
  ok('linha some da lista depois de entregue o troco', (await api(ger.p, '/api/admin/caixa')).j?.financeiro?.trocos?.every((t) => t.pedidoId !== p1.id))
  const rep = await api(ger.p, '/api/admin/caixa', 'POST', { acao: 'troco', entregadorId: mA.id, pedidoId: p1.id, valorCentavos: trocoEntregue, chave: `ped-${p1.id}` })
  ok('clique repetido não duplica o troco (mesma chave)', rep.s === 200 && (await um(`select count(*)::int n from fin_lancamentos where pedido_id=$1 and tipo='troco_motoboy'`, [p1.id])).n === 2, texto(rep.j))
  // Operador de Logística sem "ver valores" (gerente com acessos próprios só de Logística/Financeiro).
  await db.query(`update usuarios set acessos=$2 where id=$1`, [(await um(`select id from usuarios where usuario='gerente.finint'`)).id, JSON.stringify({ areas: ['logistica', 'financeiro', 'pedidos'], sensiveis: ['acerto_motoboy'] })])
  const lgAte = await api(ger.p, '/api/admin/caixa')
  await db.query(`update usuarios set acessos=null where usuario='gerente.finint'`)
  ok('operador sem "ver valores": não vê o saldo dos motoboys', lgAte.j?.financeiro && lgAte.j.financeiro.motoboys.length === 0 && lgAte.j.financeiro.veValores === false, `${lgAte.s} ${texto(lgAte.j?.financeiro ?? lgAte.j)}`.slice(0, 200))
  const lgGer = await api(ger.p, '/api/admin/caixa')
  ok('gerente vê "Dinheiro com cada motoboy agora"', lgGer.j?.financeiro?.motoboys?.some((m) => m.entregadorId === mA.id && m.saldoCentavos === trocoEntregue), texto(lgGer.j?.financeiro?.motoboys))

  secao('3. App: card com troco em destaque, sair, entregar em DINHEIRO (troco calculado)')
  await ir(motoA.p, `${BASE}/motoboy`)
  const card1 = motoA.p.getByTestId(`motoboy-pedido-${p1.numero}`)
  await card1.waitFor({ timeout: 15000 }).catch(() => {})
  const txtCard = await card1.innerText().catch(() => '')
  ok('card: número, cliente, bairro, valor e forma', txtCard.includes(`${p1.numero}`) && /TESTE F3 Dinheiro Troco/.test(txtCard) && /Centro/.test(txtCard) && /dinheiro/i.test(txtCard), txtCard.slice(0, 160).replace(/\n/g, ' | '))
  ok('card: "Levar R$ X de troco" em destaque', (await card1.getByTestId('motoboy-levar-troco').innerText().catch(() => '')).includes((trocoNec / 100).toFixed(2).replace('.', ',')))
  ok('card: abrir rota no Maps e no Waze', (await card1.locator('a[href*="google.com/maps"], a[href*="maps.google"]').count()) > 0 && (await card1.locator('a[href*="waze"]').count()) > 0)
  ok('cabeçalho: "Dinheiro comigo" = troco que levou', (await motoA.p.getByTestId('motoboy-comigo').innerText().catch(() => '')).includes((trocoEntregue / 100).toFixed(2).replace('.', ',')))
  await foto(motoA.p, '02-app-android-card')
  await card1.getByTestId('motoboy-sai').click().catch(() => {})
  await motoA.p.waitForTimeout(1200)
  ok('"Saí para entrega" grava a hora', !!(await um(`select saiu_para_entrega_em from pedidos where id=$1`, [p1.id])).saiu_para_entrega_em)
  await card1.getByTestId('motoboy-entregue').click()
  await card1.getByTestId('motoboy-pag-dinheiro').click()
  await card1.getByTestId('motoboy-recebido').fill('100')
  ok('app mostra "Dar de troco"', (await card1.getByTestId('motoboy-troco-dar').innerText().catch(() => '')).includes((trocoNec / 100).toFixed(2).replace('.', ',')))
  await foto(motoA.p, '03-app-pagamento-dinheiro')
  await card1.getByTestId('motoboy-confirmar-pagamento').click()
  await motoA.p.waitForTimeout(2000)
  const r1 = await registro(p1.id)
  const ped1 = await um(`select status::text s, pago from pedidos where id=$1`, [p1.id])
  ok('registro: dinheiro, recebido 100, troco calculado pelo servidor', r1?.forma === 'dinheiro' && Number(r1.recebido_centavos) === 10000 && Number(r1.troco_dado_centavos) === trocoNec && r1.origem === 'motoboy' && Number(r1.total_centavos) === p1.totalC, texto(r1))
  ok('pedido entregue e pago', ped1.s === 'entregue' && ped1.pago === true, texto(ped1))
  ok('sem pendência automática (o registro manda)', !(await um(`select 1 from fin_lancamentos where pedido_id=$1 and tipo='pendencia_motoboy'`, [p1.id])))
  ok('"Dinheiro comigo" = troco levado + recebido − troco dado', (await saldoMoto(mA.id)) === trocoEntregue + 10000 - trocoNec, `${await saldoMoto(mA.id)}`)
  await ir(motoA.p, `${BASE}/motoboy`)
  ok('histórico do turno no app', /#\d+/.test(await motoA.p.getByTestId('motoboy-historico').innerText().catch(() => '')))
  await foto(motoA.p, '04-app-historico')

  secao('4. CARTÃO (NSU), PIX (a conferir) e NÃO PAGO (motivo) pela API do app')
  const p2 = await delivery('F3 Cartao', 'cartao'); await despachar(p2.id, mA.id)
  // Pix da vitrine já chega pago (online); aqui o cliente pediu em dinheiro e pagou com Pix na porta.
  const p3 = await delivery('F3 Pix', 'dinheiro'); await despachar(p3.id, mA.id)
  const p4 = await delivery('F3 Nao Pago', 'dinheiro'); await despachar(p4.id, mA.id)
  const e2 = await api(motoA.p, `/api/motoboy/pedidos/${p2.id}/entregar`, 'POST', { forma: 'cartao', nsu: '778899', chave: `app:${p2.id}`, totalCentavos: 1, valor: 1 })
  const l2 = await linhas(p2.id)
  ok('cartão: valor do pedido (o enviado pelo app é ignorado) + NSU', e2.s === 200 && Number((await registro(p2.id))?.total_centavos) === p2.totalC && (await registro(p2.id))?.nsu === '778899' && l2.some((l) => l.carteira === 'cartao' && Number(l.v) === p2.totalC), texto(l2))
  const e3 = await api(motoA.p, `/api/motoboy/pedidos/${p3.id}/entregar`, 'POST', { forma: 'pix', chave: `app:${p3.id}` })
  const pix3 = await um(`select id, valor_centavos::bigint v from fin_lancamentos where pedido_id=$1 and carteira='pix_conferir'`, [p3.id])
  ok('pix: vai "a conferir", pedido NÃO fica pago', e3.s === 200 && Number(pix3?.v) === p3.totalC && (await um(`select pago from pedidos where id=$1`, [p3.id])).pago === false)
  const e4sem = await api(motoA.p, `/api/motoboy/pedidos/${p4.id}/entregar`, 'POST', { forma: 'nao_pago', chave: `app:${p4.id}` })
  ok('❌ esperado: "não pagou" sem motivo', e4sem.s === 409 && e4sem.j?.codigo === 'motivo_obrigatorio', texto(e4sem))
  const e4 = await api(motoA.p, `/api/motoboy/pedidos/${p4.id}/entregar`, 'POST', { forma: 'nao_pago', motivo: 'Cliente disse que paga amanhã', chave: `app:${p4.id}-2` })
  const l4 = await linhas(p4.id)
  ok('não pago: vira "a receber", sem dinheiro com o motoboy', e4.s === 200 && l4.some((l) => l.carteira === 'a_receber' && Number(l.v) === p4.totalC) && !l4.some((l) => l.carteira === 'motoboy'), texto(l4))

  secao('5. Conferir Pix: só quem tem a permissão; motoboy não confirma')
  ok('❌ esperado: motoboy confirmar o Pix', (await api(motoA.p, '/api/admin/financeiro/pix', 'POST', { lancamentoId: Number(pix3.id), caiu: true })).s >= 401)
  ok('❌ esperado: atendente (sem "Conferir Pix") confirmar', (await api(ate.p, '/api/admin/financeiro/pix', 'POST', { lancamentoId: Number(pix3.id), caiu: true })).s === 403)
  await ir(ger.p, `${BASE}/admin/financeiro?secao=pix`)
  const lpx = ger.p.getByTestId('pix-linha').filter({ hasText: `#${p3.numero}` })
  await lpx.waitFor({ timeout: 10000 }).catch(() => {})
  await foto(ger.p, '05-conferir-pix')
  await lpx.getByTestId('pix-caiu').click().catch(() => {})
  await ger.p.waitForTimeout(1500)
  const lp3 = await linhas(p3.id)
  ok('gerente confirma: pix_conferir → empresa; pedido pago', lp3.some((l) => l.carteira === 'empresa' && Number(l.v) === p3.totalC) && (await um(`select pago from pedidos where id=$1`, [p3.id])).pago === true, texto(lp3))
  ok('confirmar de novo não duplica', (await api(ger.p, '/api/admin/financeiro/pix', 'POST', { lancamentoId: Number(pix3.id), caiu: true })).s !== 500 && (await q(`select 1 from fin_lancamentos where pedido_id=$1 and carteira='empresa'`, [p3.id])).length === 1)

  secao('6. Tentativas de fraude do motoboy')
  const p5 = await delivery('F3 Do Outro', 'dinheiro'); await despachar(p5.id, mA.id)
  motoB = await logar(loginB, SENHA_MOTO, { ...devices['Pixel 7'] })
  const appB = await api(motoB.p, '/api/motoboy')
  ok('motoboy B só vê as entregas dele', appB.s === 200 && !appB.j?.pedidos?.some((p) => p.id === p5.id), `${appB.s}`)
  const fraude1 = await api(motoB.p, `/api/motoboy/pedidos/${p5.id}/entregar`, 'POST', { forma: 'dinheiro', recebidoCentavos: p5.totalC, chave: `app:${p5.id}` })
  ok('❌ esperado: B marcar entregue o pedido de A', fraude1.s === 403 && fraude1.j?.codigo === 'pedido_de_outro', texto(fraude1))
  ok('❌ esperado: B dizer que saiu com o pedido de A', (await api(motoB.p, `/api/motoboy/pedidos/${p5.id}/saiu`, 'POST', {})).s === 404)
  ok('❌ esperado: B dizer que não conseguiu entregar o pedido de A', (await api(motoB.p, `/api/motoboy/pedidos/${p5.id}/problema`, 'POST', { motivo: 'teste fraude' })).s >= 400 && (await um(`select status::text s from pedidos where id=$1`, [p5.id])).s === 'em_rota')
  const menos = await api(motoA.p, `/api/motoboy/pedidos/${p5.id}/entregar`, 'POST', { forma: 'dinheiro', recebidoCentavos: p5.totalC - 1000, chave: `app:${p5.id}` })
  ok('❌ esperado: recebido menor que o total (baixar o valor)', menos.s === 409 && !(await registro(p5.id)), texto(menos))
  const okp5 = await api(motoA.p, `/api/motoboy/pedidos/${p5.id}/entregar`, 'POST', { forma: 'dinheiro', recebidoCentavos: p5.totalC, chave: `app:${p5.id}` })
  const dup = await api(motoA.p, `/api/motoboy/pedidos/${p5.id}/entregar`, 'POST', { forma: 'dinheiro', recebidoCentavos: p5.totalC, chave: `app:${p5.id}` })
  ok('mesma requisição repetida: idempotente, um registro só', okp5.s === 200 && dup.s === 200 && (dup.j?.idempotente ?? dup.j?.dados?.idempotente) === true && (await q(`select 1 from fin_lancamentos where pedido_id=$1 and tipo='recebimento'`, [p5.id])).length === 1, texto(dup.j))
  const troca = await api(motoA.p, `/api/motoboy/pedidos/${p5.id}/entregar`, 'POST', { forma: 'pix', chave: `outra-${p5.id}` })
  ok('❌ esperado: trocar a forma depois de registrar (dinheiro → pix)', troca.s === 409 && troca.j?.codigo === 'ja_registrado', texto(troca))
  ok('❌ esperado: "desmarcar" a entrega (não consegui depois de entregue)', (await api(motoA.p, `/api/motoboy/pedidos/${p5.id}/problema`, 'POST', { motivo: 'desfazer' })).s >= 400 && (await um(`select status::text s from pedidos where id=$1`, [p5.id])).s === 'entregue')
  // Direto no banco com o login do motoboy (RLS): nada passa.
  const sbMoto = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const lg = await sbMoto.auth.signInWithPassword({ email: (await um(`select email from auth.users where id=$1`, [usuA.usuario_id])).email, password: SENHA_MOTO })
  const u1 = await sbMoto.from('pedidos').update({ status: 'em_rota', pago: false }).eq('id', p5.id).select('id')
  ok('❌ esperado: motoboy alterar o pedido direto no banco (RLS)', !lg.error && (!!u1.error || (u1.data ?? []).length === 0) && (await um(`select status::text s from pedidos where id=$1`, [p5.id])).s === 'entregue', u1.error?.message ?? texto(u1.data))
  const i1 = await sbMoto.from('fin_entregas_pagamento').insert({ restaurante_id: loja.id, pedido_id: p4.id, forma: 'dinheiro', total_centavos: 1, origem: 'motoboy', chave_idempotencia: uuid() })
  ok('❌ esperado: motoboy gravar registro de pagamento direto', !!i1.error)
  const i2 = await sbMoto.from('fin_lancamentos').select('id').eq('restaurante_id', loja.id).limit(5)
  ok('❌ esperado: motoboy ler o livro-caixa', (i2.data ?? []).length === 0)
  const rpc = await sbMoto.rpc('entrega_registrar', { p_restaurante: loja.id, p_pedido: p4.id, p_entregador: mA.id, p_forma: 'dinheiro', p_recebido_centavos: 1, p_nsu: null, p_motivo: null, p_chave: uuid(), p_ator: null, p_ator_nome: 'x', p_origem: 'motoboy' })
  ok('❌ esperado: motoboy chamar a função do banco direto', !!rpc.error)
  const u2 = await sbMoto.from('fin_lancamentos').update({ valor_centavos: 0 }).eq('pedido_id', p1.id).select('id')
  ok('❌ esperado: alterar lançamento (imutável)', !!u2.error || (u2.data ?? []).length === 0)

  secao('7. "Não consegui entregar" com motivo')
  const p6 = await delivery('F3 Nao Entregue', 'pix'); await despachar(p6.id, mA.id)
  await ir(motoA.p, `${BASE}/motoboy`)
  const card6 = motoA.p.getByTestId(`motoboy-pedido-${p6.numero}`)
  await card6.waitFor({ timeout: 15000 }).catch(() => {})
  await card6.getByTestId('motoboy-nao-entreguei').click()
  await card6.getByTestId('motoboy-motivo').fill('Cliente não atendeu')
  await card6.getByTestId('motoboy-confirmar-nao-entreguei').click()
  await motoA.p.waitForTimeout(1500)
  const p6d = await um(`select status::text s, cancelado_observacao o from pedidos where id=$1`, [p6.id])
  ok('pedido volta como não entregue, com o motivo', p6d.s === 'cancelado' && p6d.o === 'Cliente não atendeu', texto(p6d))

  secao('8. Offline (iPhone emulado): guarda, reenvia ao voltar a conexão, sem duplicar')
  const p7 = await delivery('F3 Offline', 'cartao'); await despachar(p7.id, mA.id)
  await motoA.ctx.close(); motoA = null
  motoIos = await logar(loginA, SENHA_MOTO, { ...devices['iPhone 13'] })
  await ir(motoIos.p, `${BASE}/motoboy`)
  const card7 = motoIos.p.getByTestId(`motoboy-pedido-${p7.numero}`)
  await card7.waitFor({ timeout: 15000 }).catch(() => {})
  await foto(motoIos.p, '06-app-iphone')
  await motoIos.ctx.setOffline(true)
  await card7.getByTestId('motoboy-entregue').click()
  await card7.getByTestId('motoboy-pag-cartao').click()
  await card7.getByTestId('motoboy-confirmar-pagamento').click()
  await motoIos.p.waitForTimeout(1500)
  ok('sem internet: aviso + ação guardada na fila', /guardada/.test(await motoIos.p.getByTestId('motoboy-offline').innerText().catch(() => '')))
  ok('nada chegou ao servidor ainda', !(await registro(p7.id)))
  await foto(motoIos.p, '07-app-offline')
  await motoIos.ctx.setOffline(false)
  await motoIos.p.evaluate(() => window.dispatchEvent(new Event('online')))
  for (let i = 0; i < 20 && !(await registro(p7.id)); i++) await motoIos.p.waitForTimeout(500)
  ok('voltou a conexão: reenviado, entregue', !!(await registro(p7.id)) && (await um(`select status::text s from pedidos where id=$1`, [p7.id])).s === 'entregue')
  // Reenvio duplicado (rede instável): mesma chave da fila.
  const re7 = await api(motoIos.p, `/api/motoboy/pedidos/${p7.id}/entregar`, 'POST', { forma: 'cartao', chave: `app:${p7.id}` })
  ok('reenvio da fila não duplica (um lançamento só)', re7.s === 200 && (await q(`select 1 from fin_lancamentos where pedido_id=$1 and carteira='cartao'`, [p7.id])).length === 1, texto(re7.j))

  secao('9. Acerto CEGO: bate, falta, sobra; pendência; baixa pelo dono')
  const vistoAte = await api(ate.p, '/api/admin/financeiro/motoboys')
  const mAate = vistoAte.j?.motoboys?.find((m) => m.entregadorId === mA.id)
  ok('operador vê o motoboy mas NÃO o esperado', !!mAate && mAate.saldoCentavos === undefined && mAate.temDinheiro === true, texto(mAate))
  const esperadoA = await saldoMoto(mA.id)
  // Falta R$ 10 (pela tela, como o operador faz).
  await ir(ate.p, `${BASE}/admin/financeiro?secao=motoboys`)
  const linhaA = ate.p.getByTestId('motoboy-linha').filter({ hasText: `TESTE Moto F3 A ${RAND}` })
  await linhaA.waitFor({ timeout: 10000 }).catch(() => {})
  await foto(ate.p, '08-acerto-lista')
  await linhaA.getByTestId('mb-acertar').click()
  await ate.p.getByTestId('acerto-contado').fill(((esperadoA - 1000) / 100).toFixed(2).replace('.', ','))
  await foto(ate.p, '09-acerto-contagem-cega')
  ok('tela de contagem não mostra o esperado', !(await ate.p.getByTestId('janela-acerto').innerText().catch(() => '')).includes((esperadoA / 100).toFixed(2).replace('.', ',')))
  await ate.p.getByTestId('acerto-confirmar').click()
  await ate.p.getByTestId('acerto-resultado').waitFor({ timeout: 8000 }).catch(() => {})
  const resTxt = await ate.p.getByTestId('acerto-resultado').innerText().catch(() => '')
  await foto(ate.p, '10-acerto-faltou')
  ok('depois de contar revela: "Faltou R$ 10,00"', /Faltou R\$\s?10,00/.test(resTxt), resTxt.slice(0, 120))
  const turno = await um(`select id from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])
  const gav = await um(`select valor_centavos::bigint v, turno_id, usuario_nome from fin_lancamentos where restaurante_id=$1 and carteira='gaveta' and tipo='acerto_motoboy' and entregador_id=$2 order by seq desc limit 1`, [loja.id, mA.id])
  ok('entra na gaveta do turno de quem acertou (Atendente Demo)', Number(gav?.v) === esperadoA - 1000 && gav?.turno_id === turno.id && gav?.usuario_nome === 'Atendente Demo', texto(gav))
  ok('falta vira PENDÊNCIA do motoboy (R$ 10)', (await saldoMoto(mA.id)) === 1000, `${await saldoMoto(mA.id)}`)
  ok('alerta ao dono: acerto divergente', !!(await um(`select 1 from fin_alertas where restaurante_id=$1 and tipo='acerto_motoboy_divergente' and mensagem like '%TESTE Moto F3 A ' || $2 || '%'`, [loja.id, RAND])))
  // Pendência aparece no fechamento do caixa.
  const fch = await api(ate.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'fechar', contadoDinheiroCentavos: 0, contadoCartaoCentavos: 0 })
  ok('fechamento do caixa aponta a pendência do motoboy', fch.s === 409 && fch.j?.codigo === 'pendencias' && fch.j?.pendencias?.motoboys?.some((m) => m.entregadorId === mA.id), `${fch.s} ${fch.j?.codigo}`)
  // Novo acerto zera a pendência (motoboy trouxe os R$ 10).
  const ac2 = await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: mA.id, contadoCentavos: 1000, chave: `f3-${uuid()}` })
  ok('novo acerto quita a pendência (bateu)', ac2.s === 200 && ac2.j?.diferenca_centavos === 0 && (await saldoMoto(mA.id)) === 0, texto(ac2.j))
  // Sobra: B entrega um em dinheiro e devolve R$ 3 a mais.
  const p8 = await delivery('F3 Sobra', 'dinheiro'); await despachar(p8.id, mB.id)
  await api(motoB.p, `/api/motoboy/pedidos/${p8.id}/entregar`, 'POST', { forma: 'dinheiro', recebidoCentavos: p8.totalC, chave: `app:${p8.id}` })
  const ac3 = await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: mB.id, contadoCentavos: p8.totalC + 300, chave: `f3-${uuid()}` })
  ok('sobra: "sobrou R$ 3", crédito do motoboy (saldo −3)', ac3.s === 200 && ac3.j?.diferenca_centavos === 300 && (await saldoMoto(mB.id)) === -300, texto(ac3.j))
  ok('❌ esperado: gerente dar baixa (só o dono)', (await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'baixar', entregadorId: mB.id, motivo: 'Sobra do troco devolvida ao motoboy', chave: `f3-${uuid()}` })).s === 403)
  ok('❌ esperado: dono dar baixa sem motivo', (await api(dono.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'baixar', entregadorId: mB.id, motivo: 'ok', chave: `f3-${uuid()}` })).s === 400)
  const bx = await api(dono.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'baixar', entregadorId: mB.id, motivo: 'Sobra do troco devolvida ao motoboy', chave: `f3-${uuid()}` })
  ok('dono dá baixa com motivo: saldo zera, auditado', bx.s === 200 && (await saldoMoto(mB.id)) === 0 && !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='fin.baixa_pendencia_motoboy' order by criado_em desc limit 1`, [loja.id])), texto(bx.j))
  // Acerto por pedido (vários de uma vez, só alguns).
  const p9 = await delivery('F3 Parcial 1', 'dinheiro'); await despachar(p9.id, mB.id)
  const p10 = await delivery('F3 Parcial 2', 'dinheiro'); await despachar(p10.id, mB.id)
  for (const p of [p9, p10]) await api(motoB.p, `/api/motoboy/pedidos/${p.id}/entregar`, 'POST', { forma: 'dinheiro', recebidoCentavos: p.totalC, chave: `app:${p.id}` })
  const ac4 = await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: mB.id, contadoCentavos: p9.totalC, pedidoIds: [p9.id], chave: `f3-${uuid()}` })
  ok('acerto só de um pedido: o outro continua com ele', ac4.s === 200 && ac4.j?.diferenca_centavos === 0 && (await saldoMoto(mB.id)) === p10.totalC, texto(ac4.j))
  ok('❌ esperado: acertar pedido que não é dele', (await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: mB.id, contadoCentavos: 0, pedidoIds: [p1.id], chave: `f3-${uuid()}` })).s === 400)
  await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: mB.id, contadoCentavos: p10.totalC, chave: `f3-${uuid()}` })

  secao('10. FUNDO FIXO: troca de modo, fundo, aviso de troco e complemento')
  const md = await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'modo', modo: 'fundo', fundoPadraoCentavos: 5000 })
  ok('ninguém com dinheiro: modo fundo vale na hora', md.s === 200 && (await um(`select troco_modo from fin_config where restaurante_id=$1`, [loja.id])).troco_modo === 'fundo', texto(md.j))
  ok('❌ esperado: operador trocar o modo', (await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'modo', modo: 'pedido' })).s === 403)
  const fundo = await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'troco', entregadorId: mB.id, valorCentavos: 5000, motivo: 'fundo', chave: `fundo-${uuid()}` })
  ok('"Entregar fundo ao motoboy": R$ 50 da gaveta para ele', fundo.s === 200 && (await saldoMoto(mB.id)) === 5000)
  const p11 = await delivery('F3 Fundo', 'dinheiro', 150); await despachar(p11.id, mB.id)
  const nec11 = 15000 - p11.totalC
  const lf = await api(ger.p, '/api/admin/caixa')
  const t11 = lf.j?.financeiro?.trocos?.find((t) => t.pedidoId === p11.id)
  ok(`aviso: troco necessário ${(nec11 / 100).toFixed(2)} > fundo 50,00`, lf.j?.financeiro?.modo === 'fundo' && t11 && t11.cobre === false && t11.temCentavos === 5000, texto(t11))
  await ir(ger.p, `${BASE}/admin/logistica`)
  const lt11 = ger.p.getByTestId('troco-linha').filter({ hasText: `#${p11.numero}` })
  await lt11.waitFor({ timeout: 10000 }).catch(() => {})
  ok('Logística: "o motoboy tem cerca de R$ 50,00" + "Complementar troco"', /cerca de R\$\s?50,00/.test(await lt11.getByTestId('troco-falta').innerText().catch(() => '')))
  await foto(ger.p, '11-logistica-fundo-complementar')
  await lt11.getByTestId('troco-complementar').click()
  await ger.p.waitForTimeout(1500)
  ok('complemento: gaveta → motoboy com a diferença', (await saldoMoto(mB.id)) === 5000 + (nec11 - 5000), `${await saldoMoto(mB.id)}`)
  const mdp = await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'modo', modo: 'pedido' })
  ok('com motoboy na rua com dinheiro: troca de modo fica para o próximo caixa', mdp.s === 200 && (await um(`select troco_modo, troco_modo_proximo from fin_config where restaurante_id=$1`, [loja.id])).troco_modo_proximo === 'pedido', texto(mdp.j))
  await api(motoB.p, `/api/motoboy/pedidos/${p11.id}/entregar`, 'POST', { forma: 'dinheiro', recebidoCentavos: 15000, chave: `app:${p11.id}` })
  const esperadoFundo = await saldoMoto(mB.id)
  const acF = await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: mB.id, contadoCentavos: esperadoFundo, chave: `f3-${uuid()}` })
  ok('acerto único do turno (fundo + recebido − troco): bateu', acF.s === 200 && acF.j?.diferenca_centavos === 0 && (await saldoMoto(mB.id)) === 0, texto(acF.j))

  secao('11. Entrega SEM motoboy e NEXTA: registro pelo operador')
  const p12 = await delivery('F3 Sem Motoboy', 'dinheiro')
  for (const st of ['preparando', 'pronto']) await sbGer.from('pedidos').update({ status: st }).eq('id', p12.id)
  await db.query(`update pedidos set status='entregue', entregue_em=now() where id=$1`, [p12.id]) // "entrega sem entregador" (simulado)
  const p13 = await delivery('F3 Nexta', 'dinheiro')
  for (const st of ['preparando', 'pronto']) await sbGer.from('pedidos').update({ status: st }).eq('id', p13.id)
  await db.query(`insert into nexta_entregas (restaurante_id, pedido_id, status) values ($1, $2, 'DELIVERED')`, [loja.id, p13.id]) // webhook do Nexta (simulado)
  await db.query(`update pedidos set status='entregue', entregue_em=now() where id=$1`, [p13.id])
  const sr = await api(ate.p, '/api/admin/financeiro/motoboys')
  ok('entregas sem registro aparecem para o operador (Nexta marcada)', sr.j?.semRegistro?.some((s) => s.pedidoId === p12.id) && sr.j?.semRegistro?.find((s) => s.pedidoId === p13.id)?.nexta === true)
  await ir(ate.p, `${BASE}/admin/financeiro?secao=motoboys`)
  await foto(ate.p, '12-sem-registro-nexta')
  const r12 = await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'registrar', pedidoId: p12.id, forma: 'dinheiro', recebidoCentavos: p12.totalC, chave: `f3-${uuid()}` })
  const l12 = await linhas(p12.id)
  ok('sem motoboy, dinheiro: entra direto na gaveta do turno', r12.s === 200 && l12.some((l) => l.carteira === 'gaveta' && Number(l.v) === p12.totalC && l.turno_id === turno.id), texto(l12))
  const r13 = await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'registrar', pedidoId: p13.id, forma: 'dinheiro', recebidoCentavos: p13.totalC, chave: `f3-${uuid()}` })
  const nx = await api(ger.p, '/api/admin/financeiro/motoboys')
  const nx13 = nx.j?.nexta?.find((n) => n.pedidoId === p13.id)
  ok('Nexta em dinheiro: fica "a receber" do Nexta', r13.s === 200 && !!nx13 && nx13.valorCentavos === p13.totalC, texto(nx13))
  const rp = await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'repasse_nexta', lancamentoIds: [nx13?.id], chave: `f3-${uuid()}` })
  const nx2 = await api(ger.p, '/api/admin/financeiro/motoboys')
  ok('repasse do Nexta: sai do "a receber", entra na gaveta', rp.s === 200 && !nx2.j?.nexta?.some((n) => n.pedidoId === p13.id), texto(rp.j))
  ok('❌ esperado: registrar a mesma entrega duas vezes', (await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'registrar', pedidoId: p12.id, forma: 'pix', chave: `f3-${uuid()}` })).s === 409)

  secao('12. Entrega com o caixa FECHADO fica "a acertar"; acerto exige caixa aberto')
  const p14 = await delivery('F3 Caixa Fechado', 'dinheiro'); await despachar(p14.id, mB.id)
  const g = await api(dono.p, '/api/admin/financeiro/caixa')
  await api(dono.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'fechar', contadoDinheiroCentavos: g.j?.saldos?.gaveta ?? 0, contadoCartaoCentavos: g.j?.saldos?.cartao ?? 0, aceitarPendencias: true, justificativa: 'TESTE fase 3' })
  ok('caixa fechado', !(await um(`select 1 from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])))
  const e14 = await api(motoB.p, `/api/motoboy/pedidos/${p14.id}/entregar`, 'POST', { forma: 'dinheiro', recebidoCentavos: p14.totalC, chave: `app:${p14.id}` })
  ok('motoboy entrega com o caixa fechado: dinheiro fica com ele, sem turno', e14.s === 200 && (await saldoMoto(mB.id)) === p14.totalC && (await linhas(p14.id)).every((l) => l.turno_id === null), texto(await linhas(p14.id)))
  const acFechado = await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: mB.id, contadoCentavos: p14.totalC, chave: `f3-${uuid()}` })
  ok('❌ esperado: acerto com o caixa fechado', acFechado.s === 409 && acFechado.j?.codigo === 'caixa_fechado')
  ok('abrir o caixa aplica o modo pendente (pedido)', (await api(ate.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'abrir', fundoCentavos: 10000 })).s === 200 && (await um(`select troco_modo from fin_config where restaurante_id=$1`, [loja.id])).troco_modo === 'pedido')
  const acAberto = await api(ate.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: mB.id, contadoCentavos: p14.totalC, chave: `f3-${uuid()}` })
  ok('acerto no caixa novo, de quem acertou', acAberto.s === 200 && (await saldoMoto(mB.id)) === 0)

  secao('13. Link/QR revogável e login cortado')
  const tokenAntigo = (await um(`select token from entregadores where id=$1`, [mA.id])).token
  ok('link atual funciona', (await semSessao(`/api/entregador/${tokenAntigo}`)).s === 200)
  const nl = await api(ger.p, `/api/admin/entregadores/${mA.id}`, 'POST', { acao: 'novo_link' })
  ok('"Gerar link novo": o antigo para na hora', nl.s === 200 && (await semSessao(`/api/entregador/${tokenAntigo}`)).s === 404 && (await semSessao(`/api/entregador/${nl.j.token}`)).s === 200)
  ok('❌ esperado: ação pelo link antigo', (await semSessao(`/api/entregador/${tokenAntigo}/pedidos/${p5.id}/saiu`, 'POST', {})).s >= 401)
  await ir(ger.p, `${BASE}/admin/logistica`)
  await foto(ger.p, '13-logistica-painel')
  const ds = await api(ger.p, `/api/admin/entregadores/${mA.id}`, 'POST', { acao: 'desativar' })
  ok('desativar: link novo também para', ds.s === 200 && (await semSessao(`/api/entregador/${nl.j.token}`)).s === 404)
  const appDes = await api(motoIos.p, '/api/motoboy')
  ok('desativar: o app com login para (mesmo com a sessão aberta)', appDes.s === 401 || appDes.s === 403, `${appDes.s} ${appDes.j?.error ?? ''}`)
  ok('desativado não aparece para despachar', !(await api(ger.p, '/api/admin/caixa')).j?.financeiro?.motoboys?.some((m) => m.entregadorId === mA.id))
  await api(ger.p, `/api/admin/entregadores/${mA.id}`, 'POST', { acao: 'reativar' })
  // Bloqueio pela Equipe corta o login do motoboy B e o link dele.
  const usuB = (await um(`select usuario_id from entregadores where id=$1`, [mB.id])).usuario_id
  const tokB = (await um(`select token from entregadores where id=$1`, [mB.id])).token
  const bq = await api(dono.p, `/api/admin/equipe/${usuB}`, 'PATCH', { situacao: 'bloqueado' })
  const appBq = await api(motoB.p, '/api/motoboy'); const linkBq = await semSessao(`/api/entregador/${tokB}`)
  ok('Equipe: bloquear o motoboy corta o app e o link', bq.s === 200 && (appBq.s === 401 || appBq.s === 403) && linkBq.s === 404, `${bq.s} app ${appBq.s} link ${linkBq.s}`)
  const relog = await logar(loginB, SENHA_MOTO, { ...devices['Pixel 7'] })
  ok('❌ esperado: motoboy bloqueado entrar de novo', new URL(relog.p.url()).pathname !== '/motoboy', relog.p.url())
  await relog.ctx.close()
  await api(dono.p, `/api/admin/equipe/${usuB}`, 'PATCH', { situacao: 'ativo' })

  secao('14. Auditoria e loja sem financeiro')
  const aud = await q(`select distinct acao from eventos_auditoria where restaurante_id=$1 and (acao like 'fin.%' or acao like 'entrega%') and criado_em > now() - interval '1 hour'`, [loja.id])
  const acoes = aud.map((a) => a.acao)
  ok('auditoria registra troco, acerto, pix, entrega, link e login', ['fin.troco_motoboy', 'fin.acerto_motoboy', 'fin.pix_confirmado', 'fin.troco_modo', 'entrega.pagamento_registrado', 'entregador.novo_link', 'entregador.desativou', 'entregador.criou_login'].every((a) => acoes.includes(a)), texto(acoes))
  ok('livro-caixa íntegro (cadeia de hash)', (await api(dono.p, '/api/admin/financeiro/auditoria', 'POST', { acao: 'verificar' })).j?.ok === true)
  await db.query(`update restaurantes set financeiro_ativo=false where id=$1`, [loja.id])
  const semFin = await api(ger.p, '/api/admin/caixa')
  ok('sem financeiro: Logística sem o bloco novo', semFin.s === 200 && semFin.j?.financeiro === undefined)
  const p15 = await delivery('F3 Sem Fin', 'dinheiro'); await despachar(p15.id, mB.id)
  const tokB2 = (await um(`select token from entregadores where id=$1`, [mB.id])).token
  const e15 = await semSessao(`/api/entregador/${tokB2}/pedidos/${p15.id}/entregar`, 'POST', {})
  ok('sem financeiro: link entrega como antes (sem perguntar forma)', e15.s === 200 && (await um(`select status::text s from pedidos where id=$1`, [p15.id])).s === 'entregue' && !(await registro(p15.id)), texto(e15))
  ok('sem financeiro: acerto do Financeiro indisponível (404)', (await api(ger.p, '/api/admin/financeiro/motoboys')).s === 404)
} catch (err) {
  console.error('ERRO', err)
  res.push(false)
} finally {
  await db.query(`update restaurantes set financeiro_ativo=true where id=$1`, [loja.id]).catch(() => {})
  for (const s of [dono, ger, ate, motoA, motoB, motoIos]) await s?.ctx.close().catch(() => {})
  await browser.close()
  await db.end()
  const n = res.filter(Boolean).length
  console.log(`\n${n}/${res.length} verificações ok`)
  process.exit(n === res.length ? 0 : 1)
}
