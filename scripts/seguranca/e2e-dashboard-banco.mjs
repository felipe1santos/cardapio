/**
 * E2E — o Dashboard bate com o banco? (2026-10-03)
 * Loja local `fin-int` (tem pedidos da vitrine, do PDV/balcão e de mesa). Abre o Dashboard como
 * o dono (padrão: últimos 30 dias, fuso de São Paulo) e compara cada número com SQL direto:
 *   · Faturamento = soma de TODOS os canais (sem cancelados) + rodapé por origem — fora os pedidos de TESTE
 *     (item 54: cliente/observação/bairro com "teste" ou o telefone de teste; só a loja `menuzia` os mantém);
 *   · funil da vitrine = visitantes únicos por etapa (só eventos da vitrine);
 *   · rótulos novos do tempo de entrega.
 *
 *   node scripts/seguranca/e2e-dashboard-banco.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const q = async (s, p = []) => (await db.query(s, p)).rows
const SLUG = process.env.DASH_LOJA ?? 'fin-int'
const LOGIN = process.env.DASH_LOGIN ?? 'dono.finint'
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
if (!loja) { console.error('Rode antes a semente da fin-int.'); process.exit(2) }
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ')
const limpa = (s) => (s ?? '').replace(/ /g, ' ')

// Janela "últimos 30 dias" no fuso de São Paulo (mesma regra de intervaloDoPreset).
const JANELA = `(date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '29 days') at time zone 'America/Sao_Paulo'`
const FIM = `(date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo'`

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', LOGIN)
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
  await p.getByTestId('indicador-Faturamento').waitFor({ timeout: 20000 })
  await p.getByTestId('funil-visita').waitFor({ timeout: 20000 })
  await p.waitForTimeout(1500)
  if (PRINTS) await p.screenshot({ path: join(PRINTS, `dashboard-${SLUG}.png`), fullPage: true })

  // Mesma regra de lib/dashboard-limpeza.ts (ehPedidoDeTeste), aplicada aqui por fora para conferir a tela.
  const PALAVRA_TESTE = /(^|[^a-zà-ú])test(e|es)?([^a-zà-ú]|$)/i
  const ehTeste = (r) => [r.cliente_nome, r.observacao, r.endereco_bairro].some((t) => !!t && PALAVRA_TESTE.test(t)) || (() => { const t = (r.cliente_telefone ?? '').replace(/D/g, ''); return t.length >= 10 && t.endsWith('27992534407') })()
  const linhasVenda = await q(`select case when canal='mesa' then 'mesa' when canal='balcao' or origem='pdv' then 'pdv' else 'vitrine' end o, total, cliente_nome, observacao, endereco_bairro, cliente_telefone
    from pedidos where restaurante_id=$1 and status <> 'cancelado' and criado_em >= ${JANELA} and criado_em < ${FIM}`, [loja.id])
  const contam = SLUG === 'menuzia' ? linhasVenda : linhasVenda.filter((r) => !ehTeste(r))
  console.log(`   (pedidos no período: ${linhasVenda.length}; de TESTE fora: ${linhasVenda.length - contam.length})`)
  const vendas = Object.values(contam.reduce((a, r) => { (a[r.o] ??= { o: r.o, receita: 0, n: 0 }).receita += Number(r.total); a[r.o].n++; return a }, {}))
  const por = Object.fromEntries(vendas.map((v) => [v.o, { receita: Number(v.receita), n: Number(v.n) }]))
  const totalBanco = vendas.reduce((s, v) => s + Number(v.receita), 0)
  const fat = limpa(await p.getByTestId('indicador-Faturamento').innerText())
  ok(`Faturamento = soma de todos os canais no banco (${brl(totalBanco)})`, fat.includes(brl(totalBanco)), fat.replace(/\n/g, ' | '))
  const esperado = [por.vitrine && `Vitrine ${brl(por.vitrine.receita)} (${por.vitrine.n})`, por.pdv && `PDV/balcão ${brl(por.pdv.receita)} (${por.pdv.n})`, por.mesa && `Mesas ${brl(por.mesa.receita)} (${por.mesa.n})`].filter(Boolean)
  ok('rodapé do Faturamento separa vitrine, PDV/balcão e mesas como o banco', (esperado.length ? esperado.every((t) => fat.includes(t)) : !/Vitrine|PDV|Mesas/.test(fat)), `${esperado.join(' · ')} | tela: ${fat.split('\n').pop()}`)

  const funilBanco = Object.fromEntries((await q(`select tipo, count(distinct visitante_id)::int n from vitrine_eventos where restaurante_id=$1 and tipo <> 'clique' and criado_em >= ${JANELA} and criado_em < ${FIM} group by tipo`, [loja.id])).map((r) => [r.tipo, r.n]))
  for (const [id, rot] of [['visita', 'Visitas'], ['visualizacao', 'Visualizações'], ['sacola', 'Sacola'], ['checkout', 'Checkout'], ['pedido', 'Pedidos']]) {
    const linhas = (await p.getByTestId(`funil-${id}`).innerText()).split('\n').map((l) => l.trim()).filter(Boolean)
    const tela = Number((linhas.find((l) => /^[\d.]+$/.test(l)) ?? 'NaN').replace(/\./g, ''))
    ok(`funil ${rot}: tela = visitantes únicos no banco (${funilBanco[id] ?? 0})`, tela === (funilBanco[id] ?? 0), `tela ${tela}`)
  }
  const tempo = await p.getByTestId('indicador-Tempo médio na rua').innerText().catch(() => '')
  ok('tempo de entrega com rótulo claro ("Tempo médio na rua" / "do pedido feito à entrega")', /Tempo médio na rua/.test(tempo) && (/do pedido feito à entrega|Sem entregas|Medição/.test(tempo)), tempo.replace(/\n/g, ' | '))
  await ctx.close()
} finally {
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
