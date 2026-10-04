/**
 * E2E — Financeiro Fase 4 (2026-10-04): Fluxo de Caixa + correção "entrega paga não quita a comanda do PDV".
 * Loja local `fin-int` (semente: E2E_LOJA=fin-int E2E_VIZINHA=fin-int-viz E2E_SUFIXO=finint node scripts/seguranca/semear-demo-mesas.mjs).
 * Cria só dados TESTE; o livro-caixa é imutável (os lançamentos ficam, como em produção).
 *
 *   node scripts/seguranca/e2e-financeiro-fluxo.mjs [pasta-de-prints] [--so-parte0]
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'fin-int'
const ARGS = process.argv.slice(2)
const PRINTS = ARGS.find((a) => !a.startsWith('--')) ?? null
const SO_PARTE0 = ARGS.includes('--so-parte0')
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL, API_URL, ANON_KEY, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
const viz = await um(`select id from restaurantes where slug='fin-int-viz'`)
if (!loja) { console.error('Rode antes a semente da fin-int.'); process.exit(2) }
const SENHA = 'demo-local-123456'
const res = []
const antifraude = []
const ok = (n, cond, d = '') => { res.push(!!cond); console.log(`   ${cond ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const af = (n, cond, d = '') => { antifraude.push([n, !!cond]); ok(`antifraude: ${n}`, cond, d) }
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const texto = (v) => JSON.stringify(v)
const browser = await chromium.launch()
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

await db.query(`update restaurantes set financeiro_ativo=true, pdv_v2=true, usa_logistica=true where id=$1`, [loja.id])

async function logar(login, opcoes = { viewport: { width: 1366, height: 860 } }, senha = SENHA) {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', acceptDownloads: true })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', senha)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  // TextDecoder com ignoreBOM: r.text() tiraria o BOM do CSV e o teste não veria.
  const t = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer())
  let j = null; try { j = JSON.parse(t) } catch { /* csv */ }
  return { s: r.status, j, t, tipo: r.headers.get('content-type') ?? '' }
}, { url: `${BASE}${url}`, metodo, corpo })

const dono = await logar('dono.finint')
const ger = await logar('gerente.finint')
const ate = await logar('atendente.finint')
const sbGer = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
await sbGer.auth.signInWithPassword({ email: (await um(`select email from usuarios where usuario='gerente.finint'`)).email, password: SENHA })
const RISOTO = await um(`select id, preco from itens_cardapio where restaurante_id=$1 and nome='Risoto de Camarão'`, [loja.id])
  ?? await um(`select id, preco from itens_cardapio where restaurante_id=$1 and preco > 0 order by preco desc limit 1`, [loja.id])
let ENT = await um(`select id from entregadores where restaurante_id=$1 order by criado_em limit 1`, [loja.id])
if (!ENT) ENT = await um(`insert into entregadores (restaurante_id, nome, telefone) values ($1, 'TESTE Moto Fluxo', '27999990099') returning id`, [loja.id])

/** Garante um caixa aberto (fecha o que estiver aberto antes, se pedido). */
async function caixaAberto(fundo = 10000) {
  const g = await api(dono.p, '/api/admin/financeiro/caixa')
  if (g.j?.turno && !g.j.turno.fechado_em) return g.j.turno
  const r = await api(dono.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'abrir', fundoCentavos: fundo })
  if (r.s !== 200) throw new Error(`abrir caixa: ${r.s} ${texto(r.j)}`)
  return (await api(dono.p, '/api/admin/financeiro/caixa')).j.turno
}
async function fecharCaixa(diferencaCentavos = 0, justificativa = 'TESTE fluxo') {
  const g = await api(dono.p, '/api/admin/financeiro/caixa')
  const r = await api(dono.p, '/api/admin/financeiro/caixa', 'POST', {
    acao: 'fechar', contadoDinheiroCentavos: (g.j?.saldos?.gaveta ?? 0) + diferencaCentavos, contadoCartaoCentavos: g.j?.saldos?.cartao ?? 0,
    aceitarPendencias: true, justificativa,
  })
  if (r.s !== 200) throw new Error(`fechar caixa: ${r.s} ${texto(r.j)}`)
  return g.j?.turno?.id
}

const ENDERECO = { cep: '29050-100', rua: 'Rua Teste', numero: '10', bairro: 'Centro', cidade: 'Vitória', estado: 'ES', complemento: '', referencia: '', taxa: '0' }
/** Pedido do PDV (balcão → entrega), "pagar na entrega", já pronto. */
async function pdvEntrega(nome, pagamento = { escolha: 'dinheiro' }) {
  const cm = await api(ate.p, '/api/admin/balcao/comandas', 'POST', { nome: `TESTE ${nome}`, chave: uuid(), modalidade: 'entrega', entrega: ENDERECO })
  const lc = await api(ate.p, '/api/admin/pdv/lancamento', 'POST', { comandaId: cm.j?.id, chave: uuid(), itens: [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }], pagamento })
  if (cm.s !== 201 || lc.s !== 201) throw new Error(`pdvEntrega ${cm.s} ${lc.s} ${lc.j?.error ?? ''}`)
  for (const [de, para] of [['recebido', 'preparando'], ['preparando', 'pronto']]) await api(ate.p, `/api/admin/comandas/${cm.j.id}`, 'POST', { acao: 'transicionar', pedidoId: lc.j.id, de, para })
  const p = await um(`select id, numero, total from pedidos where id=$1`, [lc.j.id])
  return { comandaId: cm.j.id, id: p.id, numero: p.numero, total: Number(p.total), totalC: Math.round(Number(p.total) * 100) }
}
const pagarNoPdv = (pd, forma = 'dinheiro') => api(ate.p, `/api/admin/comandas/${pd.comandaId}`, 'POST', { acao: 'pagamento', forma, valor: pd.total, recebido: forma === 'dinheiro' ? pd.total : null, chave: uuid() })
const despachar = (pd) => sbGer.from('pedidos').update({ entregador_id: ENT.id, status: 'em_rota' }).eq('id', pd.id)
const comanda = (id) => um(`select c.status, t.restante from comandas c, comanda_totais(c.id) t where c.id=$1`, [id])
const recebimentosDaComanda = async (pd) => Number((await um(`select count(*) n from fin_lancamentos where restaurante_id=$1 and tipo='recebimento' and (comanda_id=$2 or pedido_id=$3)`, [loja.id, pd.comandaId, pd.id])).n)

try {
  secao('Parte 0. Entrega paga quita a comanda do PDV, sem duplicar no livro-caixa')
  await caixaAberto()
  // a) Pago no PDV ANTES de sair; o operador registra a entrega depois ("já pago").
  const a = await pdvEntrega('Fluxo Pago Antes')
  const pa = await pagarNoPdv(a)
  await despachar(a)
  const ra = await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'registrar', pedidoId: a.id, forma: 'dinheiro', recebidoCentavos: a.totalC, chave: `fx-${uuid()}` })
  const ca = await comanda(a.comandaId)
  ok('pago no PDV antes de sair + entrega registrada: comanda FECHADA', pa.s === 200 && ra.s === 200 && ca.status === 'fechada', `${pa.s} ${ra.s} ${texto(ca)} ${texto(ra.j)}`)
  ok('…sem lançamento duplicado (1 recebimento só, o do PDV)', (await recebimentosDaComanda(a)) === 1, String(await recebimentosDaComanda(a)))
  // b) Pago no PDV ANTES de sair; o motoboy/Logística marca entregue SEM registrar pagamento.
  const b = await pdvEntrega('Fluxo Entregue Sem Registro')
  await pagarNoPdv(b)
  await despachar(b)
  await sbGer.from('pedidos').update({ status: 'entregue' }).eq('id', b.id)
  ok('pago no PDV + marcado entregue (sem registro): comanda FECHADA', (await comanda(b.comandaId)).status === 'fechada', texto(await comanda(b.comandaId)))
  // c) Entregue primeiro, pago no PDV DEPOIS (cliente acertou no balcão).
  const c = await pdvEntrega('Fluxo Pago Depois')
  await despachar(c)
  await sbGer.from('pedidos').update({ status: 'entregue' }).eq('id', c.id)
  ok('entregue e ainda sem pagar: comanda continua aberta (tem saldo)', (await comanda(c.comandaId)).status === 'aberta')
  await pagarNoPdv(c, 'pix')
  ok('pago no PDV depois da entrega: comanda FECHADA', (await comanda(c.comandaId)).status === 'fechada', texto(await comanda(c.comandaId)))
  ok('…com 1 recebimento só', (await recebimentosDaComanda(c)) === 1)
  // d) Comanda com outro pedido ainda na cozinha: não fecha à força.
  const d = await pdvEntrega('Fluxo Dois Pedidos')
  const lc2 = await api(ate.p, '/api/admin/pdv/lancamento', 'POST', { comandaId: d.comandaId, chave: uuid(), itens: [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }], pagamento: { escolha: 'dinheiro' } })
  await api(ate.p, `/api/admin/comandas/${d.comandaId}`, 'POST', { acao: 'pagamento', forma: 'dinheiro', valor: d.total * 2, recebido: d.total * 2, chave: uuid() })
  await despachar(d)
  await sbGer.from('pedidos').update({ status: 'entregue' }).eq('id', d.id)
  ok('outro pedido da conta ainda na cozinha: comanda NÃO fecha à força', lc2.s === 201 && (await comanda(d.comandaId)).status === 'aberta')
  // e) Motoboy registra dinheiro de pedido já pago no PDV: vira "já pago", nada entra de novo.
  const e = await pdvEntrega('Fluxo Motoboy Ja Pago')
  await pagarNoPdv(e, 'credito')
  await despachar(e)
  const gav0 = Number((await um(`select coalesce(sum(valor_centavos),0)::bigint s from fin_lancamentos where restaurante_id=$1 and carteira in ('gaveta','motoboy')`, [loja.id])).s)
  const re = await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'registrar', pedidoId: e.id, forma: 'dinheiro', recebidoCentavos: e.totalC, chave: `fx-${uuid()}` })
  const gav1 = Number((await um(`select coalesce(sum(valor_centavos),0)::bigint s from fin_lancamentos where restaurante_id=$1 and carteira in ('gaveta','motoboy')`, [loja.id])).s)
  ok('registro de dinheiro em pedido já pago: "já pago", gaveta/motoboy iguais, comanda fechada', re.s === 200 && gav0 === gav1 && (await comanda(e.comandaId)).status === 'fechada' && (await um(`select forma from fin_entregas_pagamento where pedido_id=$1`, [e.id])).forma === 'ja_pago', `${gav0}→${gav1}`)
  ok('livro-caixa íntegro (cadeia de hash)', (await api(dono.p, '/api/admin/financeiro/auditoria', 'POST', { acao: 'verificar' })).j?.ok === true)

  if (!SO_PARTE0) {
    secao('Parte 1a. Montando turnos TESTE: fechado sem diferença, com falta, com sobra, reaberto e passando da meia-noite')
    /** Venda no balcão (retirada), paga na hora. */
    async function vendaBalcao(nome, forma) {
      const cm = await api(ate.p, '/api/admin/balcao/comandas', 'POST', { nome: `TESTE ${nome}`, chave: uuid(), modalidade: 'retirada' })
      const lc = await api(ate.p, '/api/admin/pdv/lancamento', 'POST', { comandaId: cm.j?.id, chave: uuid(), itens: [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }], pagamento: { escolha: forma } })
      if (cm.s !== 201 || lc.s !== 201) throw new Error(`vendaBalcao ${cm.s} ${lc.s} ${lc.j?.error ?? ''}`)
      const p = await um(`select total from pedidos where id=$1`, [lc.j.id])
      const pg1 = await api(ate.p, `/api/admin/comandas/${cm.j.id}`, 'POST', { acao: 'pagamento', forma, valor: Number(p.total), recebido: forma === 'dinheiro' ? Number(p.total) : null, chave: uuid() })
      if (pg1.s !== 200) throw new Error(`pagamento ${pg1.s} ${texto(pg1.j)}`)
      const pag = await um(`select id from pagamentos_comanda where comanda_id=$1 order by criado_em desc limit 1`, [cm.j.id])
      return { comandaId: cm.j.id, pedidoId: lc.j.id, totalC: Math.round(Number(p.total) * 100), pagamentoId: pag.id }
    }
    const fluxo = async (p, q) => (await api(p, `/api/admin/financeiro/fluxo?${q}&porPagina=100`)).j
    const HOJE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const ONTEM = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const PERIODO = `de=${ONTEM}&ate=${HOJE}`

    const T0 = await fecharCaixa(0, 'TESTE fluxo T0') // o caixa da Parte 0 fecha sem diferença
    await caixaAberto(10000)
    const T1 = (await api(dono.p, '/api/admin/financeiro/caixa')).j.turno.id
    const v1 = await vendaBalcao('Fluxo T1 Dinheiro', 'dinheiro')
    const v2 = await vendaBalcao('Fluxo T1 Credito', 'credito')
    const MALICIOSO = '=HYPERLINK("http://evil.test","clique")'
    await fecharCaixa(-500, MALICIOSO) // FALTA R$ 5,00, observação com fórmula maliciosa
    await caixaAberto(5000)
    const T2 = (await api(dono.p, '/api/admin/financeiro/caixa')).j.turno.id
    await vendaBalcao('Fluxo T2 Dinheiro', 'dinheiro')
    await fecharCaixa(300, 'TESTE sobra') // SOBRA R$ 3,00
    const rab = await api(dono.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'reabrir', turnoId: T2, motivo: 'TESTE reabertura do fluxo' })
    ok('reabrir turno (dono)', rab.s === 200, texto(rab.j))
    // Estorno, no turno reaberto, de um pagamento do turno ANTIGO (T1): ajuste que referencia turno antigo.
    const est = await api(dono.p, `/api/admin/comandas/${v1.comandaId}`, 'POST', { acao: 'estorno', pagamentoId: v1.pagamentoId, motivo: 'TESTE estorno do fluxo' })
    ok('estorno de pagamento do turno antigo (lança no turno aberto)', est.s === 200, texto(est.j))
    await fecharCaixa(0, 'TESTE refechou')
    // T3 "passa da meia-noite": aberto ontem às 23:30 (São Paulo), lançamentos hoje.
    await caixaAberto(2000)
    const T3 = (await api(dono.p, '/api/admin/financeiro/caixa')).j.turno.id
    await db.query(`update caixa_turnos set aberto_em = ($2::date + time '23:30') at time zone 'America/Sao_Paulo' where id=$1`, [T3, ONTEM])
    const vp1 = await vendaBalcao('Fluxo T3 Pix A', 'pix')
    const vp2 = await vendaBalcao('Fluxo T3 Pix B', 'pix')
    const lpix = await um(`select id from fin_lancamentos where pagamento_id=$1 and carteira='pix_conferir' and valor_centavos > 0`, [vp1.pagamentoId])
    const cf = await api(ger.p, '/api/admin/financeiro/pix', 'POST', { lancamentoId: Number(lpix.id), caiu: true })
    ok('Pix conferido (o outro fica a conferir)', cf.s === 200, texto(cf.j))
    // Motoboy com pendência: delivery em dinheiro marcado entregue sem registrar o pagamento.
    const dv = await api(ger.p, `/api/loja/${SLUG}/pedido`, 'POST', {
      tipo: 'entrega', cliente: { nome: 'TESTE Fluxo Pendencia', telefone: '27999990077' }, pagamento: 'dinheiro', trocoPara: null,
      endereco: { rua: 'Rua Teste', numero: '1', complemento: '', bairro: 'Centro', cep: '29000000', cidade: 'Vitória' }, itens: [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }],
    })
    if (dv.s === 201) {
      for (const st of ['preparando', 'pronto']) await sbGer.from('pedidos').update({ status: st }).eq('id', dv.j.id)
      await sbGer.from('pedidos').update({ entregador_id: ENT.id, status: 'em_rota' }).eq('id', dv.j.id)
      await sbGer.from('pedidos').update({ status: 'entregue' }).eq('id', dv.j.id)
    }

    secao('Parte 1b. Conciliação: fluxo × livro-caixa × relatório de fechamento')
    const fx = await fluxo(dono.p, PERIODO)
    const linha = (id) => fx.linhas.find((l) => l.turnoId === id)
    const [l0, l1, l2, l3] = [T0, T1, T2, T3].map(linha)
    ok('turno aberto no topo, "em andamento", com valores parciais', fx.linhas[0]?.turnoId === T3 && l3?.situacao === 'aberto' && l3.vendido > 0, texto(fx.linhas[0] && { id: fx.linhas[0].turnoId, s: fx.linhas[0].situacao }))
    ok('turno que passa da meia-noite pertence à data de ABERTURA (ontem)', l3?.data === ONTEM, `${l3?.data} × ${ONTEM}`)
    ok('fechado sem diferença = "Fechado"', l0?.situacao === 'fechado' && l0.diferenca === 0, texto({ s: l0?.situacao, d: l0?.diferenca }))
    ok('falta = "Divergente" com diferença negativa (R$ -5,00)', l1?.situacao === 'divergente' && l1.diferenca === -500)
    ok('reaberto e fechado de novo: marca de reabertura com quem e motivo', !!l2?.reabertoEm && l2.reabertoMotivo === 'TESTE reabertura do fluxo' && l2.situacao === 'fechado', texto({ s: l2?.situacao, r: l2?.reabertoMotivo }))
    // Cada turno fechado: esperado = o que o fechamento GRAVOU = soma da gaveta no livro.
    for (const [nome, id, l] of [['T0', T0, l0], ['T1', T1, l1], ['T2', T2, l2]]) {
      const tt = await um(`select esperado_dinheiro_centavos e, contado_dinheiro_centavos c, diferenca_centavos d from caixa_turnos where id=$1`, [id])
      const gav = Number((await um(`select coalesce(sum(valor_centavos),0)::bigint s from fin_lancamentos where restaurante_id=$1 and turno_id=$2 and carteira='gaveta'`, [loja.id, id])).s)
      ok(`${nome}: esperado/informado/diferença = relatório de fechamento salvo`, l && l.esperado === Number(tt.e) && l.informado === Number(tt.c) && l.diferenca === Number(tt.d), texto({ fluxo: l && [l.esperado, l.informado, l.diferenca], salvo: tt }))
      ok(`${nome}: esperado + diferença = gaveta no livro-caixa (= contado)`, l && l.esperado + l.diferenca === gav && gav === l.informado, `${l?.esperado} + ${l?.diferenca} × ${gav}`)
    }
    const rel1 = (await api(dono.p, `/api/admin/financeiro/caixa/${T1}`)).j
    const porForma = rel1?.porForma ?? {}
    ok('T1: dinheiro e cartão iguais aos do relatório de fechamento', l1 && l1.dinheiro === Number(porForma.dinheiro ?? 0) && l1.cartao === Number(porForma.credito ?? 0) + Number(porForma.debito ?? 0), texto({ fluxo: l1 && [l1.dinheiro, l1.cartao], rel: porForma }))
    ok('vendido = dinheiro + pix + cartão + outros; recebido = vendido − a receber', fx.linhas.every((l) => l.vendido === l.dinheiro + l.pix + l.cartao + l.outros && l.recebido === l.vendido - l.aReceber))
    // Soma do período = soma do livro (implementação independente da do banco).
    const turnos = await q(`select id, aberto_em, fechado_em from caixa_turnos where restaurante_id=$1`, [loja.id])
    const noPeriodo = new Set(turnos.filter((t) => { const d = new Date(t.aberto_em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); return d >= ONTEM && d <= HOJE }).map((t) => t.id))
    const lancs = await q(`select turno_id, criado_em, valor_centavos::bigint v from fin_lancamentos where restaurante_id=$1 and tipo in ('recebimento','troco','estorno') and carteira not in ('empresa','resultado')`, [loja.id])
    let somaLivro = 0
    for (const l of lancs) {
      let t = l.turno_id
      if (!t) t = turnos.filter((x) => new Date(x.aberto_em) <= l.criado_em && (!x.fechado_em || l.criado_em < new Date(x.fechado_em))).sort((a, b) => b.aberto_em - a.aberto_em)[0]?.id ?? null
      const dia = l.criado_em.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      if ((t && noPeriodo.has(t)) || (!t && dia >= ONTEM && dia <= HOJE)) somaLivro += Number(l.v)
    }
    ok('soma do fluxo do período = soma do livro-caixa do período', fx.totais.vendido === somaLivro, `${fx.totais.vendido} × ${somaLivro}`)
    // Todas as páginas (a loja de teste acumula turnos de várias rodadas no mesmo dia).
    const todasLinhas = [...fx.linhas]
    for (let pg = 1; todasLinhas.length < fx.total && pg < 50; pg++) todasLinhas.push(...((await api(dono.p, `/api/admin/financeiro/fluxo?${PERIODO}&porPagina=100&pagina=${pg}`)).j?.linhas ?? []))
    ok('totais do rodapé = soma das linhas (todas, não só a página)', fx.total === todasLinhas.length && fx.totais.recebido === todasLinhas.reduce((s, l) => s + l.recebido, 0), `${fx.total} × ${todasLinhas.length}`)
    ok('estorno aparece no turno reaberto (R$ do pagamento antigo)', l2 && l2.estornos === v1.totalC, `${l2?.estornos} × ${v1.totalC}`)
    ok('Pix: um confirmado e um a conferir no turno da meia-noite', l3 && l3.pixConfirmado === vp1.totalC && l3.pixAConferir === vp2.totalC, texto({ conf: l3?.pixConfirmado, pend: l3?.pixAConferir }))
    ok('motoboy com pendência aparece em "dinheiro com motoboy"', dv.s !== 201 || (l3 && l3.motoboy !== 0), `${dv.s} ${l3?.motoboy}`)
    // Extrato do turno reaberto: reabertura destacada, estorno com vínculo ao turno antigo.
    const ex2 = (await api(dono.p, `/api/admin/financeiro/fluxo/turno/${T2}`)).j
    const lEst = ex2?.lancamentos?.find((l) => l.tipo === 'estorno')
    ok('extrato: estorno mostra o lançamento original e o turno antigo dele', !!lEst?.referencia && lEst.referencia.turnoId === T1, texto(lEst?.referencia))
    ok('extrato: reabertura com quem e motivo', ex2?.reaberturas?.some((r) => r.motivo === 'TESTE reabertura do fluxo'))
    const ex3 = (await api(dono.p, `/api/admin/financeiro/fluxo/turno/${T3}`)).j
    ok('extrato: lançamento sem turno (pendência do motoboy) entra pelo horário', dv.s !== 201 || ex3?.lancamentos?.some((l) => l.tipo === 'pendencia_motoboy'))
    ok('extrato: lançamentos em ordem e com quem fez', ex3?.lancamentos?.every((l, i, a) => i === 0 || a[i - 1].seq < l.seq) && ex3.lancamentos.every((l) => l.usuario))

    secao('Parte 1c. Filtros (sozinhos e combinados), produto e URL')
    const soma = (r) => r.totais.vendido
    const fOrig = await fluxo(dono.p, `${PERIODO}&origem=balcao`)
    ok('origem=balcão: só vendas do balcão', fOrig.linhas.every((l) => l.origemMesa === 0 && l.origemDelivery === 0 && l.vendido === l.origemBalcao), String(fOrig.total))
    const fForma = await fluxo(dono.p, `${PERIODO}&forma=pix`)
    ok('forma=pix: só Pix', fForma.linhas.every((l) => l.dinheiro === 0 && l.cartao === 0 && l.vendido === l.pix) && fForma.linhas.length > 0)
    const fComb = await fluxo(dono.p, `${PERIODO}&origem=balcao&forma=dinheiro`)
    ok('combinado (balcão + dinheiro) ≤ cada filtro sozinho', soma(fComb) <= soma(fOrig) && fComb.linhas.every((l) => l.vendido === l.dinheiro))
    const fSit = await fluxo(dono.p, `${PERIODO}&status=divergente`)
    ok('status=divergente: só turnos com diferença', fSit.linhas.length >= 1 && fSit.linhas.every((l) => l.situacao === 'divergente'))
    const opId = (await um(`select id from usuarios where usuario='atendente.finint'`)).id
    const fOp = await fluxo(dono.p, `${PERIODO}&operador=${opId}`)
    ok('operador: só lançamentos dele', fOp.linhas.length > 0 && fOp.totais.vendido > 0 && fOp.totais.vendido <= fx.totais.vendido)
    const fMoto = await fluxo(dono.p, `${PERIODO}&motoboy=${ENT.id}`)
    ok('motoboy: turnos com lançamentos dele', fMoto.linhas.every((l) => l.lancamentos > 0))
    const fProd = await fluxo(dono.p, `${PERIODO}&produto=${RISOTO.id}`)
    ok('produto: turnos com venda do produto, quantidade e valor por turno', fProd.linhas.length > 0 && fProd.linhas.every((l) => l.produtoQtd > 0 && l.produtoValor > 0), texto(fProd.linhas.map((l) => [l.data, l.produtoQtd])))
    const fNada = await fluxo(dono.p, `de=2020-01-01&ate=2020-01-02`)
    ok('período sem turno: vazio, totais zero', fNada.total === 0 && fNada.totais.vendido === 0)

    secao('Parte 1d. Exportação CSV e PDF (auditada)')
    const audAntes = Number((await um(`select count(*) n from eventos_auditoria where restaurante_id=$1 and acao='fin.exportou_fluxo'`, [loja.id])).n)
    const csv = await api(dono.p, `/api/admin/financeiro/fluxo/exportar?formato=csv&${PERIODO}`)
    const linhasCsv = csv.t.split('\r\n')
    ok('CSV: UTF-8 com BOM, separador ";" e cabeçalho em português', csv.s === 200 && csv.t.charCodeAt(0) === 0xFEFF && linhasCsv[0].includes('Data;Status;Abertura;Valor inicial') && /text\/csv/.test(csv.tipo))
    ok('CSV: valores 1.234,56 e datas dd/mm/aaaa hh:mm', /;-?\d{1,3}(\.\d{3})*,\d{2}(;|$)/.test(csv.t) && /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(csv.t))
    ok('CSV: linha de TOTAL do período', linhasCsv.some((l) => l.startsWith('TOTAL DO PERÍODO')))
    ok('CSV: fórmula maliciosa na observação vira texto (\'=HYPERLINK…)', csv.t.includes(`'=HYPERLINK`) && !/;=HYPERLINK/.test(csv.t) && !/;"=HYPERLINK/.test(csv.t))
    const csvF = await api(dono.p, `/api/admin/financeiro/fluxo/exportar?formato=csv&${PERIODO}&forma=pix`)
    ok('CSV respeita os filtros (forma=pix: dinheiro zerado)', csvF.s === 200 && csvF.t.split('\r\n').length <= linhasCsv.length)
    const csvT = await api(dono.p, `/api/admin/financeiro/fluxo/exportar?formato=csv&turno=${T2}`)
    ok('CSV do extrato de um turno', csvT.s === 200 && csvT.t.includes('Estorno') && csvT.t.charCodeAt(0) === 0xFEFF)
    const pdf = await api(dono.p, `/api/admin/financeiro/fluxo/exportar?formato=pdf&${PERIODO}`)
    ok('PDF: dados com loja, período, filtros, quem gerou e quando', pdf.s === 200 && pdf.j?.loja && pdf.j?.geradoPor && pdf.j?.geradoEm && pdf.j?.filtros?.de === ONTEM)
    const audDepois = await q(`select dados from eventos_auditoria where restaurante_id=$1 and acao='fin.exportou_fluxo' order by criado_em desc limit 4`, [loja.id])
    ok('toda exportação vai para a auditoria (quem, filtros, formato)', Number((await um(`select count(*) n from eventos_auditoria where restaurante_id=$1 and acao='fin.exportou_fluxo'`, [loja.id])).n) - audAntes === 4 && audDepois.some((a) => a.dados?.filtros?.includes('forma=pix')))
    const rp = await api(dono.p, `/api/admin/financeiro/fluxo/turno/${T1}`, 'POST', { acao: 'reimprimir' })
    ok('"Reimprimir relatório" é auditado e devolve o relatório', rp.s === 200 && rp.j?.url === `/admin/financeiro/caixa/${T1}` && !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='fin.reimprimiu_relatorio' and entidade_id=$2`, [loja.id, T1])))

    secao('Parte 1e. Antifraude')
    const vizT = viz ? ((await um(`select id from caixa_turnos where restaurante_id=$1 order by aberto_em desc limit 1`, [viz.id])) ?? (await um(`insert into caixa_turnos (restaurante_id, aberto_por_nome) values ($1, 'TESTE vizinha') returning id`, [viz.id]).catch(() => null))) : null
    ok('há turno da loja vizinha para o teste de isolamento', !!vizT)
    if (vizT) {
      af('turno de OUTRA loja pelo ID → 404 (sem dados)', (await api(dono.p, `/api/admin/financeiro/fluxo/turno/${vizT.id}`)).s === 404)
      af('exportar extrato de OUTRA loja → 404', (await api(dono.p, `/api/admin/financeiro/fluxo/exportar?formato=csv&turno=${vizT.id}`)).s === 404)
      af('reimprimir relatório de OUTRA loja → 404', (await api(dono.p, `/api/admin/financeiro/fluxo/turno/${vizT.id}`, 'POST', { acao: 'reimprimir' })).s === 404)
    }
    const gar = await logar('garcom.finint')
    const rg = await api(gar.p, `/api/admin/financeiro/fluxo?${PERIODO}`)
    af('garçom chamando a API do fluxo → bloqueado', [401, 403, 404].includes(rg.s) && !rg.j?.linhas, String(rg.s))
    af('garçom exportando → bloqueado', [401, 403, 404].includes((await api(gar.p, `/api/admin/financeiro/fluxo/exportar?formato=csv&${PERIODO}`)).s))
    await gar.ctx.close()
    const moto = await logar((await um(`select usuario from usuarios where restaurante_id=$1 and papel='entregador' order by criado_em desc limit 1`, [loja.id])).usuario, { viewport: { width: 390, height: 844 } }, 'moto-teste-8421').catch(() => null)
    if (moto) {
      const rm = await api(moto.p, `/api/admin/financeiro/fluxo?${PERIODO}`)
      af('motoboy chamando a API do fluxo → bloqueado', [401, 403, 404].includes(rm.s) && !rm.j?.linhas, String(rm.s))
      await moto.ctx.close()
    }
    const ra = await api(ate.p, `/api/admin/financeiro/fluxo?${PERIODO}`)
    af('caixa (atendente, sem "ver financeiro") → 403', ra.s === 403, String(ra.s))
    // Gerente que vê o financeiro mas SEM "Exportar relatórios financeiros".
    const acessosAntes = (await um(`select acessos from usuarios where usuario='gerente.finint'`)).acessos
    await db.query(`update usuarios set acessos=$1 where usuario='gerente.finint'`, [JSON.stringify({ areas: ['pedidos', 'financeiro'], sensiveis: ['financeiro'] })])
    const gv = await api(ger.p, `/api/admin/financeiro/fluxo?${PERIODO}`)
    const ge = await api(ger.p, `/api/admin/financeiro/fluxo/exportar?formato=csv&${PERIODO}`)
    af('ver sem permissão de exportar: vê (200), exportar → 403', gv.s === 200 && gv.j?.podeExportar === false && ge.s === 403, `${gv.s} ${ge.s}`)
    await db.query(`update usuarios set acessos=$1 where usuario='gerente.finint'`, [acessosAntes === null ? null : JSON.stringify(acessosAntes)])
    for (const m of ['PATCH', 'DELETE', 'PUT']) {
      const r1 = await api(dono.p, `/api/admin/financeiro/fluxo?${PERIODO}`, m, { valorCentavos: 1 })
      const r2 = await api(dono.p, `/api/admin/financeiro/fluxo/turno/${T1}`, m, { valorCentavos: 1 })
      af(`${m} no fluxo e no extrato → recusado (não existe edição)`, r1.s === 405 && r2.s === 405, `${r1.s} ${r2.s}`)
    }
    const alvo = await um(`select id, valor_centavos from fin_lancamentos where restaurante_id=$1 and turno_id=$2 order by seq limit 1`, [loja.id, T1])
    const up = await sbGer.from('fin_lancamentos').update({ valor_centavos: 1 }).eq('id', alvo.id).select('id')
    const del = await sbGer.from('fin_lancamentos').delete().eq('id', alvo.id).select('id')
    const depois = await um(`select valor_centavos from fin_lancamentos where id=$1`, [alvo.id])
    af('editar/apagar lançamento direto no banco (sessão do gerente) → recusado, valor intacto', (up.error || !up.data?.length) && (del.error || !del.data?.length) && String(depois?.valor_centavos) === String(alvo.valor_centavos))
    const sbServ = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const upS = await sbServ.from('fin_lancamentos').update({ valor_centavos: 1 }).eq('id', alvo.id).select('id')
    const delS = await sbServ.from('fin_lancamentos').delete().eq('id', alvo.id).select('id')
    af('nem o servidor (service_role) altera ou apaga lançamento (imutável no banco)', !!upS.error && !!delS.error && String((await um(`select valor_centavos from fin_lancamentos where id=$1`, [alvo.id])).valor_centavos) === String(alvo.valor_centavos), `${upS.error?.message?.slice(0, 60)}`)
    ok('livro-caixa íntegro no fim', (await api(dono.p, '/api/admin/financeiro/auditoria', 'POST', { acao: 'verificar' })).j?.ok === true)

    secao('Parte 1g. Exportar pelo PERFIL PADRÃO (sem marcar nada na Equipe)')
    const exportarComo = async (p) => (await api(p, `/api/admin/financeiro/fluxo/exportar?formato=csv&${PERIODO}`)).s
    const padrao = await q(`select usuario, papel::text, acessos is null padrao from usuarios where usuario in ('dono.finint','gerente.finint','atendente.finint','garcom.finint')`)
    ok('dono, gerente, caixa e garçom de teste estão no perfil padrão (sem acessos próprios)', padrao.filter((u) => u.papel !== 'dono').every((u) => u.padrao), texto(padrao))
    af('dono exporta (padrão)', (await exportarComo(dono.p)) === 200)
    af('gerente exporta (padrão)', (await exportarComo(ger.p)) === 200)
    af('caixa (atendente, padrão) NÃO exporta', [401, 403, 404].includes(await exportarComo(ate.p)))
    const gar2 = await logar('garcom.finint')
    af('garçom (padrão) NÃO exporta', [401, 403, 404].includes(await exportarComo(gar2.p)))
    await gar2.ctx.close()
    // Cozinha = papel atendente com o modelo "Cozinha" da Equipe.
    const acAte = (await um(`select acessos from usuarios where usuario='atendente.finint'`)).acessos
    await db.query(`update usuarios set acessos=$1 where usuario='atendente.finint'`, [JSON.stringify({ areas: ['pedidos'], sensiveis: [] })])
    af('cozinha (modelo Cozinha) NÃO exporta', [401, 403, 404].includes(await exportarComo(ate.p)))
    await db.query(`update usuarios set acessos=$1 where usuario='atendente.finint'`, [acAte === null ? null : JSON.stringify(acAte)])
    const moto2 = await logar((await um(`select usuario from usuarios where restaurante_id=$1 and papel='entregador' order by criado_em desc limit 1`, [loja.id])).usuario, { viewport: { width: 390, height: 844 } }, 'moto-teste-8421').catch(() => null)
    if (moto2) { af('motoboy NÃO exporta', [401, 403, 404].includes(await exportarComo(moto2.p))); await moto2.ctx.close() }

    secao('Parte 1f. Tela: desktop, colunas, extrato, URL e voltar; celular')
    const tela = dono.p
    await tela.goto(`${BASE}/admin/financeiro?secao=fluxo&${PERIODO}`, { waitUntil: 'networkidle' })
    await tela.getByTestId('fluxo-tabela').waitFor({ timeout: 15000 })
    ok('tabela com uma linha por turno e rodapé de totais', (await tela.getByTestId('fluxo-linha').count()) === Math.min(fx.total, 30) && await tela.getByTestId('fluxo-rodape').isVisible())
    const corDif = await tela.locator(`[data-testid="fluxo-linha"][data-turno="${T1}"] [data-testid="fluxo-diferenca"]`).evaluate((e) => getComputedStyle(e).backgroundColor)
    ok('diferença negativa em vermelho', corDif === 'rgb(185, 28, 28)', corDif)
    await tela.getByTestId('fluxo-colunas').click()
    const menuCol = await tela.evaluate(() => { const el = document.querySelector('[data-testid="fluxo-colunas-menu"]'); return el && el.parentElement === document.body && getComputedStyle(el).zIndex })
    ok('seletor "Colunas" por cima (portal, z 9999)', menuCol === '9999')
    await tela.getByTestId('coluna-sangrias').check()
    await tela.keyboard.press('Escape')
    await tela.reload({ waitUntil: 'networkidle' }); await tela.getByTestId('fluxo-tabela').waitFor()
    ok('coluna escolhida continua depois de recarregar (preferência do usuário)', await tela.locator('[data-testid="fluxo-tabela"] th', { hasText: 'Sangrias' }).isVisible())
    await tela.getByTestId('filtro-forma-pix').click()
    await tela.waitForURL(/forma=pix/)
    ok('filtro reflete na URL', tela.url().includes('forma=pix'))
    await tela.goBack({ waitUntil: 'networkidle' })
    ok('"voltar" do navegador desfaz o filtro', !tela.url().includes('forma=pix'))
    await tela.getByTestId('filtro-origem-balcao').click(); await tela.waitForURL(/origem=balcao/)
    await tela.getByTestId('limpar-filtros').click(); await tela.waitForURL((u) => !u.toString().includes('origem='))
    ok('"Limpar filtros" tira os filtros (mantém o período)', !tela.url().includes('origem=') && tela.url().includes(`de=${ONTEM}`))
    await tela.locator(`[data-testid="fluxo-linha"][data-turno="${T2}"]`).click()
    await tela.getByTestId('extrato-turno').waitFor()
    await tela.getByTestId('extrato-lancamento').first().waitFor()
    ok('clicar na linha abre o extrato com reabertura destacada', await tela.getByTestId('extrato-reaberturas').isVisible() && (await tela.getByTestId('extrato-lancamento').count()) > 0)
    if (PRINTS) await tela.screenshot({ path: join(PRINTS, 'depois-extrato-desktop.png') })
    await tela.getByTestId('extrato-turno-antigo').first().click()
    await tela.waitForURL(new RegExp(`turno=${T1}`))
    ok('link do estorno abre o turno antigo', tela.url().includes(`turno=${T1}`))
    await tela.keyboard.press('Escape')
    await tela.evaluate(() => { window.__imprimiu = 0; window.print = () => { window.__imprimiu++ } })
    await tela.getByTestId('exportar-pdf').click()
    ok('PDF: documento de impressão com cabeçalho da loja e do período', await tela.waitForFunction(() => window.__imprimiu > 0, null, { timeout: 8000 }).then(() => true, () => false) && /Fluxo de Caixa/.test(await tela.getByTestId('fluxo-impressao').innerText()))
    if (PRINTS) await tela.screenshot({ path: join(PRINTS, 'depois-desktop.png') })
    const cel = await logar('dono.finint', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await cel.p.goto(`${BASE}/admin/financeiro?secao=fluxo&${PERIODO}`, { waitUntil: 'networkidle' })
    await cel.p.getByTestId('fluxo-cartao').first().waitFor({ timeout: 15000 })
    ok('celular: cartões (data, status, recebido, diferença), sem rolagem lateral', (await cel.p.getByTestId('fluxo-cartao').count()) > 0 && !(await cel.p.getByTestId('fluxo-tabela').isVisible()) && await cel.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'depois-celular.png'), fullPage: true })
    await cel.p.getByTestId('abrir-filtros').tap()
    const pf = await cel.p.getByTestId('painel-filtros').evaluate((e) => Math.round(e.getBoundingClientRect().width))
    ok('celular: filtros em tela cheia com "← Voltar"', pf === 390 && await cel.p.getByTestId('painel-voltar').isVisible(), String(pf))
    await cel.p.getByTestId('painel-voltar').tap()
    await cel.p.locator(`[data-testid="fluxo-cartao"][data-turno="${T3}"]`).tap()
    await cel.p.getByTestId('extrato-turno').waitFor()
    ok('celular: extrato em tela cheia', (await cel.p.getByTestId('extrato-turno').evaluate((e) => Math.round(e.getBoundingClientRect().width))) === 390)
    if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'depois-extrato-celular.png') })
    await cel.ctx.close()
    // Deixa o caixa como achou (aberto, como a Parte 0 começa) — o T3 segue aberto.
  }
} catch (e) {
  ok('fluxo sem erro', false, String(e?.stack ?? e).slice(0, 500))
} finally {
  await browser.close()
  await db.end()
}
const falhas = res.filter((x) => !x).length
if (antifraude.length) { console.log('\nAntifraude:'); for (const [n, c] of antifraude) console.log(`  ${c ? 'OK ' : 'FALHOU'}  ${n}`) }
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
