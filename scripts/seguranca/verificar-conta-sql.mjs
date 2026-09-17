/**
 * Prova das funções de conta da 0067, direto no Postgres local (sem API, sem tela).
 *
 * Totais, taxa de serviço, desconto, pagamento parcial, troco, idempotência, fechamento
 * com e sem saldo, transferência de mesa (livre e ocupada), transferência de itens e
 * cancelamento de item. Só loopback.
 *
 *   node scripts/seguranca/verificar-conta-sql.mjs
 */

import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]
const falha = async (sql, p = []) => {
  try {
    await db.query(sql, p)
    return null
  } catch (e) {
    return e.message
  }
}

// ── cenário ─────────────────────────────────────────────────────────────────
const loja = (await um(
  `insert into restaurantes (nome, slug, taxa_servico_padrao) values ('Loja Conta','loja-conta', 10)
   on conflict (slug) do update set taxa_servico_padrao = 10 returning id`)).id
await db.query('delete from pedidos where restaurante_id=$1', [loja])
await db.query('delete from sessoes_mesa where restaurante_id=$1', [loja])
await db.query('delete from comandas where restaurante_id=$1', [loja])
await db.query('delete from mesas where restaurante_id=$1', [loja])

const mesa = async (nome) => (await um(`insert into mesas (restaurante_id, nome, ordem) values ($1,$2,0) returning id`, [loja, nome])).id
const [m1, m2, m3, m4] = [await mesa('M1'), await mesa('M2'), await mesa('M3'), await mesa('M4')]
const ATOR = null
const NOME = 'Garçom Teste'

/** Pedido de mesa com itens [nome, preço unitário, quantidade]. */
async function lancar(comanda, mesaNome, itens) {
  const p = (await um(
    `insert into pedidos (restaurante_id, tipo, status, cliente_nome, origem, canal, mesa, comanda_id)
     values ($1,'retirada','recebido',$2,'pdv','mesa',$2,$3) returning id`, [loja, mesaNome, comanda])).id
  for (const [nome, preco, qtd] of itens) {
    await db.query(`insert into pedido_itens (pedido_id, nome, preco_unitario, quantidade) values ($1,$2,$3,$4)`, [p, nome, preco, qtd])
  }
  await db.query('select public.pedido_recalcular($1)', [p])
  return p
}
const totais = (c) => um('select * from public.comanda_totais($1)', [c])
const n = (v) => Number(v)

// ════════════════════════════════════════════════════════════════════════════
secao('totais, taxa de serviço e desconto')
const c1 = (await um(`insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id, taxa_servico_percentual`, [loja, m1]))
ok('comanda nova herda a taxa de serviço da loja', n(c1.taxa_servico_percentual) === 10, c1.taxa_servico_percentual)
const p1 = await lancar(c1.id, 'M1', [['Risoto', 54, 1], ['Água', 7, 2]])
let t = await totais(c1.id)
ok('subtotal soma itens × quantidade', n(t.subtotal) === 68, t.subtotal)
ok('taxa de 10% sobre o subtotal', n(t.taxa_servico) === 6.8, t.taxa_servico)
ok('total = subtotal + taxa', n(t.total) === 74.8, t.total)

await db.query('update comandas set desconto_valor = 4.8 where id=$1', [c1.id])
t = await totais(c1.id)
ok('desconto abate do total', n(t.total) === 70, t.total)
await db.query('update comandas set desconto_valor = 9999 where id=$1', [c1.id])
t = await totais(c1.id)
ok('desconto nunca deixa a conta negativa', n(t.total) === 0, t.total)
await db.query('update comandas set desconto_valor = 0 where id=$1', [c1.id])

// ════════════════════════════════════════════════════════════════════════════
secao('pagamentos')
const pag = (forma, valor, recebido, chave) =>
  db.query('select public.comanda_registrar_pagamento($1,$2,$3,$4,$5,$6,$7,$8) as r', [loja, c1.id, forma, valor, recebido, chave, ATOR, NOME])

const r1 = (await pag('pix', 30, null, 'k1')).rows[0].r
t = await totais(c1.id)
ok('pagamento parcial abate do restante', n(t.pago) === 30 && n(t.restante) === 44.8, `pago ${t.pago}, restante ${t.restante}`)

const r1b = (await pag('pix', 30, null, 'k1')).rows[0].r
t = await totais(c1.id)
ok('mesma chave não cobra de novo', r1b.idempotente === true && r1b.id === r1.id && n(t.pago) === 30)

ok('pagar acima do restante é recusado',
  (await falha('select public.comanda_registrar_pagamento($1,$2,$3,$4,$5,$6,$7,$8)', [loja, c1.id, 'credito', 100, null, 'k2', ATOR, NOME]))?.includes('valor_acima_do_restante'))

ok('forma desconhecida é recusada',
  (await falha('select public.comanda_registrar_pagamento($1,$2,$3,$4,$5,$6,$7,$8)', [loja, c1.id, 'bitcoin', 1, null, 'k3', ATOR, NOME]))?.includes('forma_invalida'))

ok('dinheiro recebido menor que o valor é recusado',
  (await falha('select public.comanda_registrar_pagamento($1,$2,$3,$4,$5,$6,$7,$8)', [loja, c1.id, 'dinheiro', 20, 10, 'k4', ATOR, NOME])) !== null)

const r2 = (await pag('dinheiro', 20, 50, 'k5')).rows[0].r
ok('dinheiro calcula o troco', n(r2.troco) === 30, r2.troco)

// Estorno
ok('estorno sem motivo é recusado',
  (await falha('select public.comanda_estornar_pagamento($1,$2,$3,$4)', [loja, r2.id, '', NOME]))?.includes('motivo_obrigatorio'))
await db.query('select public.comanda_estornar_pagamento($1,$2,$3,$4)', [loja, r2.id, 'Lançado errado', NOME])
t = await totais(c1.id)
ok('estorno devolve o valor ao restante, sem apagar a linha',
  n(t.pago) === 30 && (await um('select estornado_em from pagamentos_comanda where id=$1', [r2.id])).estornado_em !== null)

// ════════════════════════════════════════════════════════════════════════════
secao('fechamento')
ok('fechar com saldo é recusado',
  (await falha('select public.comanda_fechar($1,$2,$3,$4)', [loja, c1.id, ATOR, NOME]))?.includes('saldo_restante'))

await db.query(`insert into sessoes_mesa (restaurante_id, mesa_id, comanda_id) values ($1,$2,$3)`, [loja, m1, c1.id])
await pag('credito', 44.8, null, 'k6')
const fech = (await db.query('select public.comanda_fechar($1,$2,$3,$4) as r', [loja, c1.id, ATOR, NOME])).rows[0].r
const c1f = await um('select status, total_final, fechada_por_nome from comandas where id=$1', [c1.id])
ok('com a conta quitada, fecha', c1f.status === 'fechada' && n(c1f.total_final) === 74.8, `${c1f.status} ${c1f.total_final}`)
ok('pedidos da comanda ficam pagos', (await um('select pago from pedidos where id=$1', [p1])).pago === true)
ok('a sessão da mesa encerra', (await um(`select count(*)::int n from sessoes_mesa where mesa_id=$1 and status='aberta'`, [m1])).n === 0)
ok('fechar de novo é recusado',
  (await falha('select public.comanda_fechar($1,$2,$3,$4)', [loja, c1.id, ATOR, NOME]))?.includes('comanda_nao_aberta'))
ok('pagar comanda fechada é recusado',
  (await falha('select public.comanda_registrar_pagamento($1,$2,$3,$4,$5,$6,$7,$8)', [loja, c1.id, 'pix', 1, null, 'k7', ATOR, NOME]))?.includes('comanda_nao_aberta'))

// ════════════════════════════════════════════════════════════════════════════
secao('transferir a mesa inteira')
const c2 = (await um(`insert into comandas (restaurante_id, mesa_id, pessoas) values ($1,$2,2) returning id`, [loja, m2])).id
await lancar(c2, 'M2', [['Filé', 68, 1]])
await db.query(`insert into sessoes_mesa (restaurante_id, mesa_id, comanda_id) values ($1,$2,$3)`, [loja, m2, c2])

const tr1 = (await db.query('select public.mesa_transferir($1,$2,$3,$4,$5,$6) as r', [loja, m2, m3, false, ATOR, NOME])).rows[0].r
const c2d = await um('select mesa_id, status from comandas where id=$1', [c2])
ok('destino livre: a comanda inteira muda de mesa', c2d.mesa_id === m3 && c2d.status === 'aberta' && tr1.mesclou === false)
const sessAntiga = await um(`select status, transferida_para_mesa_id from sessoes_mesa where mesa_id=$1 order by aberta_em desc limit 1`, [m2])
ok('a sessão da mesa antiga encerra apontando a nova', sessAntiga.status === 'encerrada' && sessAntiga.transferida_para_mesa_id === m3)
ok('a mesa nova ganha sessão aberta', (await um(`select count(*)::int n from sessoes_mesa where mesa_id=$1 and status='aberta'`, [m3])).n === 1)

const c4 = (await um(`insert into comandas (restaurante_id, mesa_id, pessoas) values ($1,$2,3) returning id`, [loja, m4])).id
await lancar(c4, 'M4', [['Burger', 42, 1]])
const totalAntes = n((await totais(c2)).total) + n((await totais(c4)).total)

ok('destino ocupado SEM confirmação é recusado',
  (await falha('select public.mesa_transferir($1,$2,$3,$4,$5,$6)', [loja, m3, m4, false, ATOR, NOME]))?.includes('destino_ocupado'))
ok('...e nada mudou', (await um('select mesa_id from comandas where id=$1', [c2])).mesa_id === m3)

const tr2 = (await db.query('select public.mesa_transferir($1,$2,$3,$4,$5,$6) as r', [loja, m3, m4, true, ATOR, NOME])).rows[0].r
ok('com confirmação, junta as duas contas', tr2.mesclou === true && tr2.comanda === c4)
const origem = await um('select status, transferida_para from comandas where id=$1', [c2])
ok('a comanda de origem fica marcada como transferida (não some)', origem.status === 'transferida' && origem.transferida_para === c4)
ok('o total somado se preserva', n((await totais(c4)).total) === totalAntes, `${totalAntes} → ${(await totais(c4)).total}`)
ok('as pessoas somam', (await um('select pessoas from comandas where id=$1', [c4])).pessoas === 5)
ok('a transferência foi auditada', (await um(`select count(*)::int n from eventos_auditoria where acao='mesa.mesclou' and entidade_id=$1`, [c4])).n === 1)

// ════════════════════════════════════════════════════════════════════════════
secao('transferir itens específicos')
const c5 = (await um(`insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id`, [loja, m1])).id
const p5 = await lancar(c5, 'M1', [['Cerveja', 12, 1], ['Porção', 38, 1], ['Refri', 8, 1]])
const itens5 = await q('select id, nome from pedido_itens where pedido_id=$1 order by nome', [p5])
const cerveja = itens5.find((i) => i.nome === 'Cerveja').id
const refri = itens5.find((i) => i.nome === 'Refri').id
const somaAntes = n((await totais(c5)).total) + n((await totais(c4)).total)

const ti = (await db.query('select public.itens_transferir($1,$2,$3,$4,$5) as r', [loja, [cerveja, refri], m4, ATOR, NOME])).rows[0].r
ok('dois de três itens foram para a outra mesa', ti.itens === 2 && ti.comanda === c4)
const origemP5 = await um('select subtotal, total, comanda_id from pedidos where id=$1', [p5])
ok('o pedido de origem ficou só com a porção e foi recalculado', n(origemP5.total) === 38 && origemP5.comanda_id === c5, origemP5.total)
const novo = await um(`select p.id, p.total, p.impresso, p.canal from pedidos p join pedido_itens i on i.pedido_id=p.id where i.id=$1`, [cerveja])
ok('nasceu um pedido no destino com os itens movidos', novo.id !== p5 && n(novo.total) === 20 && novo.canal === 'mesa', novo.total)
ok('o pedido novo não vai para a impressora (a cozinha já fez)', novo.impresso === true)
ok('a soma das duas contas se preserva', n((await totais(c5)).total) + n((await totais(c4)).total) === somaAntes)

// ════════════════════════════════════════════════════════════════════════════
secao('cancelar item')
const porcao = itens5.find((i) => i.nome === 'Porção').id
ok('cancelar sem motivo é recusado',
  (await falha('select public.item_cancelar($1,$2,$3,$4)', [loja, porcao, '  ', NOME]))?.includes('motivo_obrigatorio'))
const pp = await lancar(c5, 'M1', [['Sobremesa', 20, 1], ['Café', 6, 1]])
const [sobremesa, cafe] = (await q('select id from pedido_itens where pedido_id=$1 order by nome desc', [pp])).map((i) => i.id)
await db.query('select public.item_cancelar($1,$2,$3,$4)', [loja, sobremesa, 'Cliente desistiu', 'Gerente'])
const itemC = await um('select cancelado_em, cancelado_motivo, cancelado_por_nome from pedido_itens where id=$1', [sobremesa])
ok('item cancelado fica registrado com motivo e autor (não é apagado)', itemC.cancelado_em && itemC.cancelado_motivo === 'Cliente desistiu' && itemC.cancelado_por_nome === 'Gerente')
ok('o pedido é recalculado sem o item', n((await um('select total from pedidos where id=$1', [pp])).total) === 6)
const ultimo = (await db.query('select public.item_cancelar($1,$2,$3,$4) as r', [loja, cafe, 'Quebrou', 'Gerente'])).rows[0].r
ok('cancelar o último item cancela o pedido inteiro', ultimo.pedido_cancelado === true && (await um('select status from pedidos where id=$1', [pp])).status === 'cancelado')
ok('pedido cancelado sai da conta', n((await totais(c5)).subtotal) === 38, (await totais(c5)).subtotal)

// ════════════════════════════════════════════════════════════════════════════
secao('ninguém chama as funções de fora')
for (const f of ['comanda_fechar(uuid,uuid,uuid,text)', 'mesa_transferir(uuid,uuid,uuid,boolean,uuid,text)', 'comanda_registrar_pagamento(uuid,uuid,text,numeric,numeric,text,uuid,text)']) {
  const nome = f.split('(')[0]
  const podeAnon = (await um(`select has_function_privilege('anon', 'public.${f}', 'execute') as p`)).p
  const podeAuth = (await um(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as p`)).p
  ok(`${nome}: anon e authenticated sem execute`, !podeAnon && !podeAuth)
}

await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram\n`)
process.exit(falhas ? 1 : 0)
