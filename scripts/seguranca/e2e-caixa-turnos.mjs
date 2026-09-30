/**
 * E2E do turno de caixa (0114) — stack local, loja isolada cantina-pdv2.
 *
 * Semeia um entregador e entregas em dinheiro em horários escolhidos (inclusive depois
 * da meia-noite e em dois turnos no mesmo dia), cria turnos passados direto no banco e
 * confere pela API (/api/admin/caixa), logado de verdade:
 *   · pedido da madrugada vai para o turno que abriu na véspera;
 *   · dois turnos no mesmo dia, cada um com o seu; resumo do dia soma os dois;
 *   · acerto do entregador: esperado do servidor, zera depois de registrar;
 *   · fechar com dinheiro a acertar pede confirmação (409);
 *   · atendente não mexe no caixa (403).
 * Tudo o que cria é apagado no fim.
 *
 *   node scripts/seguranca/e2e-caixa-turnos.mjs          (servidor local em 127.0.0.1:3999)
 */
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const sp = (s) => new Date(`${s}-03:00`).toISOString()

const LOJA = (await um(`select id from restaurantes where slug='cantina-pdv2'`)).id
const ent = await um(`insert into entregadores (restaurante_id, nome) values ($1, 'QA Zé Turno') returning id`, [LOJA])
const pedidosCriados = []
async function entrega(entregueEm, total, troco = null, status = 'entregue') {
  const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, troco_para, entregador_id, canal, origem, entregue_em)
    values ($1,'entrega',$2,$3,$3,'QA turno','5511912340990','dinheiro',$4,$5,'delivery','cardapio',case when $6 = 'agora' then now() else $6::timestamptz end) returning id`, [LOJA, status, total, troco, ent.id, entregueEm])
  pedidosCriados.push(p.id)
}

const browser = await chromium.launch()
async function logar(email) {
  const ctx = await browser.newContext({ locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', email)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  return (url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
    return { s: r.status, j: await r.json().catch(() => null) }
  }, { url: `${BASE}${url}`, metodo, corpo })
}

try {
  await db.query(`update caixa_turnos set fechado_em = now() where restaurante_id=$1 and fechado_em is null`, [LOJA])
  const api = await logar('dono.pdv2@local.test')

  console.log('\n── turnos passados (dia 2026-09-20) ──')
  const almoco = await um(`insert into caixa_turnos (restaurante_id, aberto_em, fechado_em) values ($1,$2,$3) returning id`, [LOJA, sp('2026-09-20T11:00'), sp('2026-09-20T15:00')])
  const noite = await um(`insert into caixa_turnos (restaurante_id, aberto_em, fechado_em) values ($1,$2,$3) returning id`, [LOJA, sp('2026-09-20T18:00'), sp('2026-09-21T02:00')])
  await entrega(sp('2026-09-20T12:00'), 40, 50)
  await entrega(sp('2026-09-20T14:30'), 10)
  await entrega(sp('2026-09-20T20:00'), 50)
  await entrega(sp('2026-09-21T01:30'), 20) // madrugada
  await entrega(sp('2026-09-20T16:00'), 7) // caixa fechado
  await db.query(`insert into fechamentos_caixa (restaurante_id, entregador_id, turno_id, valor_esperado, valor_declarado, diferenca, fechado_em) values
    ($1,$2,$3,50,48,-2,$4), ($1,$2,$5,70,70,0,$6)`, [LOJA, ent.id, almoco.id, sp('2026-09-20T15:00'), noite.id, sp('2026-09-21T02:00')])
  const d20 = await api('/api/admin/caixa?dia=2026-09-20')
  const r20 = d20.j?.resumoDia
  const tAlmoco = r20?.turnos.find((t) => t.turnoId === almoco.id)
  const tNoite = r20?.turnos.find((t) => t.turnoId === noite.id)
  ok('dois turnos no mesmo dia, cada um com as suas entregas', tAlmoco?.dinheiroEsperado === 50 && tNoite?.dinheiroEsperado === 70, `almoço ${tAlmoco?.dinheiroEsperado} / noite ${tNoite?.dinheiroEsperado}`)
  ok('entrega da 01:30 conta no turno que abriu às 18h da véspera', tNoite?.entregasEmDinheiro === 2)
  ok('resumo do dia soma os turnos (esperado 120, declarado 118, diferença −2)', r20?.dinheiroEsperado === 120 && r20?.dinheiroDeclarado === 118 && r20?.diferenca === -2, JSON.stringify({ e: r20?.dinheiroEsperado, d: r20?.dinheiroDeclarado, dif: r20?.diferenca }))
  ok('entrega com o caixa fechado aparece como "fora de turno"', r20?.foraDeTurno === 1)
  const d21 = await api('/api/admin/caixa?dia=2026-09-21')
  ok('o dia seguinte não recebe o turno da noite anterior', (d21.j?.resumoDia?.turnos ?? []).length === 0)

  console.log('\n── turno de hoje: abrir, acertar, fechar ──')
  const semTurno = await api('/api/admin/caixa', 'POST', { acao: 'acertar', entregadorId: ent.id, valorDeclarado: 10 })
  ok('sem turno aberto não há acerto', semTurno.s === 409)
  const abriu = await api('/api/admin/caixa', 'POST', { acao: 'abrir' })
  const abriuDeNovo = await api('/api/admin/caixa', 'POST', { acao: 'abrir' })
  ok('abre o turno; um segundo aberto ao mesmo tempo é recusado', abriu.s === 200 && abriuDeNovo.s === 409)
  const agora = 'agora' // relógio do banco: depois da abertura do turno
  await entrega(agora, 30, 100)
  await entrega(agora, 25)
  await entrega(null, 12, null, 'em_rota')
  const p1 = await api('/api/admin/caixa')
  const ze = p1.j?.acerto?.find((l) => l.entregadorId === ent.id)
  ok('acerto do turno: esperado 55, troco levado 70 (100 − 30), 1 em rota', ze?.valorEsperado === 55 && ze?.trocoLevado === 70 && ze?.pedidos === 2 && ze?.emRota === 1, JSON.stringify(ze))
  const fecharCedo = await api('/api/admin/caixa', 'POST', { acao: 'fechar' })
  ok('fechar com dinheiro a acertar pede confirmação (409 com o entregador)', fecharCedo.s === 409 && fecharCedo.j?.pendentes?.some((l) => l.entregadorId === ent.id))
  const acertou = await api('/api/admin/caixa', 'POST', { acao: 'acertar', entregadorId: ent.id, valorDeclarado: 50, valorEsperado: 1 })
  const fech = await um(`select valor_esperado, valor_declarado, diferenca, pedidos from fechamentos_caixa where entregador_id=$1 and turno_id=$2`, [ent.id, abriu.j?.turno?.id])
  ok('acerto grava o esperado do SERVIDOR (ignora o da tela) e a diferença', acertou.s === 200 && Number(fech?.valor_esperado) === 55 && Number(fech?.diferenca) === -5 && fech?.pedidos === 2, JSON.stringify(fech))
  const p2 = await api('/api/admin/caixa')
  ok('depois do acerto o esperado zera (só o que está em rota continua listado)', (p2.j?.acerto ?? []).filter((l) => l.entregadorId === ent.id && l.pedidos > 0).length === 0)
  const fechou = await api('/api/admin/caixa', 'POST', { acao: 'fechar' })
  ok('fecha o turno quando não há o que acertar', fechou.s === 200 && (await api('/api/admin/caixa')).j?.turnoAberto === null)

  console.log('\n── permissão ──')
  const atendente = await logar('atendente.pdv2@demo.local')
  const negado = await atendente('/api/admin/caixa')
  const negadoPost = await atendente('/api/admin/caixa', 'POST', { acao: 'abrir' })
  ok('atendente não lê nem abre o caixa (403)', negado.s === 403 && negadoPost.s === 403, `${negado.s}/${negadoPost.s}`)
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await db.query(`delete from fechamentos_caixa where entregador_id=$1`, [ent.id])
  if (pedidosCriados.length) await db.query(`delete from pedidos where id = any($1)`, [pedidosCriados])
  await db.query(`delete from caixa_turnos where restaurante_id=$1`, [LOJA])
  await db.query(`delete from entregadores where id=$1`, [ent.id])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
