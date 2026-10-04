/**
 * E2E — atomicidade das gravações de dinheiro/custo do financeiro (Fases 5, 5b e 6).
 * Injeta uma FALHA no meio de cada operação (gatilho temporário no banco LOCAL que recusa um passo do meio) e confere
 * que nada ficou pela metade; repete a requisição e confere que não duplica. Os gatilhos de falha são removidos no fim.
 *
 *   node scripts/seguranca/e2e-financeiro-atomico.mjs
 */
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'fin-int'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
await db.query(`update restaurantes set financeiro_ativo=true where id=$1`, [loja.id])
const SENHA = 'demo-local-123456'
const SUF = Math.random().toString(36).slice(2, 6)
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)
const browser = await chromium.launch()
async function logar(login) {
  const ctx = await browser.newContext({ locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  let j = null; try { j = await r.json() } catch { /* */ }
  return { s: r.status, j }
}, { url: `${BASE}${url}`, metodo, corpo })

// Falha injetada: gatilho temporário que recusa a gravação de um passo do meio quando o dado tem a marca.
const falhas = []
async function falharEm(tabela, condicao) {
  const nome = `e2e_falha_${tabela}_${falhas.length}`
  await db.query(`create or replace function public.${nome}() returns trigger language plpgsql as $f$ begin if ${condicao} then raise exception 'falha_injetada_e2e'; end if; return new; end $f$`)
  await db.query(`create trigger ${nome} before insert or update on public.${tabela} for each row execute function public.${nome}()`)
  falhas.push([nome, tabela])
}
async function limparFalhas() {
  for (const [nome, tabela] of falhas.splice(0)) {
    await db.query(`drop trigger if exists ${nome} on public.${tabela}`).catch(() => {})
    await db.query(`drop function if exists public.${nome}()`).catch(() => {})
  }
}
const contar = async (sql, p) => Number((await um(sql, p)).n)

const dono = await logar('dono.finint')
try {
  secao('Fase 5 — insumo (insumo + componentes + histórico + auditoria)')
  const cria = await api(dono.p, '/api/admin/financeiro/cmv/insumos', 'POST', { nome: `TESTE Atomico ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 1000, aproveitamentoPct: 100 })
  ok('insumo criado', cria.s === 201, texto(cria.j))
  const id = cria.j.id
  const hist0 = await contar(`select count(*) n from cmv_custos_historico where insumo_id=$1`, [id])
  const aud0 = await contar(`select count(*) n from eventos_auditoria where entidade_id=$1`, [id])
  await falharEm('cmv_custos_historico', `new.motivo like 'TESTE FALHA%'`)
  const ed = await api(dono.p, `/api/admin/financeiro/cmv/insumos/${id}`, 'PATCH', { acao: 'editar', nome: `TESTE Atomico ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 2500, aproveitamentoPct: 100, motivo: 'TESTE FALHA no histórico' })
  const ins = await um(`select custo_compra_centavos::int c from cmv_insumos where id=$1`, [id])
  ok('falha no histórico: o custo NÃO mudou (nada pela metade)', ed.s >= 500 && ins.c === 1000, `${ed.s} custo=${ins.c}`)
  ok('…nem histórico nem auditoria gravados', await contar(`select count(*) n from cmv_custos_historico where insumo_id=$1`, [id]) === hist0 && await contar(`select count(*) n from eventos_auditoria where entidade_id=$1`, [id]) === aud0)
  await limparFalhas()
  const ed2 = await api(dono.p, `/api/admin/financeiro/cmv/insumos/${id}`, 'PATCH', { acao: 'editar', nome: `TESTE Atomico ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 2500, aproveitamentoPct: 100, motivo: 'TESTE reajuste' })
  ok('sem a falha: custo, histórico e auditoria juntos', ed2.s === 200 && (await um(`select custo_compra_centavos::int c from cmv_insumos where id=$1`, [id])).c === 2500
    && await contar(`select count(*) n from cmv_custos_historico where insumo_id=$1`, [id]) === hist0 + 1)

  secao('Fase 5 — ficha de custo (ficha + componentes + auditoria)')
  const grupo = await um(`select id from grupos_cardapio where restaurante_id=$1 order by posicao limit 1`, [loja.id])
  const item = (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status, tipo_item) values ($1,$2,$3,20,'disponivel','simples') returning id`, [loja.id, grupo.id, `TESTE Atomico Item ${SUF}`])).id
  ok('ficha salva', (await api(dono.p, '/api/admin/financeiro/cmv/ficha', 'PUT', { tipo: 'item', id: item, componentes: [{ insumoId: id, quantidadeBase: 100 }] })).s === 200)
  await falharEm('cmv_ficha_componentes', `new.quantidade_base = 777`)
  const f2 = await api(dono.p, '/api/admin/financeiro/cmv/ficha', 'PUT', { tipo: 'item', id: item, componentes: [{ insumoId: id, quantidade: 1, quantidadeBase: 777 }] })
  const comps = await q(`select quantidade_base::float qb from cmv_ficha_componentes fc join cmv_fichas f on f.id=fc.ficha_id where f.alvo_id=$1`, [item])
  ok('falha nos componentes: a ficha antiga continua inteira (100 g)', f2.s >= 500 && comps.length === 1 && comps[0].qb === 100, `${f2.s} ${texto(comps)}`)
  await limparFalhas()
  await db.query(`delete from cmv_fichas where alvo_id=$1`, [item]); await db.query(`delete from itens_cardapio where id=$1`, [item])
  await db.query(`update cmv_insumos set ativo=false where id=$1`, [id])
} catch (e) {
  ok('fluxo sem erro', false, String(e?.stack ?? e).slice(0, 500))
} finally {
  await limparFalhas()
  await browser.close()
  await db.end()
}
const n = res.filter((x) => !x).length
console.log(`\n${res.length - n}/${res.length} verificações passaram`)
process.exit(n ? 1 : 0)
