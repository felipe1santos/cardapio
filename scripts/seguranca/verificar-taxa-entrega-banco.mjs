// 0099 — taxa de entrega da conta só com item ativo. Banco LOCAL, tudo numa transação
// desfeita no fim (nada fica gravado). Usa as funções reais do PDV (abrir, lançar,
// cancelar pedido/item, pagar, estornar, fechar, reabrir).
//   node scripts/seguranca/verificar-taxa-entrega-banco.mjs
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const res = []
const ok = (nome, passou, det = '') => { res.push(!!passou); console.log(`${passou ? '✔' : '✘'} ${nome}${det !== '' ? ` — ${det}` : ''}`) }
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const uuid = () => crypto.randomUUID()
const n = (v) => Number(v)
/** Roda num savepoint: erro esperado não derruba a transação do teste. */
async function tenta(sql, p = []) {
  await db.query('savepoint t')
  try { const r = await q(sql, p); await db.query('release savepoint t'); return { ok: true, r } } catch (e) { await db.query('rollback to savepoint t'); return { ok: false, erro: e.message } }
}

await db.query('begin')
try {
  const loja = (await um(`select id from restaurantes where slug = 'cantina-demo'`)).id
  const vizinha = (await um(`select id from restaurantes where slug = 'vizinha-demo'`)).id
  await q(`update restaurantes set pdv_v2 = true where id = $1`, [loja])
  const dono = await um(`select id, nome from usuarios where restaurante_id = $1 and papel = 'dono' limit 1`, [loja])
  const atendente = await um(`select id, nome from usuarios where restaurante_id = $1 and papel = 'atendente' limit 1`, [loja])
  const gerente = await um(`select id, nome from usuarios where restaurante_id = $1 and papel = 'gerente' limit 1`, [loja]) ?? dono
  const item = await um(`select id, nome, preco from itens_cardapio where restaurante_id = $1 and status = 'disponivel' and tipo_item = 'simples' and preco > 0 order by preco limit 1`, [loja])
  const P = n(item.preco)
  const TAXA = 6.5
  const END = { cep: '29000000', rua: 'Rua Verif', numero: '1', complemento: '', bairro: 'Centro', cidade: 'Cidade/ES', referencia: '', observacao: '' }

  async function abrir({ entrega = true, taxaManual = true, ator = dono } = {}) {
    const r = await um(`select public.comanda_balcao_abrir($1, $2, null, $3, $4, $5, $6, 'pdv') r`,
      [loja, `Verif 0099 ${uuid().slice(0, 6)}`, ator.id, ator.nome, uuid(), entrega ? JSON.stringify({ ...END, taxa: TAXA, taxa_manual: taxaManual }) : null])
    return r.r.id
  }
  async function lancar(comanda, qtds = [1], ator = dono) {
    const itens = qtds.map((qt) => ({ item_id: item.id, nome: item.nome, preco_unitario: P, quantidade: qt, observacao: '', complementos: [] }))
    const sub = qtds.reduce((s, qt) => s + qt * P, 0)
    const r = await um(`select public.comanda_lancar($1, $2, $3, $4, $5, $6, $7, 'pdv') r`,
      [loja, comanda, JSON.stringify({ subtotal: sub }), JSON.stringify(itens), ator.id, ator.nome, uuid()])
    return r.r.id
  }
  const totais = (c) => um(`select * from public.comanda_totais($1)`, [c])
  const cancelarPedido = (pid, ator = dono, rest = loja) => tenta(`select public.pedido_presencial_cancelar($1, $2, 'teste 0099', $3, $4, false, 'pdv')`, [rest, pid, ator.id, ator.nome])
  const itensDe = (pid) => q(`select id, quantidade from pedido_itens where pedido_id = $1 order by id`, [pid])
  const cancelarItem = (iid) => tenta(`select public.item_cancelar($1, $2, 'teste 0099', 'Verif')`, [loja, iid])
  const pagar = (c, v) => um(`select public.comanda_pagamento_registrar($1, $2, 'dinheiro', $3, null, $4, $5, $6, null, 'pdv') r`, [loja, c, v, uuid(), dono.id, dono.nome])
  // Fecha marcando como entregue o que ainda estiver na cozinha (decisão do fechamento, 0096).
  const fechar = async (c, chave = uuid()) => {
    const abertos = await q(`select id from pedidos where comanda_id = $1 and status not in ('cancelado', 'entregue')`, [c])
    return tenta(`select public.comanda_fechar_completo($1, $2, $3, '[]'::jsonb, $4, $5, 'dono', 'pdv', $6) r`, [loja, c, JSON.stringify(abertos.map((p) => ({ pedido_id: p.id, acao: 'entregue' }))), dono.id, dono.nome, chave])
  }
  const aud = async (c, acao) => (await q(`select dados from eventos_auditoria where entidade_id = $1 and acao = $2`, [c, acao])).map((r) => r.dados)
  const ped = (pid) => um(`select status, taxa_entrega, total from pedidos where id = $1`, [pid])
  const somaPedidos = async (c) => n((await um(`select coalesce(sum(total), 0) s from pedidos where comanda_id = $1 and status <> 'cancelado'`, [c])).s)

  console.log('── 1. entrega única cancelada')
  let c = await abrir(); let p1 = await lancar(c)
  ok('antes: total = item + taxa', n((await totais(c)).total) === +(P + TAXA).toFixed(2), (await totais(c)).total)
  await cancelarPedido(p1)
  ok('depois: taxa sai do total (0)', n((await totais(c)).total) === 0, (await totais(c)).total)
  ok('auditoria "taxa não cobrada" exatamente 1 (motivo pedido_cancelado)', (await aud(c, 'conta.taxa_entrega_nao_cobrada')).length === 1 && (await aud(c, 'conta.taxa_entrega_nao_cobrada'))[0].motivo === 'pedido_cancelado')
  ok('cancelar de novo é recusado e não audita de novo', !(await cancelarPedido(p1)).ok && (await aud(c, 'conta.taxa_entrega_nao_cobrada')).length === 1)
  let f = await fechar(c)
  ok('fecha sem pagamento; taxa cobrada gravada = 0', f.ok && n((await um(`select taxa_entrega_cobrada t, total_final tf from comandas where id=$1`, [c])).t) === 0, f.erro ?? '')
  ok('fechada: total continua 0 (histórico estável)', n((await totais(c)).total) === 0)

  console.log('── 2. todos os itens cancelados um a um')
  c = await abrir(); p1 = await lancar(c, [1, 2])
  const [i1, i2] = await itensDe(p1)
  await cancelarItem(i1.id)
  ok('cancelamento parcial (resta item): taxa continua', n((await totais(c)).total) === +(i2.quantidade * P + TAXA).toFixed(2), (await totais(c)).total)
  ok('  e não audita nada', (await aud(c, 'conta.taxa_entrega_nao_cobrada')).length === 0)
  await cancelarItem(i2.id)
  ok('último item cancelado → pedido cancelado e taxa sai (0)', (await ped(p1)).status === 'cancelado' && n((await totais(c)).total) === 0, (await totais(c)).total)
  const a2 = await aud(c, 'conta.taxa_entrega_nao_cobrada')
  ok('  exatamente 1 auditoria (motivo itens_cancelados), sem duplicar pelo pedido', a2.length === 1 && a2[0].motivo === 'itens_cancelados', JSON.stringify(a2))

  console.log('── 4. dois pedidos na mesma conta')
  c = await abrir(); p1 = await lancar(c); let p2 = await lancar(c, [2])
  ok('só o primeiro carrega a cópia da taxa', n((await ped(p1)).taxa_entrega) === TAXA && n((await ped(p2)).taxa_entrega) === 0)
  ok('conta cobra a taxa uma vez', n((await totais(c)).total) === +(3 * P + TAXA).toFixed(2))
  await cancelarPedido(p1)
  ok('cancelado o 1º: taxa continua uma vez na conta', n((await totais(c)).total) === +(2 * P + TAXA).toFixed(2), (await totais(c)).total)
  ok('  a cópia passou para o 2º pedido (total do pedido inclui a taxa)', n((await ped(p2)).taxa_entrega) === TAXA && n((await ped(p2)).total) === +(2 * P + TAXA).toFixed(2), JSON.stringify(await ped(p2)))
  ok('  Dashboard (soma dos pedidos ativos) = total da conta', (await somaPedidos(c)) === n((await totais(c)).total), `${await somaPedidos(c)}`)
  ok('  auditoria de transferência 1, nenhuma de "não cobrada"', (await aud(c, 'conta.taxa_entrega_transferida')).length === 1 && (await aud(c, 'conta.taxa_entrega_nao_cobrada')).length === 0)
  c = await abrir(); p1 = await lancar(c); p2 = await lancar(c, [2])
  await cancelarPedido(p2)
  ok('cancelado só o 2º (sem a cópia): taxa e 1º pedido intactos, nada auditado', n((await totais(c)).total) === +(P + TAXA).toFixed(2) && n((await ped(p1)).taxa_entrega) === TAXA && (await aud(c, 'conta.taxa_entrega_transferida')).length === 0)

  console.log('── relançar depois de tudo cancelado')
  c = await abrir(); p1 = await lancar(c); await cancelarPedido(p1)
  p2 = await lancar(c)
  ok('pedido novo volta a cobrar a taxa (total = item + taxa)', n((await totais(c)).total) === +(P + TAXA).toFixed(2))
  ok('  e carrega a cópia (Dashboard = conta)', n((await ped(p2)).taxa_entrega) === TAXA && (await somaPedidos(c)) === n((await totais(c)).total))
  ok('  auditoria "taxa cobrada" 1', (await aud(c, 'conta.taxa_entrega_cobrada')).length === 1)

  console.log('── 5/6. taxa automática e manual')
  for (const manual of [false, true]) {
    c = await abrir({ taxaManual: manual }); p1 = await lancar(c); await cancelarPedido(p1)
    ok(`taxa ${manual ? 'manual' : 'automática'}: sai quando o único pedido é cancelado`, n((await totais(c)).total) === 0 && (await aud(c, 'conta.taxa_entrega_nao_cobrada')).length === 1)
  }

  console.log('── 8/9. pagamento parcial e maior que o novo total')
  // O novo total sem a taxa fica abaixo do que já foi pago: o cancelamento é RECUSADO
  // (comanda_conferir_pago) — nada é ajustado sozinho; estorno autorizado antes.
  c = await abrir(); p1 = await lancar(c)
  const pg1 = await pagar(c, 5)
  let r8 = await cancelarPedido(p1)
  ok('pago 5 e cancelar o único pedido (novo total 0): cancelamento recusado', !r8.ok && (await ped(p1)).status !== 'cancelado', r8.erro)
  ok('  total e pago intactos, nenhuma auditoria de taxa', n((await totais(c)).total) === +(P + TAXA).toFixed(2) && n((await totais(c)).pago) === 5 && (await aud(c, 'conta.taxa_entrega_nao_cobrada')).length === 0)
  await q(`select public.comanda_estornar_pagamento($1, $2, 'estorno 0099', 'Verif')`, [loja, pg1.r.id])
  r8 = await cancelarPedido(p1)
  ok('depois do estorno autorizado, cancela e a taxa sai', r8.ok && n((await totais(c)).total) === 0 && n((await totais(c)).pago) === 0, r8.erro ?? '')
  f = await fechar(c)
  ok('  e fecha com total 0', f.ok, f.erro ?? '')
  c = await abrir(); p1 = await lancar(c); p2 = await lancar(c)
  await pagar(c, 3)
  r8 = await cancelarPedido(p2)
  ok('pagamento parcial abaixo do novo total: cancela o 2º e a taxa fica (1º ativo)', r8.ok && n((await totais(c)).total) === +(P + TAXA).toFixed(2) && n((await totais(c)).restante) === +(P + TAXA - 3).toFixed(2), r8.erro ?? JSON.stringify(await totais(c)))

  console.log('── 7. sem pagamento: fechamento normal com taxa')
  c = await abrir(); p1 = await lancar(c)
  await pagar(c, +(P + TAXA).toFixed(2))
  f = await fechar(c)
  const cf = await um(`select status, total_final, taxa_entrega_cobrada from comandas where id = $1`, [c])
  ok('conta com item fecha cobrando a taxa; taxa cobrada gravada', f.ok && n(cf.taxa_entrega_cobrada) === TAXA && n(cf.total_final) === +(P + TAXA).toFixed(2), JSON.stringify(cf))
  const re = await tenta(`select public.comanda_reabrir($1, $2, 'teste 0099', $3, $4, 'pdv')`, [loja, c, dono.id, dono.nome])
  ok('reabrir limpa a taxa gravada (volta a valer a regra da conta aberta)', re.ok && (await um(`select taxa_entrega_cobrada t from comandas where id=$1`, [c])).t === null, re.erro ?? '')

  console.log('── histórico (conta fechada antes da 0099)')
  c = await abrir(); p1 = await lancar(c); await cancelarPedido(p1)
  await q(`update comandas set status = 'fechada', fechada_em = now(), total_final = $2 where id = $1`, [c, TAXA])
  await q(`update comandas set taxa_entrega_cobrada = null where id = $1`, [c])
  ok('fechada sem registro da 0099 (como a #8): continua mostrando a taxa como foi cobrada', n((await totais(c)).total) === TAXA, (await totais(c)).total)

  console.log('── simulação do fechamento')
  c = await abrir(); p1 = await lancar(c)
  const sim = (await um(`select public.comanda_fechamento_simular($1, $2, $3) r`, [loja, c, JSON.stringify([{ pedido_id: p1, acao: 'cancelar', motivo: 'simulação 0099' }])])).r
  ok('simular cancelamento mostra taxa 0 e total 0', n(sim.taxa_entrega) === 0 && n(sim.total) === 0, JSON.stringify(sim))
  ok('  e não deixa auditoria nem pedido cancelado', (await aud(c, 'conta.taxa_entrega_nao_cobrada')).length === 0 && (await ped(p1)).status !== 'cancelado')

  console.log('── 11. atendente e gerente')
  for (const ator of [atendente, gerente].filter(Boolean)) {
    c = await abrir({ ator }); p1 = await lancar(c, [1], ator); await cancelarPedido(p1, ator)
    ok(`cancelado por ${ator.nome}: taxa sai e auditoria em nome dele`, n((await totais(c)).total) === 0 && (await aud(c, 'conta.taxa_entrega_nao_cobrada')).length === 1)
  }

  console.log('── 12. isolamento entre lojas')
  c = await abrir(); p1 = await lancar(c)
  const outra = await cancelarPedido(p1, dono, vizinha)
  ok('outra loja não cancela o pedido desta', !outra.ok && (await ped(p1)).status !== 'cancelado', outra.erro)
  ok('  e a taxa continua', n((await totais(c)).total) === +(P + TAXA).toFixed(2))

  console.log('── sem regressão: retirada e mesa')
  c = await abrir({ entrega: false }); p1 = await lancar(c); await cancelarPedido(p1)
  ok('retirada: total 0 e nenhuma auditoria de taxa', n((await totais(c)).total) === 0 && (await aud(c, 'conta.taxa_entrega_nao_cobrada')).length === 0)
  const mesa = await um(`select c.id from comandas c where c.restaurante_id = $1 and c.tipo = 'mesa' and c.status = 'aberta' limit 1`, [loja])
  if (mesa) {
    const t = await totais(mesa.id)
    const base = await um(`select coalesce(sum(i.preco_unitario * i.quantidade), 0) s from pedidos p join pedido_itens i on i.pedido_id = p.id where p.comanda_id = $1 and p.status <> 'cancelado' and i.cancelado_em is null`, [mesa.id])
    ok('mesa: total = itens + serviço − desconto (sem taxa de entrega)', n(t.total) === +(n(base.s) + n(t.taxa_servico) - n(t.desconto)).toFixed(2), JSON.stringify(t))
  }

  const priv = await um(`select bool_or(has_function_privilege('authenticated', f, 'EXECUTE')) p from unnest(array[
    'public.comanda_taxa_entrega_efetiva(uuid)', 'public.pedido_cancelado_taxa_entrega()', 'public.item_cancelado_taxa_entrega()',
    'public.pedido_novo_taxa_entrega()', 'public.comanda_taxa_entrega_no_fechamento()', 'public.comanda_tem_item_ativo(uuid)',
    'public.comanda_entrega_ativa_do_pedido(uuid)']) f`)
  ok('funções novas não são executáveis por authenticated', priv.p === false)
} catch (e) {
  ok('execução', false, e.message)
} finally {
  await db.query('rollback')
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} passaram (transação desfeita)`)
process.exit(falhas ? 1 : 0)
