/**
 * B1: os botões de diagnóstico do Assistente não podem mexer na fila.
 *
 * Simula as chamadas de "Testar pareamento", "Buscar impressoras" e "Testar impressora"
 * — tanto do Assistente antigo (0.1.23/0.1.24, que usam GET /api/agente/pedidos sem
 * instância) quanto do novo (GET /api/agente/diagnostico) — e prova que nenhuma cria
 * reserva, muda `impresso`/`reimprimir` ou esconde o pedido do Assistente legítimo.
 *
 * Só loopback, loja de demonstração, token de teste aleatório nunca impresso.
 */
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const token = crypto.randomUUID()
await db.query('update restaurantes set impressao_agente_token=$2, impressao_automatica=true where id=$1', [loja, token])
await db.query('delete from impressao_reservas where restaurante_id=$1', [loja])
await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [loja])
const ped = (await um(`insert into pedidos (restaurante_id, tipo, status, total, canal, cliente_nome, impresso)
  values ($1,'retirada','recebido',10,'delivery','Cliente Demonstração B1',false) returning id`, [loja])).id
await db.query(`insert into pedido_itens (pedido_id, nome, preco_unitario, quantidade) values ($1,'Item B1',10,1)`, [ped])

const auth = { Authorization: `Bearer ${token}` }
const get = async (url, extra = {}) => {
  const r = await fetch(`${BASE}${url}`, { headers: { ...auth, ...extra } })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const estado = async () => ({
  reservas: Number((await um('select count(*) n from impressao_reservas where restaurante_id=$1', [loja])).n),
  ...(await um('select impresso, reimprimir from pedidos where id=$1', [ped])),
})

console.log('\n── Assistente antigo: botões chamam /api/agente/pedidos sem instância ──')
const antes = await estado()
for (let i = 0; i < 3; i++) await get('/api/agente/pedidos')
const depoisAntigo = await estado()
ok('nenhuma reserva criada', depoisAntigo.reservas === 0)
ok('impresso e reimprimir intactos', depoisAntigo.impresso === antes.impresso && depoisAntigo.reimprimir === antes.reimprimir)

console.log('\n── Assistente 0.1.25: botões chamam /api/agente/diagnostico ──')
const d = await get('/api/agente/diagnostico')
ok('diagnóstico responde configuração e impressoras', d.status === 200 && Array.isArray(d.json?.impressoras) && !!d.json?.config)
ok('diagnóstico não devolve pedidos', !('pedidos' in (d.json ?? {})))
for (let i = 0; i < 3; i++) await get('/api/agente/diagnostico')
const depoisNovo = await estado()
ok('nenhuma reserva criada', depoisNovo.reservas === 0)
ok('impresso e reimprimir intactos', depoisNovo.impresso === false && depoisNovo.reimprimir === false)
ok('diagnóstico com token inválido é recusado', (await fetch(`${BASE}/api/agente/diagnostico`, { headers: { Authorization: `Bearer ${crypto.randomUUID()}` } })).status === 401)

console.log('\n── O Assistente legítimo continua vendo o pedido ──')
const legit = await get('/api/agente/pedidos', { 'X-Agente-Instancia': 'agente-legitimo-b1' })
ok('pedido aparece para quem consome a fila com identidade', (legit.json?.pedidos ?? []).some((p) => p.id === ped))
ok('e só ele reserva', Number((await um(`select count(*) n from impressao_reservas where restaurante_id=$1 and reservado_por='agente-legitimo-b1'`, [loja])).n) >= 1)
const semId = await get('/api/agente/pedidos')
ok('chamada sem identidade não recebe o pedido reservado por outro', !(semId.json?.pedidos ?? []).some((p) => p.id === ped))
ok('reservas órfãs (sem dono) não existem', Number((await um('select count(*) n from impressao_reservas where reservado_por is null')).n) === 0)

await db.query('delete from impressao_reservas where restaurante_id=$1', [loja])
await db.query('update pedidos set impresso=true where id=$1', [ped])
await db.query('update restaurantes set impressao_agente_token=null where id=$1', [loja])
await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
