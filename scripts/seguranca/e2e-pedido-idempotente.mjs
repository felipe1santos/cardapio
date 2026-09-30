/**
 * E2E — pedido da vitrine sem duplicar (M24). Stack local, loja ordem-qr-e2e.
 *
 *   · o mesmo pedido enviado 2× (resposta perdida) devolve o MESMO pedido;
 *   · 3 envios simultâneos com a mesma chave criam 1 pedido só;
 *   · chave nova = pedido novo;
 *   · quantidade absurda (3 bilhões) é recusada antes de criar qualquer coisa.
 * Apaga os pedidos que criou.
 *
 *   node scripts/seguranca/e2e-pedido-idempotente.mjs      (servidor local em 127.0.0.1:3999)
 */
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

const loja = (await db.query(`select id from restaurantes where slug=$1`, [SLUG])).rows[0]
const item = (await db.query(`select id from itens_cardapio where restaurante_id=$1 and nome ilike 'Coca Lata%' limit 1`, [loja.id])).rows[0]
const TEL = '5527999880011'
const corpo = (extra = {}) => ({
  tipo: 'retirada',
  cliente: { nome: 'QA idempotente', telefone: TEL },
  endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
  pagamento: 'dinheiro',
  trocoPara: null,
  itens: [{ itemId: item.id, quantidade: 1, observacao: '', complementos: [] }],
  ...extra,
})
const enviar = (b) => fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
  .then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))
const contar = async () => (await db.query(`select count(*)::int n from pedidos where restaurante_id=$1 and cliente_telefone=$2`, [loja.id, TEL])).rows[0].n

try {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone=$2`, [loja.id, TEL])

  const chave = randomUUID()
  const a = await enviar(corpo({ chavePedido: chave }))
  const b = await enviar(corpo({ chavePedido: chave }))
  ok('1º envio cria (201)', a.s === 201 && a.j?.id, `${a.s} ${a.j?.error ?? ''}`)
  ok('reenvio com a mesma chave devolve o mesmo pedido (200)', b.s === 200 && b.j?.id === a.j?.id && b.j?.numero === a.j?.numero)
  ok('só 1 pedido gravado', (await contar()) === 1)

  const chave2 = randomUUID()
  const juntos = await Promise.all([1, 2, 3].map(() => enviar(corpo({ chavePedido: chave2 }))))
  const ids = new Set(juntos.map((r) => r.j?.id))
  ok('3 envios simultâneos com a mesma chave: 1 pedido', ids.size === 1 && juntos.every((r) => r.s === 200 || r.s === 201) && (await contar()) === 2, JSON.stringify(juntos.map((r) => r.s)))

  const c = await enviar(corpo({ chavePedido: randomUUID() }))
  ok('chave nova cria outro pedido', c.s === 201 && c.j?.id !== a.j?.id && (await contar()) === 3)

  const semChave = await enviar(corpo())
  ok('sem chave (aba antiga da vitrine) continua funcionando', semChave.s === 201 && (await contar()) === 4)

  const antes = await contar()
  const absurdo = await enviar(corpo({ chavePedido: randomUUID(), itens: [{ itemId: item.id, quantidade: 3_000_000_000, observacao: '', complementos: [] }] }))
  ok('quantidade de 3 bilhões recusada (400) sem criar pedido', absurdo.s === 400 && /999/.test(absurdo.j?.error ?? '') && (await contar()) === antes, `${absurdo.s} ${absurdo.j?.error}`)
  const fracao = await enviar(corpo({ itens: [{ itemId: item.id, quantidade: 1.5, observacao: '', complementos: [] }] }))
  ok('quantidade fracionada recusada', fracao.s === 400)

  const semItens = (await db.query(`select count(*)::int n from pedidos p where p.restaurante_id=$1 and p.cliente_telefone=$2 and not exists (select 1 from pedido_itens i where i.pedido_id=p.id)`, [loja.id, TEL])).rows[0].n
  ok('nenhum pedido ficou sem itens', semItens === 0)
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone=$2`, [loja.id, TEL])
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
