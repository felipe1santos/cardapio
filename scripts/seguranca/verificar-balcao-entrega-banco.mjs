// 0098 — destino da entrega do balcão quando fica pronta. Banco LOCAL, tudo numa
// transação desfeita no fim (nada fica gravado).
//   node scripts/seguranca/verificar-balcao-entrega-banco.mjs
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const res = []
const ok = (nome, passou, det = '') => { res.push(passou); console.log(`${passou ? '✔' : '✘'} ${nome}${det ? ` — ${det}` : ''}`) }
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]

await db.query('begin')
try {
  const loja = (await um(`select id from restaurantes where slug = 'cantina-demo'`)).id
  async function pedido(canal, tipo) {
    return (await um(
      `insert into pedidos (restaurante_id, tipo, status, subtotal, total, canal, origem, cliente_nome)
       values ($1, $2, 'preparando', 10, 10, $3, $4, 'Verif 0098') returning id`,
      [loja, tipo, canal, canal === 'delivery' ? 'cardapio' : 'pdv'])).id
  }
  async function pronto(id) {
    await q(`update pedidos set status = 'pronto' where id = $1`, [id])
    return um(`select status, atendimento_status, pronto_em is not null as pronto_em, entregue_em is not null as entregue_em, concluido_em is not null as concluido from pedidos where id = $1`, [id])
  }
  const auditoria = (id) => um(`select dados from eventos_auditoria where entidade_id = $1 and acao = 'pedido.entrega_balcao_destino' order by criado_em desc limit 1`, [id])
  const flags = (usa, sem) => q(`update restaurantes set usa_logistica = $2, entrega_sem_entregador = $3 where id = $1`, [loja, usa, sem])

  await flags(true, false)
  let id = await pedido('balcao', 'entrega')
  let r = await pronto(id)
  ok('Logística ativa: entrega do balcão fica pronta para a Logística', r.status === 'pronto', r.status)
  ok('  e a auditoria registra o caminho "logistica"', (await auditoria(id))?.dados?.caminho === 'logistica')

  await flags(false, false)
  id = await pedido('balcao', 'entrega')
  r = await pronto(id)
  ok('Logística desligada: concluída na hora (não fica em "Pronto p/ despacho")', r.status === 'entregue', r.status)
  ok('  com atendimento concluído e os carimbos de pronto e entregue', r.atendimento_status === 'concluido' && r.pronto_em && r.entregue_em && r.concluido)
  const a2 = (await auditoria(id))?.dados
  ok('  e a auditoria registra "conclusao_automatica" / logistica_desligada', a2?.caminho === 'conclusao_automatica' && a2?.motivo === 'logistica_desligada', JSON.stringify(a2))

  await flags(true, true)
  id = await pedido('balcao', 'entrega')
  r = await pronto(id)
  ok('Loja sem entregador (0079): também conclui na hora', r.status === 'entregue')
  ok('  motivo entrega_sem_entregador na auditoria', (await auditoria(id))?.dados?.motivo === 'entrega_sem_entregador')

  await flags(false, false)
  id = await pedido('delivery', 'entrega')
  ok('delivery não muda (fica pronto mesmo sem Logística)', (await pronto(id)).status === 'pronto')
  id = await pedido('balcao', 'retirada')
  ok('retirada do balcão não muda (conclusão local de sempre)', (await pronto(id)).status === 'pronto')
  ok('retirada não gera registro de destino', !(await auditoria(id)))

  id = await pedido('balcao', 'entrega')
  await q(`update pedidos set status = 'pronto' where id = $1`, [id])
  const antes = (await um(`select count(*)::int n from eventos_auditoria where entidade_id = $1`, [id])).n
  await q(`update pedidos set observacao = 'x' where id = $1`, [id])
  ok('atualização que não mexe no status não dispara nada', (await um(`select count(*)::int n from eventos_auditoria where entidade_id = $1`, [id])).n === antes)

  const fn = await um(`select has_function_privilege('authenticated', 'public.pedido_entrega_balcao_destino()', 'EXECUTE') as pode`)
  ok('função do gatilho não é executável por authenticated', fn.pode === false)
} catch (e) {
  ok('execução', false, e.message)
} finally {
  await db.query('rollback')
  await db.end()
}
const f = res.filter((x) => !x).length
console.log(`\n${res.length - f}/${res.length} passaram (transação desfeita)`)
process.exit(f ? 1 : 0)
