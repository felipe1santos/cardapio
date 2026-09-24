/**
 * Prova do motor de conta presencial do PDV v2 (0082–0086), direto no Postgres local.
 *
 * Balcão (senha, taxa 0, idempotência), lançamento atômico, transições de cozinha com
 * compare-and-set, trigger de transição, atendimento, pendências, fechamento v2,
 * pagamento com canal/origem, cancelamento pelo atendente x gestão, resolução forçada
 * com efeito financeiro, reabertura, reserva da fila de impressão — e concorrência de
 * verdade com conexões paralelas (dois fechamentos, lançamento durante fechamento,
 * numeração, duas varreduras de impressão).
 *
 * Só loopback. Loja própria (`loja-pdv-v2`), recriada a cada execução. Nenhum dado real.
 *
 *   node scripts/seguranca/verificar-pdv-v2-banco.mjs
 */

import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== null && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)

const novoCliente = async () => {
  const c = new pg.Client({ connectionString: DB_URL })
  await c.connect()
  return c
}
const db = await novoCliente()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]
const erro = async (sql, p = [], cli = db) => {
  try {
    await cli.query(sql, p)
    return null
  } catch (e) {
    return e.message
  }
}
const uuid = () => crypto.randomUUID()
const NOME = 'Operador Teste'

// ── cenário ─────────────────────────────────────────────────────────────────
const loja = (await um(
  `insert into restaurantes (nome, slug, taxa_servico_padrao, pdv_v2, modulo_mesas_ativo)
   values ('Loja PDV v2','loja-pdv-v2', 10, true, true)
   on conflict (slug) do update set taxa_servico_padrao = 10, pdv_v2 = true, modulo_mesas_ativo = true, balcao_seq = 0
   returning id`)).id
const lojaLegado = (await um(
  `insert into restaurantes (nome, slug, taxa_servico_padrao, pdv_v2, modulo_mesas_ativo)
   values ('Loja PDV legado','loja-pdv-legado', 10, false, true)
   on conflict (slug) do update set pdv_v2 = false returning id`)).id
for (const l of [loja, lojaLegado]) {
  await db.query('delete from impressao_reservas where restaurante_id=$1', [l])
  await db.query('delete from solicitacoes_cancelamento where restaurante_id=$1', [l])
  await db.query('delete from pagamentos_comanda where restaurante_id=$1', [l])
  await db.query('delete from pedidos where restaurante_id=$1', [l])
  await db.query('delete from sessoes_mesa where restaurante_id=$1', [l])
  await db.query('delete from comandas where restaurante_id=$1', [l])
  await db.query('delete from mesas where restaurante_id=$1', [l])
  await db.query('delete from eventos_auditoria where restaurante_id=$1', [l])
}
await db.query('update restaurantes set balcao_seq = 0 where id = $1', [loja])
const mesa1 = (await um(`insert into mesas (restaurante_id, nome, ordem) values ($1,'M1',0) returning id`, [loja])).id
const mesaLeg = (await um(`insert into mesas (restaurante_id, nome, ordem) values ($1,'L1',0) returning id`, [lojaLegado])).id

const abrirBalcao = async (nome, tel = null, chave = uuid(), cli = db) =>
  (await cli.query('select comanda_balcao_abrir($1,$2,$3,null,$4,$5) as r', [loja, nome, tel, NOME, chave])).rows[0].r

const itens = (lista) => JSON.stringify(lista.map(([nome, preco, qtd]) => ({ item_id: null, nome, preco_unitario: preco, quantidade: qtd, complementos: [] })))
const lancar = async (comanda, lista, chave = uuid(), cli = db, restaurante = loja) => {
  const sub = lista.reduce((s, [, p, qn]) => s + p * qn, 0)
  return (await cli.query('select comanda_lancar($1,$2,$3,$4,null,$5,$6) as r', [
    restaurante, comanda, JSON.stringify({ subtotal: sub, total: sub }), itens(lista), NOME, chave,
  ])).rows[0].r
}
const pagar = async (comanda, forma, valor, recebido = null, chave = uuid(), origem = 'pdv', obs = null) =>
  (await db.query('select comanda_pagamento_registrar($1,$2,$3,$4,$5,$6,null,$7,$8,$9) as r', [
    loja, comanda, forma, valor, recebido, chave, NOME, obs, origem,
  ])).rows[0].r
const totais = async (comanda) => um('select * from comanda_totais($1)', [comanda])
const status = async (pedido) => um('select status::text, atendimento_status, reimprimir, impresso from pedidos where id=$1', [pedido])
const transicionar = (pedido, de, para, cli = db) =>
  cli.query('select pedido_transicionar($1,$2,$3,$4,null,$5,$6)', [loja, pedido, de, para, NOME, 'pdv'])
const atender = (pedido) => db.query('select pedido_atender($1,$2,null,$3,$4)', [loja, pedido, NOME, 'pdv'])
const fechar = (comanda, cli = db) => cli.query('select comanda_fechar_presencial($1,$2,null,$3,$4) as r', [loja, comanda, NOME, 'pdv'])

// ════════════════════════════════════════════════════════════════════════════
secao('Balcão: abertura')
const b1 = await abrirBalcao('João')
const b2 = await abrirBalcao('  Ana  ', '(27) 99999-0001')
ok('senha sequencial começa em 1 e segue', b1.senha === 1 && b2.senha === 2, `${b1.senha}, ${b2.senha}`)
const cb2 = await um('select tipo, mesa_id, cliente_nome, cliente_telefone, taxa_servico_percentual, status from comandas where id=$1', [b2.id])
ok('comanda de balcão: tipo balcao, sem mesa, nome aparado, telefone normalizado (55 + DDD + número)', cb2.tipo === 'balcao' && cb2.mesa_id === null && cb2.cliente_nome === 'Ana' && cb2.cliente_telefone === '5527999990001')
ok('balcão nasce com taxa 0 mesmo com padrão da loja em 10%', Number(cb2.taxa_servico_percentual) === 0)
ok('mesa continua herdando a taxa padrão', Number((await um(`insert into comandas (restaurante_id, mesa_id, cliente_nome) values ($1,$2,'Cliente Teste') returning taxa_servico_percentual t`, [loja, mesa1])).t) === 10)
await db.query(`delete from comandas where restaurante_id=$1 and tipo='mesa'`, [loja])
const chaveDupla = uuid()
const d1 = await abrirBalcao('Pedro', null, chaveDupla)
const d2 = await abrirBalcao('Pedro', null, chaveDupla)
ok('duplo clique no "Abrir" (mesma chave) não abre duas comandas', d1.id === d2.id && d2.idempotente === true)
ok('nome é obrigatório', /nome_obrigatorio/.test(await erro('select comanda_balcao_abrir($1,$2,null,null,$3,$4)', [loja, '   ', NOME, uuid()])))
ok('telefone inválido é recusado', /telefone_invalido/.test(await erro('select comanda_balcao_abrir($1,$2,$3,null,$4,$5)', [loja, 'X', '123', NOME, uuid()])))
// 0094: telefone informado vincula ao cadastro da MESMA loja (cria uma vez, sem duplicar).
ok('telefone vincula um cadastro em clientes, sem duplicar', Number((await um("select count(*) n from clientes where restaurante_id=$1 and telefone='5527999990001'", [loja])).n) === 1)
const audAbriu = await um(`select dados from eventos_auditoria where restaurante_id=$1 and acao='balcao.abriu' and entidade_id=$2`, [loja, b2.id])
ok('abertura auditada sem o telefone', !!audAbriu && !JSON.stringify(audAbriu.dados).includes('99999'))
ok('balcão e mesa aceitam mais de um balcão aberto por loja', Number((await um(`select count(*) n from comandas where restaurante_id=$1 and tipo='balcao' and status='aberta'`, [loja])).n) >= 3)

// ════════════════════════════════════════════════════════════════════════════
secao('Lançamento atômico')
const chaveL = uuid()
const l1 = await lancar(b1.id, [['X-Burguer', 30, 2], ['Coca', 6, 1]], chaveL)
const ped1 = await um('select canal, origem, mesa, cliente_nome, comanda_id, atendimento_status, status::text, total, numero from pedidos where id=$1', [l1.id])
ok('pedido de balcão: canal balcao, origem pdv, sem mesa, nome da comanda', ped1.canal === 'balcao' && ped1.origem === 'pdv' && ped1.mesa === null && ped1.cliente_nome === 'João')
ok('atendimento inicial = aguardando_retirada', ped1.atendimento_status === 'aguardando_retirada')
ok('itens gravados junto', Number((await um('select count(*) n from pedido_itens where pedido_id=$1', [l1.id])).n) === 2)
const l1b = await lancar(b1.id, [['X-Burguer', 30, 2], ['Coca', 6, 1]], chaveL)
ok('reenvio com a mesma chave devolve o mesmo pedido', l1b.id === l1.id && l1b.idempotente === true)
ok('lançamento sem itens é recusado', /nenhum_item/.test(await erro('select comanda_lancar($1,$2,$3,$4,null,$5,$6)', [loja, b1.id, '{"subtotal":0,"total":0}', '[]', NOME, uuid()])))
const lojaOutra = (await um(`select id from restaurantes where slug='loja-pdv-legado'`)).id
ok('comanda de outra loja é recusada', /comanda_inexistente/.test(await erro('select comanda_lancar($1,$2,$3,$4,null,$5,$6)', [lojaOutra, b1.id, '{"subtotal":1,"total":1}', itens([['A', 1, 1]]), NOME, uuid()])))
ok('insert direto com comanda de outra loja é barrado pela trigger', /comanda_inexistente/.test(await erro(
  `insert into pedidos (restaurante_id, tipo, cliente_nome, origem, canal, comanda_id) values ($1,'retirada','X','pdv','balcao',$2)`, [lojaOutra, b1.id])))
const totB1 = await totais(b1.id)
ok('total do balcão sem taxa de serviço', Number(totB1.total) === 66 && Number(totB1.taxa_servico) === 0, `total ${totB1.total}`)

// ════════════════════════════════════════════════════════════════════════════
secao('Cozinha: transições com compare-and-set')
await transicionar(l1.id, 'recebido', 'preparando')
ok('PDV aceita (recebido → preparando)', (await status(l1.id)).status === 'preparando')
const eConf = await erro('select pedido_transicionar($1,$2,$3,$4,null,$5,$6)', [loja, l1.id, 'recebido', 'preparando', NOME, 'pdv'])
ok('segunda aceitação (aba velha) recebe conflito com o status real', /conflito_status:preparando/.test(eConf ?? ''), eConf)
ok('transição fora da tabela é recusada', /transicao_invalida/.test(await erro('select pedido_transicionar($1,$2,$3,$4,null,$5,$6)', [loja, l1.id, 'preparando', 'entregue', NOME, 'pdv'])))
ok('atender pedido ainda em preparo é recusado', /pedido_nao_pronto:preparando/.test(await erro('select pedido_atender($1,$2,null,$3,$4)', [loja, l1.id, NOME, 'pdv'])))
await transicionar(l1.id, 'preparando', 'pronto')
ok('preparando → pronto', (await status(l1.id)).status === 'pronto')

secao('Trigger de transição (vale para todo caminho)')
await atender(l1.id)
const s1 = await status(l1.id)
ok('entregue no balcão: atendimento entregue_balcao e status entregue (Kanban tira da coluna)', s1.atendimento_status === 'entregue_balcao' && s1.status === 'entregue')
await atender(l1.id)
ok('atender de novo é idempotente', (await status(l1.id)).atendimento_status === 'entregue_balcao')
ok('entregue não volta para preparando (update direto, como uma aba velha do Kanban)', /transicao_invalida:entregue>preparando/.test(await erro(`update pedidos set status='preparando' where id=$1`, [l1.id])))
const lEmRota = await lancar(b1.id, [['Suco', 8, 1]])
ok('presencial não vai para em_rota', /transicao_invalida/.test(await erro(`update pedidos set status='em_rota' where id=$1`, [lEmRota.id])))
await db.query(`update pedidos set reimprimir = true where id=$1`, [lEmRota.id])
await db.query(`update pedidos set status='cancelado' where id=$1`, [lEmRota.id])
ok('cancelar zera reimprimir', (await status(lEmRota.id)).reimprimir === false)
ok('cancelado não ressuscita', /transicao_invalida:cancelado>recebido/.test(await erro(`update pedidos set status='recebido' where id=$1`, [lEmRota.id])))
const pedDel = (await um(`insert into pedidos (restaurante_id, tipo, cliente_nome, canal, status) values ($1,'entrega','Cliente','delivery','entregue') returning id`, [loja])).id
ok('delivery entregue não pode ser cancelado por update direto', /transicao_invalida:entregue>cancelado/.test(await erro(`update pedidos set status='cancelado' where id=$1`, [pedDel])))
const pedDel2 = (await um(`insert into pedidos (restaurante_id, tipo, cliente_nome, canal) values ($1,'entrega','Cliente','delivery') returning id`, [loja])).id
for (const st of ['preparando', 'pronto', 'em_rota', 'entregue']) await db.query(`update pedidos set status=$2 where id=$1`, [pedDel2, st])
ok('fluxo normal de delivery segue funcionando (recebido→…→entregue)', (await status(pedDel2)).status === 'entregue')
ok('delivery sem atendimento (NULL)', (await status(pedDel2)).atendimento_status === null)
await db.query(`delete from pedidos where id = any($1::uuid[])`, [[pedDel, pedDel2]])

// ════════════════════════════════════════════════════════════════════════════
secao('Pendências e fechamento')
const cB = await abrirBalcao('Carla')
const pA = await lancar(cB.id, [['Pastel', 10, 1]])
const pB = await lancar(cB.id, [['Caldo', 15, 1]])
const pC = await lancar(cB.id, [['Pudim', 7, 1]])
await transicionar(pB.id, 'recebido', 'preparando')
await transicionar(pC.id, 'recebido', 'preparando')
await transicionar(pC.id, 'preparando', 'pronto')
await db.query('select cancelamento_solicitar($1,$2,null,$3,null,$4)', [loja, pA.id, 'cliente mudou de ideia', NOME])
const pend = (await um('select comanda_pendencias($1,$2) as r', [loja, cB.id])).r
const cats = Object.fromEntries(pend.pedidos.map((p) => [p.numero, p.categoria]))
ok('pendências por categoria: aguardando aceite, em preparo, pronto não atendido',
  Object.values(cats).sort().join(',') === 'aguardando_aceite,em_preparo,pronto_nao_atendido', JSON.stringify(Object.values(cats)))
ok('cancelamento pendente listado', pend.cancelamentos.length === 1)
ok('financeiro: não pago, restante 32', pend.financeiro.situacao === 'nao_pago' && Number(pend.financeiro.restante) === 32)
ok('bloqueia = true', pend.bloqueia === true)
ok('fechar com cancelamento pendente é recusado', /cancelamento_pendente/.test(await erro('select comanda_fechar_presencial($1,$2,null,$3,$4)', [loja, cB.id, NOME, 'pdv'])))
await db.query('select cancelamento_decidir($1,(select id from solicitacoes_cancelamento where pedido_id=$2),false,null,null,$3)', [loja, pA.id, NOME])
ok('fechar com pedido na cozinha é recusado (pdv_v2)', /pendencias_abertas:3/.test(await erro('select comanda_fechar_presencial($1,$2,null,$3,$4)', [loja, cB.id, NOME, 'pdv'])))
await pagar(cB.id, 'pix', 10)
const pend2 = (await um('select comanda_pendencias($1,$2) as r', [loja, cB.id])).r
ok('pagamento parcial vira "parcial"', pend2.financeiro.situacao === 'parcial' && pend2.parcialmente_pago === true)
ok('forma usada aparece no resumo', pend2.financeiro.formas.some((f) => f.forma === 'pix'))

// ════════════════════════════════════════════════════════════════════════════
secao('Pagamento: canal, origem, idempotência')
const pg1 = await um(`select canal, origem from pagamentos_comanda where comanda_id=$1`, [cB.id])
ok('pagamento do balcão grava canal balcao e origem pdv', pg1.canal === 'balcao' && pg1.origem === 'pdv')
const chaveP = uuid()
const r1 = await pagar(cB.id, 'dinheiro', 5, 10, chaveP)
const r2 = await pagar(cB.id, 'dinheiro', 5, 10, chaveP)
ok('mesma chave não cobra duas vezes; troco calculado no servidor', r1.id === r2.id && r2.idempotente === true && Number(r1.troco) === 5)
ok('chave de outra comanda é recusada (não devolve pagamento alheio)', /chave_em_outra_comanda/.test(await erro(
  'select comanda_pagamento_registrar($1,$2,$3,$4,null,$5,null,$6,null,$7)', [loja, b2.id, 'pix', 1, chaveP, NOME, 'pdv'])))
ok('valor acima do restante é recusado', /valor_acima_do_restante/.test(await erro(
  'select comanda_pagamento_registrar($1,$2,$3,$4,null,$5,null,$6,null,$7)', [loja, cB.id, 'pix', 999, uuid(), NOME, 'pdv'])))
ok('recebido menor que o valor é recusado', /recebido_menor_que_valor/.test(await erro(
  'select comanda_pagamento_registrar($1,$2,$3,$4,$5,$6,null,$7,null,$8)', [loja, cB.id, 'dinheiro', 5, 2, uuid(), NOME, 'pdv'])))
ok('origem inválida é recusada', /origem_invalida/.test(await erro(
  'select comanda_pagamento_registrar($1,$2,$3,$4,null,$5,null,$6,null,$7)', [loja, cB.id, 'pix', 1, uuid(), NOME, 'kanban'])))
const pgLegado = (await um('select comanda_registrar_pagamento($1,$2,$3,$4,null,$5,null,$6,null) as r', [loja, cB.id, 'debito', 1, uuid(), NOME])).r
ok('assinatura antiga do salão continua funcionando (origem salao)', (await um('select origem from pagamentos_comanda where id=$1', [pgLegado.id])).origem === 'salao')
await db.query('select comanda_estornar_pagamento($1,$2,$3,$4)', [loja, pgLegado.id, 'teste de estorno', NOME])

// ════════════════════════════════════════════════════════════════════════════
secao('Cancelamento: atendente x gestão')
const cX = await abrirBalcao('Lia')
const x1 = await lancar(cX.id, [['Café', 5, 1]])
const x2 = await lancar(cX.id, [['Bolo', 9, 1]])
await transicionar(x2.id, 'recebido', 'preparando')
ok('atendente não cancela o que já está em preparo', /cancelamento_requer_gestao/.test(await erro(
  'select pedido_presencial_cancelar($1,$2,$3,null,$4,true,$5)', [loja, x2.id, 'desistiu', NOME, 'pdv'])))
ok('motivo é obrigatório', /motivo_obrigatorio/.test(await erro('select pedido_presencial_cancelar($1,$2,$3,null,$4,true,$5)', [loja, x1.id, ' ', NOME, 'pdv'])))
await db.query('select pedido_presencial_cancelar($1,$2,$3,null,$4,true,$5)', [loja, x1.id, 'cliente desistiu', NOME, 'pdv'])
ok('atendente cancela direto pedido recebido de conta sem pagamento', (await status(x1.id)).status === 'cancelado')
ok('cancelamento auditado com estado anterior e valor', !!(await um(`select 1 from eventos_auditoria where acao='pedido.cancelou' and entidade_id=$1 and dados->>'de'='recebido' and (dados->>'valor_afetado')::numeric = 5`, [x1.id])))
const x3 = await lancar(cX.id, [['Água', 4, 1]])
await pagar(cX.id, 'pix', 2)
ok('com pagamento na conta, atendente só solicita', /cancelamento_requer_gestao/.test(await erro(
  'select pedido_presencial_cancelar($1,$2,$3,null,$4,true,$5)', [loja, x3.id, 'desistiu', NOME, 'pdv'])))
ok('solicitação de cancelamento vale para balcão', !!(await um('select comanda... as r'.replace('comanda... as r', 'cancelamento_solicitar($1,$2,null,$3,null,$4) as r'), [loja, x3.id, 'desistiu', NOME])).r.id)
await db.query('select cancelamento_decidir($1,(select id from solicitacoes_cancelamento where pedido_id=$2 and status=$3),true,null,null,$4)', [loja, x3.id, 'pendente', NOME])
ok('gestão aprova: pedido de balcão cancelado pelo caminho presencial', (await status(x3.id)).status === 'cancelado')
await pagar(cX.id, 'pix', 7)
const eExcede = await erro('select pedido_presencial_cancelar($1,$2,$3,null,$4,false,$5)', [loja, x2.id, 'cozinha errou', NOME, 'pdv'])
ok('gestor cancelando valor já pago é recusado até estornar/ajustar', /pagamento_excede_total/.test(eExcede ?? ''), eExcede)
ok('e nada mudou', (await status(x2.id)).status === 'preparando')

// ════════════════════════════════════════════════════════════════════════════
secao('Resolução forçada (gerente/dono)')
// cB: pA recebido, pB preparando, pC pronto; pago 15 (10 pix + 5 dinheiro), total 32.
ok('motivo curto é recusado', /motivo_obrigatorio/.test(await erro(
  'select comanda_resolver_pendencias($1,$2,$3,$4,null,$5,$6,$7,false)', [loja, cB.id, JSON.stringify([{ pedido_id: pA.id, acao: 'cancelar_pedido' }]), 'x', NOME, 'gerente', 'pdv'])))
const eAjuste = await erro('select comanda_resolver_pendencias($1,$2,$3,$4,null,$5,$6,$7,false)', [loja, cB.id,
  JSON.stringify([{ pedido_id: pB.id, acao: 'cancelar_pedido' }, { pedido_id: pA.id, acao: 'cancelar_pedido' }]), 'cliente foi embora', NOME, 'gerente', 'pdv'])
ok('cancelar abaixo do já pago exige estorno/ajuste, com o excedente', /ajuste_financeiro_necessario:8/.test(eAjuste ?? ''), eAjuste)
ok('e a resolução inteira foi desfeita', (await status(pA.id)).status === 'recebido' && (await status(pB.id)).status === 'preparando')
const rRes = (await um('select comanda_resolver_pendencias($1,$2,$3,$4,null,$5,$6,$7,true) as r', [loja, cB.id, JSON.stringify([
  { pedido_id: pA.id, acao: 'cancelar_pedido' },
  { pedido_id: pB.id, acao: 'forcar_atendido' },
  { pedido_id: pC.id, acao: 'marcar_atendido' },
]), 'cliente com pressa, levou assim', NOME, 'gerente', 'pdv'])).r
ok('resolução aplicada (3 ações)', rRes.aplicadas === 3)
ok('fechamento tentado na mesma chamada: falta receber, mas a resolução fica', rRes.fechamento === null && /saldo_restante/.test(rRes.erro_fechamento ?? ''), rRes.erro_fechamento)
const sB = await um('select status::text, atendimento_status, resolvido_forcado from pedidos where id=$1', [pB.id])
ok('forçar atendido: entregue_balcao + marcado como forçado', sB.atendimento_status === 'entregue_balcao' && sB.status === 'entregue' && sB.resolvido_forcado === true)
ok('auditoria da resolução com estado anterior, novo, motivo e papel', !!(await um(
  `select 1 from eventos_auditoria where acao='pedido.resolucao_forcada' and entidade_id=$1 and dados->'estado_anterior'->>'cozinha'='preparando' and dados->>'papel'='gerente' and dados->>'motivo' like 'cliente%'`, [pB.id])))
const t2 = await totais(cB.id)
await pagar(cB.id, 'credito', Number(t2.restante))
const fechou = (await fechar(cB.id)).rows[0].r
const cBfim = await um('select status, total_final from comandas where id=$1', [cB.id])
ok('fecha quando nada pendente e saldo zero', cBfim.status === 'fechada' && Number(cBfim.total_final) === Number(fechou.total))
ok('atendimentos viram concluido', (await status(pB.id)).atendimento_status === 'concluido' && (await status(pC.id)).atendimento_status === 'concluido')
ok('lançar em comanda fechada é recusado', /comanda_nao_aberta/.test(await erro('select comanda_lancar($1,$2,$3,$4,null,$5,$6)', [loja, cB.id, '{"subtotal":1,"total":1}', itens([['A', 1, 1]]), NOME, uuid()])))

secao('Reabertura')
ok('motivo obrigatório', /motivo_obrigatorio/.test(await erro('select comanda_reabrir($1,$2,$3,null,$4,$5)', [loja, cB.id, '', NOME, 'pdv'])))
await db.query('select comanda_reabrir($1,$2,$3,null,$4,$5)', [loja, cB.id, 'cliente voltou para pedir sobremesa', NOME, 'pdv'])
const cBre = await um('select status, total_final, reaberta_por_nome from comandas where id=$1', [cB.id])
ok('reaberta: status aberta, total_final limpo, quem reabriu gravado', cBre.status === 'aberta' && cBre.total_final === null && cBre.reaberta_por_nome === NOME)
ok('atendimentos concluídos voltam para entregue_balcao', (await status(pC.id)).atendimento_status === 'entregue_balcao')
ok('pagamentos intactos', Number((await totais(cB.id)).pago) === Number(fechou.pago))
ok('reabrir comanda aberta é recusado', /comanda_nao_fechada/.test(await erro('select comanda_reabrir($1,$2,$3,null,$4,$5)', [loja, cB.id, 'de novo aqui', NOME, 'pdv'])))
await fechar(cB.id)

// mesa: reabrir com a mesa já ocupada por outra conta
const cm = (await um(`insert into comandas (restaurante_id, mesa_id, cliente_nome) values ($1,$2,'Cliente Teste') returning id`, [loja, mesa1])).id
await fechar(cm)
// 0095: conta de mesa fechada deixa a mesa em limpeza; liberar antes de abrir outra.
await db.query('select mesa_liberar($1,$2,null,$3,$4)', [loja, mesa1, NOME, 'pdv'])
await um(`insert into comandas (restaurante_id, mesa_id, cliente_nome) values ($1,$2,'Cliente Teste') returning id`, [loja, mesa1])
ok('reabrir conta de mesa com a mesa ocupada é recusado', /mesa_ocupada/.test(await erro('select comanda_reabrir($1,$2,$3,null,$4,$5)', [loja, cm, 'engano no fechamento', NOME, 'pdv'])))

// ════════════════════════════════════════════════════════════════════════════
secao('Loja SEM pdv_v2 (salão como antes)')
const cLeg = (await um(`insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id`, [lojaLegado, mesaLeg])).id
await lancar(cLeg, [['Prato', 20, 1]], uuid(), db, lojaLegado)
await db.query('select comanda_registrar_pagamento($1,$2,$3,$4,null,$5,null,$6,null)', [lojaLegado, cLeg, 'pix', 22, uuid(), NOME])
const eLeg = await erro('select comanda_fechar($1,$2,null,$3)', [lojaLegado, cLeg, NOME])
ok('fecha com pedido ainda na cozinha, exatamente como antes (flag desligada)', eLeg === null, eLeg)

// ════════════════════════════════════════════════════════════════════════════
secao('Concorrência real')
{
  const cc = await abrirBalcao('Concorrência')
  await lancar(cc.id, [['Item', 10, 1]])
  const [pz] = await q('select id from pedidos where comanda_id=$1', [cc.id])
  await transicionar(pz.id, 'recebido', 'preparando')
  await transicionar(pz.id, 'preparando', 'pronto')
  await atender(pz.id)
  await pagar(cc.id, 'pix', 10)
  const [a, b] = [await novoCliente(), await novoCliente()]
  const rs = await Promise.allSettled([fechar(cc.id, a), fechar(cc.id, b)])
  const okCount = rs.filter((r) => r.status === 'fulfilled').length
  const motivo = rs.find((r) => r.status === 'rejected')?.reason?.message
  ok('dois caixas fechando a mesma conta: um fecha, o outro recebe comanda_nao_aberta', okCount === 1 && /comanda_nao_aberta/.test(motivo ?? ''), motivo)
  await a.end(); await b.end()
}
{
  const cc = await abrirBalcao('Lança durante fechamento')
  const [a, b] = [await novoCliente(), await novoCliente()]
  await a.query('begin')
  await a.query('select id from comandas where id=$1 for update', [cc.id])
  await a.query(`update comandas set status='fechada', fechada_em=now() where id=$1`, [cc.id])
  const pend = lancar(cc.id, [['Atrasado', 5, 1]], uuid(), b).then(() => null, (e) => e.message)
  await new Promise((r) => setTimeout(r, 300))
  await a.query('commit')
  const msg = await pend
  ok('lançamento que chega durante o fechamento espera e é recusado', /comanda_nao_aberta/.test(msg ?? ''), msg)
  ok('nenhum pedido entrou na conta fechada', Number((await um('select count(*) n from pedidos where comanda_id=$1', [cc.id])).n) === 0)
  await a.end(); await b.end()
}
{
  const cc = await abrirBalcao('Numeração')
  const clientes = await Promise.all(Array.from({ length: 6 }, novoCliente))
  await Promise.all(clientes.flatMap((c) => Array.from({ length: 4 }, () => lancar(cc.id, [['N', 1, 1]], uuid(), c))))
  const dup = await um(`select count(*) n from (select numero from pedidos where restaurante_id=$1 group by numero having count(*)>1) x`, [loja])
  ok('24 lançamentos simultâneos em 6 conexões: nenhum número repetido', Number(dup.n) === 0)
  ok('índice único de número existe', !!(await um(`select 1 from pg_indexes where indexname='pedidos_numero_unq'`)))
  await Promise.all(clientes.map((c) => c.end()))
}
{
  const cc = await abrirBalcao('Transição concorrente')
  const l = await lancar(cc.id, [['T', 1, 1]])
  const [a, b] = [await novoCliente(), await novoCliente()]
  const rs = await Promise.allSettled([transicionar(l.id, 'recebido', 'preparando', a), transicionar(l.id, 'recebido', 'preparando', b)])
  ok('cozinha e PDV aceitando juntos: um ganha, o outro recebe conflito', rs.filter((r) => r.status === 'fulfilled').length === 1 &&
    /conflito_status/.test(rs.find((r) => r.status === 'rejected')?.reason?.message ?? ''))
  await a.end(); await b.end()
}

// ════════════════════════════════════════════════════════════════════════════
secao('Fila de impressão com reserva')
await db.query(`update pedidos set impresso = true where restaurante_id = $1`, [loja])
const ci = await abrirBalcao('Impressão')
const i1 = await lancar(ci.id, [['I1', 1, 1]])
const i2 = await lancar(ci.id, [['I2', 1, 1]])
const i3 = await lancar(ci.id, [['I3', 1, 1]])
await transicionar(i3.id, 'recebido', 'preparando')
await transicionar(i3.id, 'preparando', 'pronto')
const semItem = (await um(`insert into pedidos (restaurante_id, tipo, cliente_nome, canal) values ($1,'entrega','Sem item','delivery') returning id`, [loja])).id
const cancelado = await lancar(ci.id, [['C', 1, 1]])
await db.query(`update pedidos set status='cancelado' where id=$1`, [cancelado.id])
await db.query(`update pedidos set reimprimir=true where id=$1`, [cancelado.id]).catch(() => {})
{
  const [a, b] = [await novoCliente(), await novoCliente()]
  const [ra, rb] = await Promise.all([
    a.query('select impressao_reservar($1,$2,90) as id', [loja, 'agente-A']),
    b.query('select impressao_reservar($1,$2,90) as id', [loja, 'agente-B']),
  ])
  const idsA = ra.rows.map((r) => r.id)
  const idsB = rb.rows.map((r) => r.id)
  const todos = [...idsA, ...idsB]
  ok('duas varreduras simultâneas: nenhum pedido vai para os dois Assistentes', todos.length === new Set(todos).size, `A=${idsA.length} B=${idsB.length}`)
  ok('pronto não impresso entra na fila', todos.includes(i3.id))
  ok('pedidos recebidos entram', todos.includes(i1.id) && todos.includes(i2.id))
  ok('pedido sem item não entra (gravação pela metade nunca imprime)', !todos.includes(semItem))
  ok('cancelado não entra, nem com reimpressão', !todos.includes(cancelado.id))
  const quem = idsA.includes(i1.id) ? 'agente-A' : 'agente-B'
  const outro = quem === 'agente-A' ? 'agente-B' : 'agente-A'
  const deNovoOutro = (await db.query('select impressao_reservar($1,$2,90) as id', [loja, outro])).rows.map((r) => r.id)
  ok('dentro da reserva, o outro Assistente não recebe o pedido', !deNovoOutro.includes(i1.id))
  const deNovoMesmo = (await db.query('select impressao_reservar($1,$2,90) as id', [loja, quem])).rows.map((r) => r.id)
  ok('o mesmo Assistente revê a própria reserva (para reenviar o "impresso")', deNovoMesmo.includes(i1.id))
  const legado = (await db.query('select impressao_reservar($1,null,90) as id', [loja])).rows.map((r) => r.id)
  ok('Assistente antigo (sem instância) não recebe pedido reservado', !legado.includes(i1.id))
  await db.query('select impressao_confirmar($1,$2)', [loja, i1.id])
  const s = await status(i1.id)
  ok('confirmar marca impresso e libera a reserva', s.impresso === true && !(await um('select 1 from impressao_reservas where pedido_id=$1', [i1.id])))
  await db.query(`update impressao_reservas set reservado_ate = now() - interval '1 second' where pedido_id=$1`, [i2.id])
  const expirou = (await db.query('select impressao_reservar($1,$2,90) as id', [loja, 'agente-C'])).rows.map((r) => r.id)
  ok('reserva expirada volta para a fila (Assistente que caiu não perde pedido)', expirou.includes(i2.id))
  const confirmarOutraLoja = await erro('select impressao_confirmar($1,$2)', [lojaOutra, i2.id])
  ok('confirmação com a loja errada não marca nada', confirmarOutraLoja === null && (await status(i2.id)).impresso === false)
  await a.end(); await b.end()
}
await db.query('delete from pedidos where id=$1', [semItem])

// ════════════════════════════════════════════════════════════════════════════
secao('Permissões de execução')
const expostas = await q(`
  select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname = any($1)
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
  [['comanda_balcao_abrir', 'comanda_lancar', 'comanda_pagamento_registrar', 'comanda_registrar_pagamento', 'pedido_transicionar',
    'pedido_atender', 'pedido_presencial_cancelar', 'comanda_pendencias', 'comanda_fechar_presencial', 'comanda_fechar',
    'comanda_resolver_pendencias', 'comanda_reabrir', 'impressao_reservar', 'impressao_confirmar', 'auditoria_registrar',
    'cancelamento_solicitar', 'cancelamento_decidir']])
ok('nenhuma função do motor é executável por anon/authenticated', expostas.length === 0, expostas.map((r) => r.proname).join(', '))
ok('impressao_reservas sem acesso do navegador', !(await um(`select has_table_privilege('authenticated','public.impressao_reservas','SELECT') s`)).s)
const pub = (await q(`select tablename from pg_publication_tables where pubname='supabase_realtime'`)).map((r) => r.tablename)
ok('comandas e pagamentos no Realtime', pub.includes('comandas') && pub.includes('pagamentos_comanda'))

await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
