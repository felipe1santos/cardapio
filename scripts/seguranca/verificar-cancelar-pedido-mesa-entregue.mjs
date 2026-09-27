// Prova da 0102 no banco LOCAL: cancelar lançamento de mesa já servido (entregue).
// Cada cenário roda numa transação desfeita no fim — nada fica gravado.
//   node scripts/seguranca/verificar-cancelar-pedido-mesa-entregue.mjs
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? '✔' : '✘'} ${n}${d ? ` — ${d}` : ''}`) }
const erro = async (fn) => { await db.query('savepoint t'); try { await fn(); await db.query('release savepoint t'); return null } catch (e) { await db.query('rollback to savepoint t'); return e.message } }

const loja = await um(`select id from restaurantes where slug = 'cantina-e2e'`)
const ator = await um(`select id, nome from usuarios where restaurante_id = $1 limit 1`, [loja.id])
const item = await um(`select id, nome, preco from itens_cardapio where restaurante_id = $1 limit 1`, [loja.id])
const mesa = await um(`select m.id, m.nome from mesas m where m.restaurante_id = $1 and m.ativa
  and not exists (select 1 from comandas c where c.mesa_id = m.id and c.status = 'aberta') order by m.ordem limit 1`, [loja.id])

/** Conta de mesa aberta com um lançamento no status pedido (com item). */
async function cenario(status, preco = 20) {
  const c = await um(`insert into comandas (restaurante_id, mesa_id, cliente_nome) values ($1, $2, 'Prova 0102') returning id`, [loja.id, mesa.id])
  const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, canal, comanda_id, mesa, origem, cliente_nome, impresso)
    values ($1, 'retirada', 'recebido', $2, $2, 'mesa', $3, $4, 'pdv', 'Prova 0102', true) returning id, numero`, [loja.id, preco, c.id, mesa.nome])
  await q(`insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade) values ($1, $2, $3, $4, 1)`, [p.id, item.id, item.nome, preco])
  if (status !== 'recebido') await q(`update pedidos set status = 'preparando' where id = $1`, [p.id])
  if (status === 'pronto' || status === 'entregue') await q(`update pedidos set status = 'pronto' where id = $1`, [p.id])
  if (status === 'entregue') await q(`update pedidos set status = 'entregue' where id = $1`, [p.id])
  return { comanda: c.id, pedido: p.id, numero: p.numero }
}
const pagar = (comanda, valor) => q(`insert into pagamentos_comanda (restaurante_id, comanda_id, forma, valor, criado_por_nome) values ($1, $2, 'dinheiro', $3, 'Prova 0102')`, [loja.id, comanda, valor])
const cancelarMesa = (pedido) => q(`select public.pedido_mesa_cancelar($1, $2, 'Prova 0102', $3, $4)`, [loja.id, pedido, ator.id, ator.nome])
const eleg = async () => new Set((await q(`select * from impressao_elegiveis($1)`, [loja.id])).map((r) => Object.values(r)[0]))

async function emTransacao(nome, fn) {
  console.log(`\n── ${nome} ──`)
  await db.query('begin')
  try { await fn() } catch (e) { ok(`${nome}: sem exceção`, false, e.message) } finally { await db.query('rollback') }
}

await emTransacao('1. entregue com cancelamento pendente: aprovação passa', async () => {
  const s = await cenario('entregue')
  const sol = (await q(`select public.cancelamento_solicitar($1, $2, null, 'Cliente devolveu', $3, 'Garçom Prova') r`, [loja.id, s.pedido, ator.id]))[0].r
  const solId = sol?.id ?? (await um(`select id from solicitacoes_cancelamento where pedido_id = $1`, [s.pedido])).id
  const e = await erro(() => q(`select public.cancelamento_decidir($1, $2, true, null, $3, $4)`, [loja.id, solId, ator.id, ator.nome]))
  ok('aprovar não dá erro', e === null, e ?? '')
  const p = await um(`select status, reimprimir from pedidos where id = $1`, [s.pedido])
  const so = await um(`select status, decidido_por_nome from solicitacoes_cancelamento where id = $1`, [solId])
  ok('pedido entregue vira cancelado', p.status === 'cancelado')
  ok('solicitação aprovada, com quem decidiu', so.status === 'aprovada' && so.decidido_por_nome === ator.nome)
  ok('reimprimir = false e fora da fila de impressão', p.reimprimir === false && !(await eleg()).has(s.pedido))
  const aud = await q(`select acao, dados from eventos_auditoria where entidade_id = $1 order by criado_em`, [s.comanda])
  ok('auditoria: aprovou_cancelamento + cancelou_pedido (de entregue)',
    aud.some((a) => a.acao === 'conta.aprovou_cancelamento') && aud.some((a) => a.acao === 'conta.cancelou_pedido' && a.dados?.de === 'entregue'),
    aud.map((a) => a.acao).join(', '))
  const t = await um(`select total::float from comanda_totais($1)`, [s.comanda])
  ok('conta zera o total do lançamento cancelado', t.total === 0)
  const dupla = await erro(() => q(`select public.cancelamento_decidir($1, $2, true, null, $3, $4)`, [loja.id, solId, ator.id, ator.nome]))
  ok('segunda aprovação recusada (solicitacao_decidida)', /solicitacao_decidida/.test(dupla ?? ''), dupla ?? '')
})

await emTransacao('2. cancelado de verdade continua recusado', async () => {
  const s = await cenario('entregue')
  await cancelarMesa(s.pedido)
  const e = await erro(() => cancelarMesa(s.pedido))
  ok('cancelar de novo → ja_cancelado', /ja_cancelado/.test(e ?? ''), e ?? '')
})

await emTransacao('3. pago não cancela indevidamente', async () => {
  const s = await cenario('entregue', 20)
  await pagar(s.comanda, 20)
  const e = await erro(() => cancelarMesa(s.pedido))
  ok('conta paga: cancelar o servido é recusado (pagamento_excede_total)', /pagamento_excede_total/.test(e ?? ''), e ?? '')
  ok('  e nada mudou (pedido segue entregue)', (await um(`select status from pedidos where id = $1`, [s.pedido])).status === 'entregue')
})

await emTransacao('4. pagamento parcial que ainda cabe no novo total', async () => {
  const s = await cenario('entregue', 20)
  const s2p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, canal, comanda_id, mesa, origem, cliente_nome, impresso)
    values ($1, 'retirada', 'recebido', 30, 30, 'mesa', $2, $3, 'pdv', 'Prova 0102', true) returning id`, [loja.id, s.comanda, mesa.nome])
  await q(`insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade) values ($1, $2, $3, 30, 1)`, [s2p.id, item.id, item.nome])
  await pagar(s.comanda, 25)
  const e = await erro(() => cancelarMesa(s.pedido))
  ok('pago 25 de 50; cancelar o servido de 20 (novo total 30) é permitido', e === null, e ?? '')
})

await emTransacao('5. conta sem pagamento cancela inteira com motivo', async () => {
  const s = await cenario('entregue')
  const e = await erro(() => q(`select public.comanda_cancelar($1, $2, 'Limpeza de dados de teste antigos', $3, $4)`, [loja.id, s.comanda, ator.id, ator.nome]))
  const c = await um(`select status, cancelada_motivo from comandas where id = $1`, [s.comanda])
  ok('comanda_cancelar ok', e === null && c.status === 'cancelada' && c.cancelada_motivo === 'Limpeza de dados de teste antigos', e ?? '')
  ok('  pedido cancelado e fora da fila', (await um(`select status from pedidos where id = $1`, [s.pedido])).status === 'cancelado' && !(await eleg()).has(s.pedido))
})

await emTransacao('6. regras que não mudaram', async () => {
  const s = await cenario('preparando')
  const outra = await um(`select id from restaurantes where slug = 'vizinha-e2e'`)
  const x = await erro(() => q(`select public.pedido_mesa_cancelar($1, $2, 'x', $3, $4)`, [outra.id, s.pedido, ator.id, ator.nome]))
  ok('outra loja não cancela pedido desta (item_inexistente)', /item_inexistente/.test(x ?? ''), x ?? '')
  ok('preparando continua cancelável', (await erro(() => cancelarMesa(s.pedido))) === null)
  const b = await erro(() => q(`select public.pedido_mesa_cancelar($1, $2, '  ', $3, $4)`, [loja.id, s.pedido, ator.id, ator.nome]))
  ok('motivo vazio continua recusado', /motivo_obrigatorio/.test(b ?? ''))
})

const sobra = await um(`select count(*)::int n from comandas where cliente_nome = 'Prova 0102'`)
ok('nada ficou gravado no banco', sobra.n === 0)
await db.end()
const passou = res.filter(Boolean).length
console.log(`\n${passou}/${res.length} verificações passaram`)
process.exit(passou === res.length ? 0 : 1)
