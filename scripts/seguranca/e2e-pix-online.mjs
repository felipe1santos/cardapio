/**
 * E2E — Pix online (Mercado Pago SIMULADO), 2026-10-04. Plano: docs/pix-online/plano.md.
 * Servidor local com MP_PROVEDOR=simulado, MP_SIMULADO_ARQUIVO, MP_WEBHOOK_SECRET, PAGAMENTOS_CHAVE
 * (os mesmos aqui). Loja local `fin-int` (financeiro ligado; dono e gerente com PIN). Liga a flag só
 * nela e desliga no fim; apaga os pedidos e cobranças que cria.
 *
 *   MP_SIMULADO_ARQUIVO=… MP_WEBHOOK_SECRET=… CRON_SECRET=… node scripts/seguranca/e2e-pix-online.mjs
 */
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'fin-int'
const OUTRA = 'ordem-qr-e2e'
const SENHA = 'demo-local-123456'
const PIN = { dono: '615283', gerente: '482913' }
const ARQ = process.env.MP_SIMULADO_ARQUIVO
const SEGREDO = process.env.MP_WEBHOOK_SECRET
const CRON = process.env.CRON_SECRET
if (!ARQ || !SEGREDO || !CRON) { console.error('Defina MP_SIMULADO_ARQUIVO, MP_WEBHOOK_SECRET e CRON_SECRET (os do servidor).'); process.exit(2) }
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const todos = async (s, p = []) => (await db.query(s, p)).rows
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
const outra = await um(`select id from restaurantes where slug=$1`, [OUTRA])
if (!loja) { console.error('Loja fin-int ausente (rode as sementes do financeiro).'); process.exit(2) }
const item = await um(`select id from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 0 order by preco limit 1`, [loja.id])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const antifraude = []
const af = (ataque, esperado, passou) => { antifraude.push({ ataque, esperado, passou }); ok(`antifraude: ${ataque}`, passou, esperado) }
const ate = async (f, ms = 15000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await f()) return true; await new Promise((r) => setTimeout(r, 400)) } return false }

const sim = () => (existsSync(ARQ) ? JSON.parse(readFileSync(ARQ, 'utf8')) : { contas: {}, codigos: {}, pagamentos: {} })
const gravarSim = (e) => writeFileSync(ARQ, JSON.stringify(e, null, 1))
const mexerPagamento = (id, f) => { const e = sim(); f(e.pagamentos[id]); gravarSim(e) }

async function webhook(dataId, { requestId = randomUUID(), segredo = SEGREDO, ts = String(Date.now()) } = {}) {
  const manifesto = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`
  const v1 = createHmac('sha256', segredo).update(manifesto).digest('hex')
  const r = await fetch(`${BASE}/api/webhooks/mercadopago?data.id=${dataId}&type=payment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    body: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: String(dataId) } }),
  })
  return { status: r.status, j: await r.json().catch(() => null), requestId }
}
const cron = async () => { const r = await fetch(`${BASE}/api/cron/pix-online`, { method: 'POST', headers: { 'x-cron-secret': CRON } }); return { status: r.status, j: await r.json().catch(() => null) } }

const criados = []
async function pedidoPix(extra = {}, chave = randomUUID()) {
  const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'retirada', pagamento: 'pix', pixOnline: true, cliente: { nome: 'TESTE pix online', telefone: '11912340992' },
    itens: [{ itemId: item.id, quantidade: 1, complementos: [] }], endereco: {}, chavePedido: chave, ...extra,
  }) })
  const j = await r.json().catch(() => null)
  if (j?.id) criados.push(j.id)
  return { status: r.status, j, chave }
}
const pedido = (id) => um(`select status, pago, pagamento_online, total, cancelado_motivo from pedidos where id=$1`, [id])
const pagamento = (pedidoId) => um(`select * from pagamentos_online where pedido_id=$1 order by criado_em desc limit 1`, [pedidoId])
const lancamentos = (mp) => todos(`select linha, carteira, tipo, forma, origem, valor_centavos, turno_id from fin_lancamentos where restaurante_id=$1 and chave_idempotencia in ($2, $3) order by chave_idempotencia, linha`, [loja.id, `pixonline:${mp}`, `pixonline-devolucao:${mp}`])

const browser = await chromium.launch()
async function sessao(login) {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}

try {
  // Estado limpo: flag só nesta loja, sem conta conectada, MP simulado vazio.
  await db.query(`update restaurantes set pix_online_ativo = (id = $1), pix_online_validade_min = 15 where id = $1 or pix_online_ativo`, [loja.id])
  await db.query(`delete from pagamentos_contas where restaurante_id=$1`, [loja.id])
  gravarSim({ contas: {}, codigos: {}, pagamentos: {} })
  const gerente = await um(`select id from usuarios where restaurante_id=$1 and usuario='gerente.finint'`, [loja.id])
  const dono = await um(`select id from usuarios where restaurante_id=$1 and usuario='dono.finint'`, [loja.id])

  secao('conexão da conta (OAuth simulado)')
  const vit0 = await fetch(`${BASE}/api/loja/${SLUG}/pix-online`).then((r) => r.json())
  ok('sem conta conectada: vitrine NÃO oferece Pix online', vit0.ativo === false)
  const at = await sessao('atendente.finint')
  await at.p.goto(`${BASE}/api/integracoes/mercadopago/conectar`)
  // Sem a área Integrações o middleware leva o atendente à primeira tela dele; o que importa: nada conectado.
  ok('atendente não conecta conta de pagamentos (só o dono)', !(await um(`select 1 x from pagamentos_contas where restaurante_id=$1`, [loja.id])) && !at.p.url().includes('conectado'), at.p.url())
  await at.ctx.close()
  const d = await sessao('dono.finint')
  await d.p.goto(`${BASE}/api/integracoes/mercadopago/conectar`)
  await d.p.waitForURL((u) => u.search.includes('mercadopago='), { timeout: 20000 }).catch(() => {})
  ok('dono conecta: volta para Integrações com "conectado"', d.p.url().includes('mercadopago=conectado'), d.p.url())
  const conta = await um(`select * from pagamentos_contas where restaurante_id=$1`, [loja.id])
  ok('conta gravada como conectada, ambiente de teste', conta?.status === 'conectada' && conta.ambiente === 'teste')
  ok('tokens CIFRADOS no banco (nada de token em texto)', conta && !/SIM-ACCESS|SIM-REFRESH/.test(conta.access_token_cifrado + conta.refresh_token_cifrado) && conta.access_token_cifrado.startsWith('v1.'))
  const painel = await d.ctx.request.get(`${BASE}/api/admin/pix-online`).then((r) => r.text())
  af('ler o token pela API do painel', 'nunca devolvido (só "••••final")', !/SIM-ACCESS|SIM-REFRESH|cifrado|access_token/.test(painel) && painel.includes('"conectada":true'))
  const vit1 = await fetch(`${BASE}/api/loja/${SLUG}/pix-online`).then((r) => r.json())
  ok('conectada: vitrine oferece Pix online', vit1.ativo === true && vit1.validadeMin === 15)
  const vitOutra = outra ? await fetch(`${BASE}/api/loja/${OUTRA}/pix-online`).then((r) => r.json()) : { ativo: false }
  ok('loja SEM a flag: nada muda (Pix online indisponível)', vitOutra.ativo === false)

  secao('pedido com Pix online: espera o pagamento')
  const a = await pedidoPix()
  ok('pedido criado esperando o pagamento, com QR e copia e cola', a.status === 201 && a.j?.aguardandoPagamento === true && !!a.j.pix?.qrCode && !!a.j.pix?.qrCodeBase64, `${a.status} ${JSON.stringify(a.j).slice(0, 120)}`)
  const pa = await pedido(a.j.id)
  ok('no banco: aguardando_pagamento, NÃO pago, marcado como Pix online', pa.status === 'aguardando_pagamento' && pa.pago === false && pa.pagamento_online === true)
  const cobA = await pagamento(a.j.id)
  ok('cobrança pendente com o valor do pedido NO SERVIDOR', cobA.status === 'pendente' && Number(cobA.valor) === Number(pa.total))
  const elegiveis = await um(`select count(*)::int n from pedidos where id=$1 and status in ('recebido','preparando','pronto')`, [a.j.id])
  ok('não entra no Kanban/cozinha/impressão/alarme (status fora de recebido)', elegiveis.n === 0)
  const kanbanTxt = await d.ctx.request.get(`${BASE}/api/admin/pedidos/${a.j.id}/pagamento`).then((r) => r.status)
  const manual = await d.ctx.request.post(`${BASE}/api/admin/pedidos/${a.j.id}/pagamento`, { data: { pagamento: { escolha: 'pix' } } })
  af('confirmação manual ("marcar pago") sem a API', 'recusada (409): só o Mercado Pago confirma', manual.status() === 409)
  void kanbanTxt
  // trigger: ninguém além do servidor muda "aguardando" para pago
  let barrado = false
  try { await db.query(`begin; set local role authenticated; update pedidos set pago=true where id='${a.j.id}'; commit`) } catch { barrado = true; await db.query('rollback').catch(() => {}) }
  const aindaA = await pedido(a.j.id)
  af('marcar pago direto no banco (papel do painel)', 'barrado pelo gatilho/RLS', aindaA.pago === false)
  void barrado

  secao('clique duplo e valor do navegador')
  const b1 = await pedidoPix({}, 'chave-duplo-' + randomUUID())
  const b2 = await pedidoPix({}, b1.chave)
  ok('mesmo checkout repetido: o MESMO pedido e a MESMA cobrança', b1.j.id === b2.j.id && b1.j.pix?.pagamentoId === b2.j.pix?.pagamentoId)
  const nCob = await um(`select count(*)::int n from pagamentos_online where pedido_id=$1`, [b1.j.id])
  ok('uma cobrança só no banco', nCob.n === 1, String(nCob.n))
  const fraude = await pedidoPix({ total: 0.01, subtotal: 0.01, preco: 0.01 })
  const pf = fraude.j?.id ? await pedido(fraude.j.id) : null
  af('valor alterado no navegador (total: 0,01)', 'ignorado: cobrança = total calculado no servidor', pf && Number(fraude.j.pix?.valor) === Number(pf.total) && Number(pf.total) > 1)

  secao('webhook: assinatura, consulta na API, idempotência')
  const mpA = cobA.mp_payment_id
  const falso = await webhook(mpA, { segredo: 'segredo-errado' })
  af('webhook com assinatura falsa', 'recusado (401), nada muda', falso.status === 401 && (await pedido(a.j.id)).status === 'aguardando_pagamento')
  const velho = await webhook(mpA, { ts: String(Date.now() - 30 * 60_000) })
  af('webhook antigo reenviado (ts de 30 min atrás)', 'recusado (401)', velho.status === 401)
  const pend = await webhook(mpA)
  ok('webhook válido com o Pix ainda pendente: nada muda', pend.status === 200 && pend.j?.resultado === 'pendente' && (await pedido(a.j.id)).status === 'aguardando_pagamento', JSON.stringify(pend.j))
  mexerPagamento(mpA, (pg) => { pg.status = 'approved' })
  const w1 = await webhook(mpA)
  const depois = await pedido(a.j.id)
  ok('pago (conferido na API): pedido vira RECEBIDO e pago', w1.j?.resultado === 'confirmado' && depois.status === 'recebido' && depois.pago === true, JSON.stringify(w1.j))
  const lA = await lancamentos(mpA)
  const bruto = lA.find((l) => l.tipo === 'recebimento'), taxa = lA.find((l) => l.tipo === 'taxa')
  ok('livro-caixa: +bruto (recebimento, Pix online, origem online, carteira online)', bruto && bruto.carteira === 'online' && bruto.forma === 'pix_online' && bruto.origem === 'online' && Number(bruto.valor_centavos) === Math.round(Number(pa.total) * 100))
  ok('livro-caixa: −taxa do Mercado Pago (líquido bate)', taxa && Number(taxa.valor_centavos) < 0)
  const w2 = await webhook(mpA, { requestId: w1.requestId })
  ok('webhook repetido (mesmo request-id): ignorado', w2.j?.repetido === true)
  const w3 = await webhook(mpA)
  ok('outro aviso do mesmo pagamento: "já confirmado", sem lançar de novo', w3.j?.resultado === 'ja_confirmado' && (await lancamentos(mpA)).length === lA.length)
  const aud = await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='pix_online.pago' and entidade_id=$2`, [loja.id, a.j.id])
  ok('auditoria: pix_online.pago', aud.n === 1)

  secao('webhook perdido: a verificação periódica resolve')
  const c = await pedidoPix()
  const cobC = await pagamento(c.j.id)
  mexerPagamento(cobC.mp_payment_id, (pg) => { pg.status = 'approved' })
  const cr = await cron()
  ok('cron confirma o pagamento sem webhook', cr.status === 200 && (await pedido(c.j.id)).status === 'recebido', JSON.stringify(cr.j))

  secao('tela do cliente detecta sozinha')
  const e = await pedidoPix()
  const cobE = await pagamento(e.j.id)
  const t0 = await fetch(`${BASE}/api/loja/${SLUG}/pedido/${e.j.id}/pix`).then((r) => r.json())
  ok('tela do cliente: aguardando, com QR', t0.situacao === 'aguardando' && !!t0.qrCode)
  mexerPagamento(cobE.mp_payment_id, (pg) => { pg.status = 'approved' })
  await new Promise((r) => setTimeout(r, 5200))
  const t1 = await fetch(`${BASE}/api/loja/${SLUG}/pedido/${e.j.id}/pix`).then((r) => r.json())
  ok('tela do cliente: "pago" sem recarregar (consulta na API)', t1.situacao === 'pago' && t1.qrCode === null, JSON.stringify(t1))
  af('resposta da tela do cliente', 'sem token nem dado pessoal', !/SIM-ACCESS|telefone|cliente_nome|access/.test(JSON.stringify(t1)))

  secao('expirou sem pagar; pago depois de expirado')
  const x = await pedidoPix()
  const cobX = await pagamento(x.j.id)
  await db.query(`update pagamentos_online set expira_em = now() - interval '5 minutes' where id=$1`, [cobX.id])
  await cron()
  const px = await pedido(x.j.id)
  const cx = await pagamento(x.j.id)
  ok('expirou: pedido CANCELADO (Pix não pago no prazo)', px.status === 'cancelado' && px.cancelado_motivo === 'pix_expirado')
  ok('expirou: cobrança expirada e cancelada no Mercado Pago', cx.status === 'expirado' && sim().pagamentos[cobX.mp_payment_id].status === 'cancelled')
  mexerPagamento(cobX.mp_payment_id, (pg) => { pg.status = 'approved' })
  const wx = await webhook(cobX.mp_payment_id)
  const cx2 = await pagamento(x.j.id)
  ok('pago DEPOIS de expirado: fica "a devolver", pedido continua cancelado', wx.j?.resultado === 'a_devolver' && cx2.status === 'a_devolver' && (await pedido(x.j.id)).status === 'cancelado')
  const alerta = await um(`select gravidade from fin_alertas where restaurante_id=$1 and tipo='pix_online_a_devolver' order by criado_em desc limit 1`, [loja.id])
  ok('alerta GRAVE ao dono', alerta?.gravidade === 'grave')
  const lX = await lancamentos(cobX.mp_payment_id)
  ok('o dinheiro que entrou aparece no livro-caixa (a devolver)', lX.some((l) => l.tipo === 'recebimento'))
  const tx = await fetch(`${BASE}/api/loja/${SLUG}/pedido/${x.j.id}/pix`).then((r) => r.json())
  ok('tela do cliente: "recebemos depois do prazo"', tx.situacao === 'pago_apos_cancelado')

  secao('antifraude: valor e loja errados')
  const v = await pedidoPix()
  const cobV = await pagamento(v.j.id)
  mexerPagamento(cobV.mp_payment_id, (pg) => { pg.status = 'approved'; pg.valor = 0.5 })
  const wv = await webhook(cobV.mp_payment_id)
  af('pagamento com valor ≠ total do pedido', 'não confirma, alerta', wv.j?.resultado === 'divergente' && (await pedido(v.j.id)).status === 'aguardando_pagamento')
  const o = await pedidoPix()
  const cobO = await pagamento(o.j.id)
  mexerPagamento(cobO.mp_payment_id, (pg) => { pg.status = 'approved'; pg.userId = '7777' })
  const wo = await webhook(cobO.mp_payment_id)
  af('pagamento de OUTRA conta/loja (coletor diferente)', 'não confirma', wo.j?.resultado === 'divergente' && (await pedido(o.j.id)).status === 'aguardando_pagamento')
  const desconhecido = await webhook('123456789012')
  af('webhook de pagamento que não é nosso', 'ignorado, nada muda', desconhecido.status === 200 && desconhecido.j?.resultado === 'desconhecido')

  secao('devolução (estorno total) com PIN')
  const cobA2 = await pagamento(a.j.id)
  const semApr = await d.ctx.request.post(`${BASE}/api/admin/pix-online`, { data: { acao: 'devolver', pagamentoId: cobA2.id, motivo: 'cliente pediu', aprovacao: {} } })
  ok('sem aprovação: recusada', semApr.status() >= 400)
  const propria = await d.ctx.request.post(`${BASE}/api/admin/pix-online`, { data: { acao: 'devolver', pagamentoId: cobA2.id, motivo: 'cliente pediu', aprovacao: { aprovadorId: dono.id, pin: PIN.dono } } })
  ok('quem pede não aprova a própria devolução', propria.status() === 403, String(propria.status()))
  const errado = await d.ctx.request.post(`${BASE}/api/admin/pix-online`, { data: { acao: 'devolver', pagamentoId: cobA2.id, motivo: 'cliente pediu', aprovacao: { aprovadorId: gerente.id, pin: '000000' } } })
  ok('PIN errado: recusada', errado.status() === 403)
  const certo = await d.ctx.request.post(`${BASE}/api/admin/pix-online`, { data: { acao: 'devolver', pagamentoId: cobA2.id, motivo: 'cliente pediu', aprovacao: { aprovadorId: gerente.id, pin: PIN.gerente } } })
  const cobA3 = await pagamento(a.j.id)
  ok('gerente aprova com PIN: devolvido no Mercado Pago', certo.status() === 200 && cobA3.status === 'devolvido' && sim().pagamentos[mpA].status === 'refunded', String(certo.status()))
  const lA2 = await lancamentos(mpA)
  const est = lA2.find((l) => l.tipo === 'estorno')
  ok('livro-caixa: estorno negativo na carteira online', est && Number(est.valor_centavos) === -Math.round(Number(pa.total) * 100) && est.carteira === 'online')
  const audE = await um(`select dados from eventos_auditoria where restaurante_id=$1 and acao='pix_online.devolvido' order by criado_em desc limit 1`, [loja.id])
  ok('auditoria da devolução com quem aprovou', audE?.dados?.aprovado_por && audE?.dados?.motivo === 'cliente pediu')
  const deNovo = await d.ctx.request.post(`${BASE}/api/admin/pix-online`, { data: { acao: 'devolver', pagamentoId: cobA2.id, motivo: 'de novo', aprovacao: { aprovadorId: gerente.id, pin: PIN.gerente } } })
  ok('devolver duas vezes: recusado', deNovo.status() === 409)

  secao('turno: Pix com o caixa fechado é adotado pelo próximo turno')
  const turnoAberto = await um(`select id from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])
  ok('cenário: caixa fechado (nenhum turno aberto)', !turnoAberto)
  const tb = lA.find((l) => l.tipo === 'recebimento')
  ok('Pix confirmado com o caixa fechado entra SEM turno', tb && tb.turno_id === null)
  const novo = await um(`insert into caixa_turnos (restaurante_id, aberto_em, aberto_por_nome, status, valor_inicial_centavos) values ($1, now(), 'TESTE pix', 'aberto', 0) returning id`, [loja.id]).catch((err) => ({ erro: err.message }))
  if (novo?.id) {
    const fl = await todos(`select turno_id, origem_online, pix from public.fin_fluxo_turnos($1, (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)`, [loja.id])
    const doNovo = fl.find((r) => r.turno_id === novo.id)
    ok('fluxo de caixa: o turno que abriu depois adota o Pix online', doNovo && Number(doNovo.origem_online) > 0, JSON.stringify(doNovo ?? fl.map((r) => r.turno_id)))
    const fech = await d.ctx.request.get(`${BASE}/api/admin/financeiro/caixa`).then((r) => r.json()).catch(() => null)
    void fech
    await db.query(`update caixa_turnos set fechado_em = now(), status = 'fechado' where id=$1`, [novo.id]).catch(() => {})
  } else ok('abrir turno de teste', false, novo?.erro)

  secao('token: renovação e conta desconectada no meio')
  await db.query(`update pagamentos_contas set expira_em = now() + interval '2 days' where restaurante_id=$1`, [loja.id])
  const antesTok = (await um(`select access_token_cifrado from pagamentos_contas where restaurante_id=$1`, [loja.id])).access_token_cifrado
  const cr2 = await cron()
  const depoisTok = await um(`select access_token_cifrado, expira_em, renovado_em from pagamentos_contas where restaurante_id=$1`, [loja.id])
  // A renovação acontece na primeira chamada ao MP (consulta das pendentes) ou no laço de renovação.
  ok('token perto de vencer: renovado sozinho', cr2.status === 200 && depoisTok.access_token_cifrado !== antesTok && !!depoisTok.renovado_em && new Date(depoisTok.expira_em) > new Date(Date.now() + 100 * 86_400_000), JSON.stringify(cr2.j))
  const m = await pedidoPix()
  const cobM = await pagamento(m.j.id)
  const est2 = sim(); est2.falhas = { renovar: true }; for (const k of Object.keys(est2.contas)) est2.contas[k].expiraEm = new Date(Date.now() - 1000).toISOString(); gravarSim(est2)
  await db.query(`update pagamentos_contas set expira_em = now() - interval '1 minute' where restaurante_id=$1`, [loja.id])
  await cron()
  ok('conta caiu no meio: pedido NÃO é cancelado às cegas ("verificação pendente")', (await pagamento(m.j.id)).status === 'verificacao_pendente' && (await pedido(m.j.id)).status === 'aguardando_pagamento')
  ok('conta marcada para reconectar; vitrine para de oferecer', (await um(`select status from pagamentos_contas where restaurante_id=$1`, [loja.id])).status === 'erro' && (await fetch(`${BASE}/api/loja/${SLUG}/pix-online`).then((r) => r.json())).ativo === false)
  const est3 = sim(); est3.falhas = {}; est3.pagamentos[cobM.mp_payment_id].status = 'approved'; gravarSim(est3)
  await d.p.goto(`${BASE}/api/integracoes/mercadopago/conectar`)
  await d.p.waitForURL((u) => u.search.includes('mercadopago='), { timeout: 20000 }).catch(() => {})
  // a cobrança antiga foi criada com o token antigo: no simulado, a nova conta é da mesma pessoa (vendedor 9001)
  const e4 = sim(); e4.pagamentos[cobM.mp_payment_id].token = Object.keys(e4.contas).at(-1); gravarSim(e4)
  await cron()
  ok('reconectou: a verificação resolve o pedido que esperava', (await pedido(m.j.id)).status === 'recebido')

  await d.ctx.close()
} finally {
  await browser.close()
  console.log('\nTabela antifraude:')
  for (const l of antifraude) console.log(`   ${l.passou ? '✅' : '❌'} ${l.ataque} → ${l.esperado}`)
  if (criados.length) {
    await db.query(`delete from fin_lancamentos where pedido_id = any($1)`, [criados]).catch(() => {})
    await db.query(`delete from pagamentos_online where pedido_id = any($1)`, [criados]).catch(() => {})
    await db.query(`delete from pedido_itens where pedido_id = any($1)`, [criados]).catch(() => {})
    await db.query(`delete from pedidos where id = any($1)`, [criados]).catch((e) => console.log('   (limpeza pedidos)', e.message))
  }
  await db.query(`update restaurantes set pix_online_ativo=false where id=$1`, [loja.id]).catch(() => {})
  await db.query(`delete from caixa_turnos where restaurante_id=$1 and aberto_por_nome='TESTE pix'`, [loja.id]).catch(() => {})
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
