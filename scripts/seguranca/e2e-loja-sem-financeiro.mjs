/**
 * E2E — o custo na venda (Fase 5) não mexe nas lojas SEM o financeiro (todas as lojas reais hoje).
 * Loja local `cantina-pdv2` (financeiro desligado). Faz pedidos pela vitrine alternando o gatilho de custo LIGADO e
 * DESLIGADO (só no banco local) e compara: todos entram, nenhum grava custo, e o tempo de resposta é o mesmo.
 * Também confere a garantia do gatilho numa loja COM financeiro: se o cálculo falhar, o pedido entra e o item fica "erro".
 *
 *   node scripts/seguranca/e2e-loja-sem-financeiro.mjs
 */
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'cantina-pdv2'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const loja = await um(`select id, financeiro_ativo from restaurantes where slug=$1`, [SLUG])
const item = await um(`select id from itens_cardapio where restaurante_id=$1 and status='disponivel' and tipo_item='simples' and preco>0 order by criado_em limit 1`, [loja.id])
const gatilho = (ligado) => db.query(`alter table public.pedido_itens ${ligado ? 'enable' : 'disable'} trigger cmv_guardar_custo_linha`)
async function pedido(i) {
  const t0 = performance.now()
  const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'retirada', cliente: { nome: 'TESTE sem financeiro', telefone: `2799999${String(1000 + i).slice(-4)}` }, pagamento: 'pix', trocoPara: null,
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' }, itens: [{ itemId: item.id, quantidade: 2, observacao: '', complementos: [] }] }) })
  const ms = performance.now() - t0
  const j = await r.json().catch(() => ({}))
  return { s: r.status, id: j.id, ms }
}
const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const ids = []
try {
  console.log('\n── Loja sem financeiro: o pedido fica igual ──')
  ok('a loja de teste está SEM o financeiro', loja.financeiro_ativo === false)
  for (let i = 0; i < 3; i++) await pedido(900 + i) // aquecimento
  const tempos = { ligado: [], desligado: [] }
  let falhou = 0
  for (let i = 0; i < 24; i++) {
    const modo = i % 2 === 0 ? 'ligado' : 'desligado'
    await gatilho(modo === 'ligado')
    const r = await pedido(i)
    if (r.s !== 201) falhou++
    else { ids.push(r.id); tempos[modo].push(r.ms) }
  }
  await gatilho(true)
  ok('todos os pedidos entraram (24/24)', falhou === 0, `${falhou} falha(s)`)
  const semCusto = await um(`select count(*)::int n from pedido_itens_custo where pedido_id = any($1)`, [ids])
  ok('nenhum custo gravado em loja sem o financeiro', semCusto.n === 0, String(semCusto.n))
  const ml = mediana(tempos.ligado), md = mediana(tempos.desligado)
  ok('mesmo tempo de resposta com e sem o gatilho (diferença da mediana < 15% ou < 25 ms)', Math.abs(ml - md) < Math.max(25, md * 0.15), `com ${ml.toFixed(0)} ms × sem ${md.toFixed(0)} ms`)
  const linha = await um(`select count(*)::int n from pedido_itens where pedido_id = any($1)`, [ids])
  ok('itens gravados normalmente', linha.n === ids.length)

  console.log('\n── Loja com financeiro: falha no cálculo não derruba o pedido ──')
  const fin = await um(`select id from restaurantes where slug='fin-int'`)
  await db.query(`update restaurantes set financeiro_ativo=true, aceita_retirada=true where id=$1`, [fin.id])
  const itFin = await um(`select id from itens_cardapio where restaurante_id=$1 and status='disponivel' and tipo_item='simples' and preco>0 order by criado_em limit 1`, [fin.id])
  // Falha injetada: a função de cálculo some por um instante (dentro de uma transação local que é desfeita depois).
  await db.query(`alter function public.cmv_custo_linha(uuid, uuid, text, text, text, text, jsonb) rename to cmv_custo_linha_e2e`)
  let r2
  try {
    const t = await fetch(`${BASE}/api/loja/fin-int/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      tipo: 'retirada', cliente: { nome: 'TESTE sem financeiro', telefone: '27999990999' }, pagamento: 'pix', trocoPara: null,
      endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' }, itens: [{ itemId: itFin.id, quantidade: 1, observacao: '', complementos: [] }] }) })
    r2 = { s: t.status, j: await t.json().catch(() => ({})) }
  } finally {
    await db.query(`alter function public.cmv_custo_linha_e2e(uuid, uuid, text, text, text, text, jsonb) rename to cmv_custo_linha`)
  }
  const c2 = await um(`select situacao, erro from pedido_itens_custo where pedido_id=$1`, [r2.j?.id])
  ok('cálculo do custo quebrado: o pedido entra e o item fica "erro" (sem custo)', r2.s === 201 && c2?.situacao === 'erro', `${r2.s} ${JSON.stringify(c2)}`)
  if (r2.j?.id) ids.push(r2.j.id)
} catch (e) {
  ok('fluxo sem erro', false, String(e?.stack ?? e).slice(0, 400))
} finally {
  await gatilho(true).catch(() => {})
  if (ids.length) await db.query(`update pedidos set status='cancelado', cancelado_em=now(), cancelado_motivo='TESTE' where id = any($1)`, [ids]).catch(() => {})
  await db.end()
}
const n = res.filter((x) => !x).length
console.log(`\n${res.length - n}/${res.length} verificações passaram`)
process.exit(n ? 1 : 0)
