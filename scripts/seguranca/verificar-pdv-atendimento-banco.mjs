/**
 * Atendimento identificado, entrega manual, fechamento completo e mesa em limpeza
 * (0094–0096), direto nas funções do banco LOCAL. Lojas de teste próprias (criadas e
 * limpas aqui), nenhum dado real.
 *
 *   node scripts/seguranca/verificar-pdv-atendimento-banco.mjs
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
const q = async (sql, p = [], cli = db) => (await cli.query(sql, p)).rows
const um = async (sql, p = [], cli = db) => (await q(sql, p, cli))[0]
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

// ── cenário: duas lojas de teste (A com pdv_v2, B outra loja) ────────────────
const criarLoja = async (slug, v2) =>
  (await um(
    `insert into restaurantes (nome, slug, taxa_servico_padrao, pdv_v2, modulo_mesas_ativo, taxa_entrega_padrao)
     values ($1, $2, 10, $3, true, 6)
     on conflict (slug) do update set taxa_servico_padrao = 10, pdv_v2 = $3, modulo_mesas_ativo = true, balcao_seq = 0
     returning id`, [`Loja ${slug}`, slug, v2])).id
const loja = await criarLoja('loja-atendimento', true)
const lojaB = await criarLoja('loja-atendimento-b', true)
for (const l of [loja, lojaB]) {
  for (const t of ['impressao_reservas', 'solicitacoes_cancelamento', 'pagamentos_comanda', 'cupom_usos']) await db.query(`delete from ${t} where restaurante_id=$1`, [l])
  await db.query('update mesas set limpeza_comanda_id = null where restaurante_id=$1', [l])
  await db.query('delete from pedidos where restaurante_id=$1', [l])
  await db.query('delete from chamados_mesa where restaurante_id=$1', [l])
  await db.query('delete from sessoes_mesa where restaurante_id=$1', [l])
  await db.query('delete from comandas where restaurante_id=$1', [l])
  await db.query('delete from mesas where restaurante_id=$1', [l])
  await db.query('delete from clientes where restaurante_id=$1', [l])
  await db.query('delete from cupons where restaurante_id=$1', [l])
  await db.query('delete from eventos_auditoria where restaurante_id=$1', [l])
}
const mesa = async (nome, l = loja) => (await um(`insert into mesas (restaurante_id, nome, ordem) values ($1,$2,0) returning id`, [l, nome])).id
const [M1, M2, M3, M4, M5, M6] = [await mesa('M1'), await mesa('M2'), await mesa('M3'), await mesa('M4'), await mesa('M5'), await mesa('M6')]

const abrirBalcao = (nome, tel = null, entrega = null, chave = uuid(), cli = db, l = loja) =>
  um('select comanda_balcao_abrir($1,$2,$3,null,$4,$5,$6,$7) as r', [l, nome, tel, NOME, chave, entrega ? JSON.stringify(entrega) : null, 'pdv'], cli).then((x) => x.r)
const abrirMesa = (m, nome, tel = null, chave = uuid(), cli = db, l = loja) =>
  um('select comanda_mesa_abrir($1,$2,$3,$4,null,$5,$6,$7) as r', [l, m, nome, tel, NOME, chave, 'pdv'], cli).then((x) => x.r)
const itens = (lista) => JSON.stringify(lista.map(([nome, preco, qtd]) => ({ item_id: null, nome, preco_unitario: preco, quantidade: qtd, complementos: [] })))
const lancar = (comanda, lista, via = 'pdv', chave = uuid(), l = loja) => {
  const sub = lista.reduce((s, [, p, qn]) => s + p * qn, 0)
  return um('select comanda_lancar($1,$2,$3,$4,null,$5,$6,$7) as r', [l, comanda, JSON.stringify({ subtotal: sub, total: sub }), itens(lista), NOME, chave, via]).then((x) => x.r)
}
const totais = (c) => um('select * from comanda_totais($1)', [c])
const fecharCompleto = (c, acoes = [], pags = [], chave = uuid(), cli = db, l = loja) =>
  um('select comanda_fechar_completo($1,$2,$3,$4,null,$5,$6,$7,$8) as r', [l, c, JSON.stringify(acoes), JSON.stringify(pags), NOME, 'gerente', 'pdv', chave], cli).then((x) => x.r)
const pag = (forma, valor) => ({ forma, valor, chave: uuid() })

// ════════════════════════════════════════════════════════════════════════════
secao('Card preto — balcão, telefone e cliente')
ok('2/3. nome vazio ou só espaços é recusado no banco', /nome_obrigatorio/.test(await erro('select comanda_balcao_abrir($1,$2,null,null,$3,$4,null,$5)', [loja, '    ', NOME, uuid(), 'pdv'])))
const b1 = await abrirBalcao('Ana Sem Telefone')
const cb1 = await um('select cliente_nome, cliente_telefone, cliente_id, entrega, senha from comandas where id=$1', [b1.id])
ok('4. nome sem telefone é aceito (sem cadastro)', cb1.cliente_nome === 'Ana Sem Telefone' && cb1.cliente_telefone === null && cb1.cliente_id === null && !cb1.entrega)
const b2 = await abrirBalcao('Bruno', '(27) 99999-0001')
const cb2 = await um('select cliente_telefone, cliente_id from comandas where id=$1', [b2.id])
ok('5. telefone normalizado (55 + DDD + número)', cb2.cliente_telefone === '5527999990001')
ok('13. cliente novo criado na loja', Number((await um("select count(*) n from clientes where restaurante_id=$1 and telefone='5527999990001'", [loja])).n) === 1 && !!cb2.cliente_id)
const b3 = await abrirBalcao('Bruno de novo', '27 99999 0001')
const b4 = await abrirBalcao('Bruno com DDI', '+55 27 99999-0001')
const ids = await q('select cliente_id from comandas where id = any($1)', [[b2.id, b3.id, b4.id]])
ok('12/13. máscara, espaços e +55 caem no MESMO cliente (sem duplicar)', new Set(ids.map((r) => r.cliente_id)).size === 1
  && Number((await um('select count(*) n from clientes where restaurante_id=$1', [loja])).n) === 1)
ok('cliente existente mantém o nome original (não é sobrescrito)', (await um("select nome from clientes where restaurante_id=$1 and telefone='5527999990001'", [loja])).nome === 'Bruno')
ok('14. sem telefone nunca vincula por nome', (await um('select count(*) n from comandas where restaurante_id=$1 and cliente_nome like $2 and cliente_id is not null and cliente_telefone is null', [loja, 'Ana%'])).n === '0')
ok('telefone inválido é recusado', /telefone_invalido/.test(await erro('select comanda_balcao_abrir($1,$2,$3,null,$4,$5,null,$6)', [loja, 'X', '123', NOME, uuid(), 'pdv'])))

// 6. dois balcões ao mesmo tempo (duas conexões)
const c1 = await novoCliente()
const c2 = await novoCliente()
const [p1, p2] = await Promise.all([abrirBalcao('Carla', null, null, uuid(), c1), abrirBalcao('Diego', null, null, uuid(), c2)])
await Promise.all([lancar(p1.id, [['Suco', 10, 1]]), lancar(p2.id, [['Pastel', 8, 2]])])
const t1 = await totais(p1.id)
const t2 = await totais(p2.id)
ok('6. dois balcões simultâneos: senhas e contas separadas', p1.senha !== p2.senha && Number(t1.total) === 10 && Number(t2.total) === 16)
const peds = await q('select cliente_nome, comanda_id from pedidos where comanda_id = any($1)', [[p1.id, p2.id]])
ok('   cada pedido com o nome do seu atendimento', peds.every((p) => (p.comanda_id === p1.id ? p.cliente_nome === 'Carla' : p.cliente_nome === 'Diego')))

// 7/8. telefone + entrega
const ENT = { cep: '29000000', rua: 'Rua Demo', numero: '10', complemento: 'Ap 2', bairro: 'Centro', cidade: 'Vitória', referencia: 'Portão azul', observacao: 'Tocar interfone', taxa: 7.5, taxa_manual: true }
ok('entrega sem rua/número/bairro é recusada', /endereco_incompleto/.test(await erro('select comanda_balcao_abrir($1,$2,$3,null,$4,$5,$6,$7)', [loja, 'Eva', '27999990002', NOME, uuid(), JSON.stringify({ ...ENT, rua: ' ' }), 'pdv'])))
const e1 = await abrirBalcao('Eva Entrega', '27999990002', ENT)
const ce1 = await um('select * from comandas where id=$1', [e1.id])
ok('7/8. pedido por telefone com entrega: dados salvos no formato do delivery', ce1.entrega && ce1.entrega_rua === 'Rua Demo' && ce1.entrega_numero === '10'
  && ce1.entrega_complemento === 'Ap 2' && ce1.entrega_bairro === 'Centro' && ce1.entrega_cidade === 'Vitória' && ce1.entrega_referencia === 'Portão azul'
  && ce1.entrega_observacao === 'Tocar interfone' && Number(ce1.taxa_entrega) === 7.5 && ce1.taxa_entrega_manual && ce1.entrega_cep === '29000000')
const le1 = await lancar(e1.id, [['Pizza', 50, 1]])
const pe1 = await um('select * from pedidos where id=$1', [le1.id])
ok('9. pedido manual nasce na cozinha (recebido, não impresso) e está na fila', pe1.status === 'recebido' && pe1.impresso === false
  && (await q('select * from impressao_elegiveis($1)', [loja])).some((x) => Object.values(x).includes(le1.id)))
ok('   pedido de entrega: tipo entrega, origem pdv, canal balcão, endereço e taxa', pe1.tipo === 'entrega' && pe1.origem === 'pdv' && pe1.canal === 'balcao'
  && pe1.endereco_rua === 'Rua Demo' && pe1.endereco_bairro === 'Centro' && Number(pe1.taxa_entrega) === 7.5 && Number(pe1.total) === 57.5 && pe1.cliente_telefone === '5527999990002')
ok('   total da conta inclui a taxa de entrega uma vez', Number((await totais(e1.id)).total) === 57.5)
const le2 = await lancar(e1.id, [['Refri', 6, 1]])
ok('   segundo lançamento não cobra a taxa de novo', Number((await um('select taxa_entrega from pedidos where id=$1', [le2.id])).taxa_entrega) === 0 && Number((await totais(e1.id)).total) === 63.5)
for (const st of ['preparando', 'pronto', 'em_rota', 'entregue']) await db.query('update pedidos set status=$2 where id=$1', [le1.id, st])
ok('10. entrega manual segue para logística (pronto → em rota → entregue)', (await um('select status::text s from pedidos where id=$1', [le1.id])).s === 'entregue')
const lb = await lancar(b1.id, [['Café', 5, 1]])
await db.query("update pedidos set status='preparando' where id=$1", [lb.id])
await db.query("update pedidos set status='pronto' where id=$1", [lb.id])
// Entrega manual SEM telefone: aceita; snapshot de nome e endereço, sem cliente.
const es = await abrirBalcao('Entrega Sem Tel', null, { ...ENT, taxa: 5, taxa_manual: true })
const ces = await um('select entrega, cliente_telefone, cliente_id, entrega_rua from comandas where id=$1', [es.id])
ok('entrega manual sem telefone: aceita, com endereço e sem cliente vinculado', ces.entrega && ces.cliente_telefone === null && ces.cliente_id === null && ces.entrega_rua === 'Rua Demo')
const les = await lancar(es.id, [['Lanche', 20, 1]])
ok('   pedido de entrega sem telefone: tipo entrega, telefone vazio', (await um('select tipo, cliente_telefone from pedidos where id=$1', [les.id])).tipo === 'entrega'
  && (await um('select cliente_telefone from pedidos where id=$1', [les.id])).cliente_telefone === '')
const cupomSemTel = (await um(`insert into cupons (restaurante_id, codigo, ativo, tipo, valor, publico, uso_unico_por_cliente, max_usos)
  values ($1,'SEMTEL',true,'desconto_valor',5,'todos',true,5) returning id`, [loja])).id
ok('   sem telefone: cupom recusado', /cupom_exige_telefone/.test(await erro('select comanda_cupom_aplicar($1,$2,$3,null,$4,$5)', [loja, es.id, cupomSemTel, NOME, 'pdv'])))
await db.query("update pedidos set status='entregue' where id=$1", [les.id])
await fecharCompleto(es.id, [], [pag('dinheiro', Number((await totais(es.id)).total))])
ok('   sem telefone: fecha, sem fidelidade', (await um('select comanda_fidelidade_marcar($1,$2) r', [loja, es.id])).r === null
  && (await um('select fidelidade_processado f from comandas where id=$1', [es.id])).f === false)
ok('entrega manual COM telefone: cliente vinculado na loja', !!(await um('select cliente_id from comandas where id=$1', [e1.id])).cliente_id
  && (await um('select c.telefone from comandas co join clientes c on c.id = co.cliente_id where co.id=$1', [e1.id])).telefone === '5527999990002')
ok('11. balcão sem entrega não vai para em rota', /transicao_invalida/.test(await erro("update pedidos set status='em_rota' where id=$1", [lb.id])))
ok('15. histórico: pedidos com telefone normalizado do cliente', (await um('select cliente_telefone from pedidos where id=$1', [le2.id])).cliente_telefone === '5527999990002')

// ════════════════════════════════════════════════════════════════════════════
secao('Mesas — nome obrigatório e concorrência')
ok('18. mesa sem nome é recusada (função)', /nome_obrigatorio/.test(await erro('select comanda_mesa_abrir($1,$2,$3,null,null,$4,$5,$6)', [loja, M1, '  ', NOME, uuid(), 'pdv'])))
ok('18. mesa sem nome é recusada (insert direto, qualquer caminho)', /nome_obrigatorio/.test(await erro('insert into comandas (restaurante_id, mesa_id) values ($1,$2)', [loja, M1])))
const m1 = await abrirMesa(M1, 'Fernanda')
ok('19. mesa com nome e sem telefone abre', !!m1.id && (await um('select cliente_nome, cliente_telefone from comandas where id=$1', [m1.id])).cliente_telefone === null)
const lm1 = await lancar(m1.id, [['Prato', 40, 1]], 'pdv')
const pm1 = await um('select cliente_nome, mesa, lancado_via from pedidos where id=$1', [lm1.id])
ok('   pedidos seguintes reutilizam o nome; lançamento marcado PDV', pm1.cliente_nome === 'Fernanda' && pm1.mesa === 'M1' && pm1.lancado_via === 'pdv')
const chaveM = uuid()
const [r1, r2] = await Promise.all([
  erro('select comanda_mesa_abrir($1,$2,$3,null,null,$4,$5,$6)', [loja, M2, 'Gabi', NOME, uuid(), 'pdv'], c1),
  erro('select comanda_mesa_abrir($1,$2,$3,null,null,$4,$5,$6)', [loja, M2, 'Hugo', NOME, uuid(), 'pdv'], c2),
])
ok('20. dois operadores abrindo a mesma mesa: um abre, o outro recebe mesa_ocupada', [r1, r2].filter((x) => x === null).length === 1 && [r1, r2].some((x) => /mesa_ocupada/.test(x ?? '')))
ok('   uma comanda só na mesa', Number((await um("select count(*) n from comandas where mesa_id=$1 and status='aberta'", [M2])).n) === 1)
const d1 = await abrirMesa(M3, 'Iris', null, chaveM)
const d2 = await abrirMesa(M3, 'Iris', null, chaveM)
ok('   clique duplo (mesma chave): mesma comanda', d1.id === d2.id && d2.idempotente === true)
ok('corrigir nome/telefone (auditado, sem telefone na auditoria)', (await um('select comanda_identificar($1,$2,$3,$4,null,$5,$6) r', [loja, m1.id, 'Fernanda Souza', '27988887777', NOME, 'pdv'])).r.idempotente === false
  && (await um('select cliente_nome, cliente_telefone from pedidos where id=$1', [lm1.id])).cliente_telefone === '5527988887777')
const aud = await q("select dados::text d from eventos_auditoria where restaurante_id=$1 and acao in ('comanda.identificou','balcao.abriu','mesa.abriu','balcao.entrega_ativada')", [loja])
ok('   auditoria sem telefone nem endereço completo', aud.length > 0 && aud.every((a) => !/9999900|9888877|Rua Demo|Ap 2/.test(a.d)))

// 21/22. comanda antiga sem nome
await db.query('update restaurantes set pdv_v2=false where id=$1', [loja])
const antiga = (await um('insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id', [loja, M4])).id
await db.query('update restaurantes set pdv_v2=true where id=$1', [loja])
ok('21. comanda antiga sem nome continua legível', !!(await um('select id, cliente_nome from comandas where id=$1', [antiga])) && (await um('select comanda_pendencias($1,$2) p', [loja, antiga])).p.sem_nome === true)
ok('22. comanda antiga exige nome antes do próximo lançamento', /comanda_sem_nome/.test(await erro('select comanda_lancar($1,$2,$3,$4,null,$5,$6,$7)', [loja, antiga, '{"subtotal":1,"total":1}', itens([['X', 1, 1]]), NOME, uuid(), 'pdv'])))
ok('   … e antes de fechar', /comanda_sem_nome/.test(await erro('select comanda_fechar_completo($1,$2,$3,$4,null,$5,$6,$7,$8)', [loja, antiga, '[]', '[]', NOME, 'gerente', 'pdv', uuid()])))
await um('select comanda_identificar($1,$2,$3,null,null,$4,$5) r', [loja, antiga, 'Nome Informado', NOME, 'pdv'])
ok('   com o nome informado, lança normalmente', !!(await lancar(antiga, [['X', 1, 1]])).id)

// ════════════════════════════════════════════════════════════════════════════
secao('Fechamento completo')
// 23. sem pendências
const f1 = await abrirMesa(M5, 'João')
const lf1 = await lancar(f1.id, [['Prato', 30, 1]])
await db.query("update pedidos set status='entregue' where id=$1", [lf1.id])
const tf1 = await totais(f1.id)
const rf1 = await fecharCompleto(f1.id, [], [pag('pix', Number(tf1.total))])
ok('23. fechamento sem pendências (paga e fecha junto)', rf1.idempotente === false && (await um('select status from comandas where id=$1', [f1.id])).status === 'fechada')
ok('32. mesa fechada entra em limpeza', !!(await um('select limpeza_desde from mesas where id=$1', [M5])).limpeza_desde && rf1.em_limpeza === true)
ok('   limpeza guarda cliente e quem fechou', (await um('select limpeza_cliente_nome n, limpeza_fechada_por_nome f from mesas where id=$1', [M5])).n === 'João')
ok('30. clique duplo no fechamento: mesma chave = mesma resposta, nada duplicado', (await fecharCompleto(f1.id, [], [pag('pix', 1)], (await um('select chave_fechamento from comandas where id=$1', [f1.id])).chave_fechamento)).idempotente === true
  && Number((await um('select count(*) n from pagamentos_comanda where comanda_id=$1', [f1.id])).n) === 1)

// 33/34. limpeza bloqueia tudo
ok('33. mesa em limpeza recusa nova comanda', /mesa_em_limpeza/.test(await erro('select comanda_mesa_abrir($1,$2,$3,null,null,$4,$5,$6)', [loja, M5, 'Outro', NOME, uuid(), 'pdv'])))
ok('33. … recusa insert direto', /mesa_em_limpeza/.test(await erro("insert into comandas (restaurante_id, mesa_id, cliente_nome) values ($1,$2,'X')", [loja, M5])))
ok('33/34. … recusa sessão do QR', /mesa_em_limpeza/.test(await erro('insert into sessoes_mesa (restaurante_id, mesa_id) values ($1,$2)', [loja, M5])))
ok('34. … recusa chamado do QR', /mesa_em_limpeza/.test(await erro('select chamado_abrir($1,$2,null,$3,30,15)', [loja, M5, 'garcom'])))
const transf = await abrirMesa(M6, 'Transferência')
ok('   … recusa transferência de conta para ela', /mesa_em_limpeza/.test(await erro('update comandas set mesa_id=$2 where id=$1', [transf.id, M5])))

// 37. bloqueada enquanto em limpeza: liberar não desbloqueia
await db.query('update mesas set bloqueada_em=now() where id=$1', [M5])
const lib1 = await um('select mesa_liberar($1,$2,null,$3,$4) r', [loja, M5, NOME, 'pdv'])
ok('37. mesa bloqueada: liberar a limpeza não a torna livre', lib1.r.estado === 'bloqueada' && /mesa_indisponivel/.test(await erro('select comanda_mesa_abrir($1,$2,$3,null,null,$4,$5,$6)', [loja, M5, 'Z', NOME, uuid(), 'pdv'])))
await db.query('update mesas set bloqueada_em=null where id=$1', [M5])
const lib2 = await um('select mesa_liberar($1,$2,null,$3,$4) r', [loja, M5, NOME, 'pdv'])
ok('35. liberar de novo é idempotente', lib2.r.idempotente === true)
ok('36. mesa volta a abrir atendimento', !!(await abrirMesa(M5, 'Novo Cliente')).id)
ok('   liberação registrada (quem e quando) e auditada', !!(await um('select liberada_em, liberada_por_nome from mesas where id=$1', [M5])).liberada_por_nome
  && Number((await um("select count(*) n from eventos_auditoria where restaurante_id=$1 and acao='mesa.liberou'", [loja])).n) === 1)

// 24–29. pendências no fechamento
// Conta aberta no teste 20 (M2).
const conta = (await um("select id from comandas where mesa_id=$1 and status='aberta'", [M2])).id
await db.query("update comandas set cliente_nome = coalesce(cliente_nome, 'Gabi') where id=$1", [conta])
const pa = await lancar(conta, [['Aguardando aceite', 20, 1]])
const pb = await lancar(conta, [['Em preparo', 30, 1], ['Suco', 10, 1]])
const pc = await lancar(conta, [['Pronto', 15, 1]])
await db.query("update pedidos set status='preparando' where id=$1", [pb.id])
await db.query("update pedidos set status='preparando' where id=$1", [pc.id])
await db.query("update pedidos set status='pronto' where id=$1", [pc.id])
ok('fechar com pendência sem decisão é recusado', /pendencias_abertas/.test(await erro('select comanda_fechar_completo($1,$2,$3,$4,null,$5,$6,$7,$8)', [loja, conta, '[]', '[]', NOME, 'gerente', 'pdv', uuid()])))
ok('27. cancelar sem motivo é recusado', /motivo_obrigatorio/.test(await erro('select comanda_fechar_completo($1,$2,$3,$4,null,$5,$6,$7,$8)', [loja, conta,
  JSON.stringify([{ pedido_id: pa.id, acao: 'cancelar' }]), '[]', NOME, 'gerente', 'pdv', uuid()])))
const acoes = [
  { pedido_id: pa.id, acao: 'entregue' },
  { pedido_id: pb.id, acao: 'cancelar', motivo: 'Cliente desistiu do prato' },
  { pedido_id: pc.id, acao: 'entregue' },
]
const sim = (await um('select comanda_fechamento_simular($1,$2,$3) r', [loja, conta, JSON.stringify(acoes)])).r
ok('28. simulação recalcula (cancelado sai do total) e desfaz', Number(sim.subtotal) === 35 && Number(sim.cancelados) === 40
  && (await um('select status::text s from pedidos where id=$1', [pb.id])).s === 'preparando')
// 29. pagamento parcial em duas formas + excedente
await db.query("select comanda_pagamento_registrar($1,$2,'dinheiro',60,null,$3,null,$4,null,'pdv')", [loja, conta, uuid(), NOME])
const ex = await erro('select comanda_fechar_completo($1,$2,$3,$4,null,$5,$6,$7,$8)', [loja, conta, JSON.stringify(acoes), '[]', NOME, 'gerente', 'pdv', uuid()])
ok('pago acima do novo total: nada é aplicado (estorno antes)', /ajuste_financeiro_necessario/.test(ex ?? '') && (await um('select status::text s from pedidos where id=$1', [pb.id])).s === 'preparando')
const pgId = (await um('select id from pagamentos_comanda where comanda_id=$1', [conta])).id
await db.query('select comanda_estornar_pagamento($1,$2,$3,$4)', [loja, pgId, 'Valor errado', NOME])
const tsim = Number((await um('select comanda_fechamento_simular($1,$2,$3) r', [loja, conta, JSON.stringify(acoes)])).r.total)
const chaveF = uuid()
const [fa, fb] = await Promise.all([
  fecharCompleto(conta, acoes, [pag('pix', 20), pag('dinheiro', Math.round((tsim - 20) * 100) / 100)], chaveF, c1).then(() => 'ok', (e) => e.message),
  fecharCompleto(conta, acoes, [pag('credito', tsim)], uuid(), c2).then(() => 'ok', (e) => e.message),
])
ok('31. dois operadores fechando juntos: um fecha, o outro recebe comanda_nao_aberta', [fa, fb].filter((x) => x === 'ok').length === 1 && [fa, fb].some((x) => /comanda_nao_aberta/.test(x)))
const pagsConta = await q('select forma, valor from pagamentos_comanda where comanda_id=$1 and estornado_em is null', [conta])
ok('   só os pagamentos de quem fechou valeram', fa === 'ok' ? pagsConta.length === 2 : pagsConta.length === 1)
ok('29. pagamento em duas formas (Pix + dinheiro) quando ele venceu', fa !== 'ok' || pagsConta.map((p) => p.forma).sort().join() === 'dinheiro,pix')
const est = await q('select id, status::text s, resolvido_forcado f from pedidos where id = any($1)', [[pa.id, pb.id, pc.id]])
const st = Object.fromEntries(est.map((x) => [x.id, x]))
ok('24/26. aguardando aceite → marcado entregue (forçado, auditado)', st[pa.id].s === 'entregue' && st[pa.id].f === true)
ok('25/27. em preparo → cancelado com motivo', st[pb.id].s === 'cancelado' && (await um('select cancelado_observacao o from pedidos where id=$1', [pb.id])).o === 'Cliente desistiu do prato')
ok('   pronto → entregue normal (não forçado)', st[pc.id].s === 'entregue' && st[pc.id].f === false)
ok('28. conta fechada pelo total recalculado', Number((await um('select total_final from comandas where id=$1', [conta])).total_final) === tsim)
const audF = await q("select acao from eventos_auditoria where restaurante_id=$1 and (entidade_id = $2 or entidade_id = any($3))", [loja, conta, [pa.id, pb.id, pc.id]])
ok('   auditoria: decisões, pagamentos, fechamento e limpeza', ['pedido.entregue_forcado', 'pedido.cancelou', 'pedido.atendido', 'conta.pagamento', 'conta.fechou'].every((a) => audF.some((x) => x.acao === a)))

// reabrir devolve a mesa
await db.query('select comanda_reabrir($1,$2,$3,null,$4,$5)', [loja, conta, 'Engano no fechamento', NOME, 'pdv'])
ok('reabrir a conta tira a mesa da limpeza (volta ocupada)', (await um('select limpeza_desde from mesas where id=$1', [M2])).limpeza_desde === null)

// ════════════════════════════════════════════════════════════════════════════
secao('Cupom, fidelidade e transferência')
const cupom = (await um(`insert into cupons (restaurante_id, codigo, ativo, tipo, valor, publico, uso_unico_por_cliente, max_usos)
  values ($1,'PDV10',true,'desconto_percentual',10,'todos',true,5) returning id`, [loja])).id
const cc = await abrirBalcao('Cliente Cupom', '27977776666')
await lancar(cc.id, [['Combo', 100, 1]])
ok('cupom exige telefone na conta', /cupom_exige_telefone/.test(await erro('select comanda_cupom_aplicar($1,$2,$3,null,$4,$5)', [loja, b1.id, cupom, NOME, 'pdv'])))
await db.query('select comanda_cupom_aplicar($1,$2,$3,null,$4,$5)', [loja, cc.id, cupom, NOME, 'pdv'])
ok('16. cupom aplicado vira desconto calculado no banco', Number((await totais(cc.id)).desconto) === 10 && Number((await um('select usos from cupons where id=$1', [cupom])).usos) === 0)
const lcc = (await um("select id from pedidos where comanda_id=$1", [cc.id])).id
await db.query("update pedidos set status='entregue' where id=$1", [lcc])
await fecharCompleto(cc.id, [], [pag('pix', Number((await totais(cc.id)).total))])
ok('   uso do cupom contado no fechamento, uma vez', Number((await um('select usos from cupons where id=$1', [cupom])).usos) === 1 && Number((await um('select count(*) n from cupom_usos where cupom_id=$1', [cupom])).n) === 1)
await db.query('select comanda_reabrir($1,$2,$3,null,$4,$5)', [loja, cc.id, 'Conferência', NOME, 'pdv'])
await fecharCompleto(cc.id, [], [])
ok('46. reabrir e fechar de novo não usa o cupom de novo', Number((await um('select usos from cupons where id=$1', [cupom])).usos) === 1)
const f1a = await um('select comanda_fidelidade_marcar($1,$2) r', [loja, cc.id])
const f1b = await um('select comanda_fidelidade_marcar($1,$2) r', [loja, cc.id])
ok('17. fidelidade: a conta conta uma vez (trava no banco)', !!f1a.r && Number(f1a.r.subtotal) === 100 && f1b.r === null)
ok('   conta sem telefone não gera fidelidade', (await um('select comanda_fidelidade_marcar($1,$2) r', [loja, f1.id])).r === null)
const ajuste = await abrirBalcao('Ajuste', '27966665555')
await lancar(ajuste.id, [['Item', 50, 1]])
await db.query('select comanda_cupom_aplicar($1,$2,$3,null,$4,$5)', [loja, ajuste.id, cupom, NOME, 'pdv'])
await db.query("update comandas set desconto_tipo='valor', desconto_valor=2, desconto_percentual=0 where id=$1", [ajuste.id])
ok('desconto mexido à mão tira o cupom da conta (não cobra uso sem desconto)', (await um('select cupom_id from comandas where id=$1', [ajuste.id])).cupom_id === null)
// transferência para mesa livre leva o nome
const trf = (await um("select id from pedido_itens where pedido_id=$1", [lm1.id])).id
const M7 = await mesa('M7')
await db.query('select itens_transferir($1,$2,$3,null,$4,null,$5)', [loja, [trf], M7, NOME, 'Mudou de mesa'])
ok('transferência de item para mesa livre leva o nome do atendimento', !!(await um("select c.cliente_nome from comandas c join mesas m on m.id=c.mesa_id where m.nome='M7' and c.status='aberta'")).cliente_nome)

// ════════════════════════════════════════════════════════════════════════════
secao('Outra loja (isolamento)')
ok('39. abrir mesa de outra loja: não existe', /mesa_inexistente/.test(await erro('select comanda_mesa_abrir($1,$2,$3,null,null,$4,$5,$6)', [lojaB, M1, 'Intruso', NOME, uuid(), 'pdv'])))
ok('39. corrigir conta de outra loja: não existe', /comanda_inexistente/.test(await erro('select comanda_identificar($1,$2,$3,null,null,$4,$5)', [lojaB, m1.id, 'Intruso', NOME, 'pdv'])))
ok('39. liberar mesa de outra loja: não existe', /mesa_inexistente/.test(await erro('select mesa_liberar($1,$2,null,$3,$4)', [lojaB, M5, NOME, 'pdv'])))
ok('39. fechar conta de outra loja: não existe', /comanda_inexistente/.test(await erro('select comanda_fechar_completo($1,$2,$3,$4,null,$5,$6,$7,$8)', [lojaB, m1.id, '[]', '[]', NOME, 'gerente', 'pdv', uuid()])))
const bB = await abrirBalcao('Bruno na B', '27999990001', null, uuid(), db, lojaB)
ok('   mesmo telefone em outra loja = outro cadastro (sem cruzar)', (await um('select cliente_id from comandas where id=$1', [bB.id])).cliente_id !== cb2.cliente_id)
ok('funções novas só para o servidor (nada para anon/authenticated)', (await q(`select proname, proacl::text a from pg_proc where pronamespace='public'::regnamespace and proname in
  ('comanda_mesa_abrir','comanda_identificar','mesa_liberar','comanda_fechar_completo','comanda_fechamento_simular','comanda_cupom_aplicar','comanda_cupom_remover','comanda_fidelidade_marcar','cliente_vincular')`))
  .every((f) => !/(^|,)(anon|authenticated|)=/.test(f.a.replace(/[{}]/g, ''))))

await Promise.all([c1.end(), c2.end()])
await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
