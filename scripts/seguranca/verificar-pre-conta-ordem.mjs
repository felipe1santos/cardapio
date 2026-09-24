/**
 * Ordem determinística da pré-conta (0093), no banco LOCAL, dentro de uma transação
 * que é desfeita no fim (nada fica gravado).
 *
 * Monta uma conta de propósito "embaralhada": ids dos itens em ordem inversa à do
 * lançamento, adicionais gravados fora da ordem do cadastro, pagamentos com ids
 * invertidos e Dinheiro recebido DEPOIS do Pix. Chama o snapshot várias vezes (1ª e
 * 2ª via) e passa cada um pelo formatador real do Assistente.
 *
 *   node scripts/seguranca/verificar-pre-conta-ordem.mjs
 */
import { createRequire } from 'node:module'
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const require = createRequire(import.meta.url)
const { montarPreContaLinhas } = require('../../printer-agent/src/pre-conta.js')
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}
const REPETICOES = 25

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
await db.query('begin')
try {
  // Grava como o servidor grava (service_role): prova que o default da sequência
  // funciona para quem de fato insere itens.
  await db.query('set local role service_role')
  const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
  const item = async (nome) => um('select id, nome from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, nome])
  const BURGER = await item('Burger da Casa')
  const AGUA = await item('Água com Gás')
  const SUCO = await item('Suco de Laranja')
  const FILE = await item('Filé à Parmegiana')

  const comanda = (await um(`insert into comandas (restaurante_id, tipo, status, cliente_nome, aberta_em)
    values ($1, 'balcao', 'aberta', 'Ordem Demonstração', now() - interval '30 minutes') returning id`, [loja])).id
  const pedido = async (minAtras) => (await um(`insert into pedidos (restaurante_id, tipo, status, cliente_nome, cliente_telefone, forma_pagamento, pago,
      subtotal, desconto, taxa_entrega, total, origem, canal, comanda_id, criado_em)
    values ($1, 'retirada', 'recebido', 'Ordem Demonstração', '', 'dinheiro', false, 0, 0, 0, 0, 'pdv', 'balcao', $2, now() - make_interval(mins => $3))
    returning id`, [loja, comanda, minAtras])).id
  const p1 = await pedido(20)
  const p2 = await pedido(10)

  // Lançamento 1 (um insert, como o servidor faz): Burger, Suco, Água — ids decrescentes,
  // para o desempate por id apontar a ordem ERRADA se a coluna de lançamento fosse ignorada.
  // Adicionais gravados na ordem inversa do cadastro.
  const cliques = ['Coca-Cola lata', 'Queijo cheddar', 'Bacon crocante', 'Ao ponto']
  const comps = JSON.stringify(cliques.map((nome) => ({ nome, preco: { 'Coca-Cola lata': 7, 'Queijo cheddar': 6, 'Bacon crocante': 8, 'Ao ponto': 0 }[nome] })))
  await db.query(`insert into pedido_itens (id, pedido_id, item_id, nome, preco_unitario, quantidade, observacao, complementos)
    values ('ffffffff-0000-4000-8000-000000000003', $1, $2, $3, 63, 2, 'Sem cebola', $4::jsonb),
           ('ffffffff-0000-4000-8000-000000000002', $1, $5, $6, 16, 1, '', '[]'),
           ('ffffffff-0000-4000-8000-000000000001', $1, $7, $8, 7, 1, '', '[]')`,
  [p1, BURGER.id, BURGER.nome, comps, SUCO.id, SUCO.nome, AGUA.id, AGUA.nome])
  // Lançamento 2 (depois): Filé e uma Água, com ids MENORES que os do lançamento 1.
  await db.query(`insert into pedido_itens (id, pedido_id, item_id, nome, preco_unitario, quantidade, observacao, complementos)
    values ('00000000-0000-4000-8000-000000000002', $1, $2, $3, 68, 1, '', '[]'),
           ('00000000-0000-4000-8000-000000000001', $1, $4, $5, 7, 3, '', '[]')`, [p2, FILE.id, FILE.nome, AGUA.id, AGUA.nome])

  const seqs = (await db.query(`select lancamento_seq from pedido_itens where pedido_id = any($1) order by lancamento_seq`, [[p1, p2]])).rows
  ok('itens novos gravados pelo service_role recebem número de lançamento', seqs.length === 5 && seqs.every((r) => r.lancamento_seq !== null))

  // Pagamentos: Pix primeiro, Dinheiro depois, Pix de novo; ids invertidos; dois no mesmo instante.
  const pag = (id, forma, valor, minAtras) => db.query(`insert into pagamentos_comanda (id, restaurante_id, comanda_id, forma, valor, criado_por_nome, criado_em)
    values ($1, $2, $3, $4, $5, 'Demo', now() - make_interval(mins => $6))`, [id, loja, comanda, forma, valor, minAtras])
  await pag('ffffffff-0000-4000-8000-00000000000a', 'pix', 50, 9)
  await pag('00000000-0000-4000-8000-00000000000a', 'dinheiro', 30, 5)
  await pag('00000000-0000-4000-8000-00000000000c', 'pix', 10, 2)
  await pag('00000000-0000-4000-8000-00000000000b', 'debito', 5, 2)

  const snap = async (via) => (await um('select public.impressao_snapshot_pre_conta($1, $2, $3) s', [comanda, via, 'Operador Demo'])).s
  const semVia = (s) => JSON.stringify({ ...s, via: null, impresso_em: null })
  const semViaTexto = (s) => montarPreContaLinhas(s).filter((l) => !/(ª via|ª VIA|Impressão:)/.test(l)).join('\n')

  const vias1 = []
  const vias2 = []
  for (let i = 0; i < REPETICOES; i++) {
    vias1.push(await snap(1))
    vias2.push(await snap(2))
  }
  const base = vias1[0]
  console.log('\n── ordem esperada ──')
  const itens = base.itens.map((i) => `${i.quantidade}x ${i.nome}`)
  console.log(`   itens: ${itens.join(' · ')}`)
  ok('itens na ordem do lançamento (pedido 1: Burger, Suco, Água; pedido 2: Filé, Água), não na do id',
    JSON.stringify(itens) === JSON.stringify(['2x Burger da Casa', '1x Suco de Laranja', '1x Água com Gás', '1x Filé à Parmegiana', '3x Água com Gás']))

  const cadastro = (await db.query(`select ic.nome from item_complementos ic left join grupos_item_complementos g on g.id = ic.grupo_id
     where ic.item_id = $1 and ic.nome = any($2) order by g.posicao nulls last, ic.posicao nulls last, ic.id`, [BURGER.id, cliques])).rows.map((r) => r.nome)
  const adicionais = base.itens[0].complementos.map((c) => c.nome)
  console.log(`   adicionais: ${adicionais.join(' · ')}`)
  ok('adicionais na ordem do cadastro (não na do clique)', JSON.stringify(adicionais) === JSON.stringify(cadastro) && JSON.stringify(adicionais) !== JSON.stringify(cliques))

  const pags = base.pagamentos.map((p) => `${p.forma} ${p.valor}`)
  console.log(`   pagamentos: ${pags.join(' · ')}`)
  ok('pagamentos por hora de recebimento, um a um, desempate por id (Dinheiro depois do Pix)',
    JSON.stringify(pags) === JSON.stringify(['pix 50', 'dinheiro 30', 'debito 5', 'pix 10']))

  console.log(`\n── ${REPETICOES} montagens de cada via ──`)
  ok('mesma ordem de itens em todas', vias1.concat(vias2).every((s) => JSON.stringify(s.itens.map((i) => i.nome + i.quantidade)) === JSON.stringify(base.itens.map((i) => i.nome + i.quantidade))))
  ok('mesma ordem de adicionais em todas', vias1.concat(vias2).every((s) => JSON.stringify(s.itens.map((i) => i.complementos)) === JSON.stringify(base.itens.map((i) => i.complementos))))
  ok('mesma ordem de pagamentos em todas', vias1.concat(vias2).every((s) => JSON.stringify(s.pagamentos) === JSON.stringify(base.pagamentos)))
  const valores = (s) => JSON.stringify([s.subtotal, s.taxa, s.desconto, s.pago, s.restante, s.total])
  ok('mesmo subtotal, taxa, desconto, pago, restante e total em todas', vias1.concat(vias2).every((s) => valores(s) === valores(base)), valores(base))
  ok('snapshot inteiro idêntico entre as montagens (fora via e hora)', vias1.concat(vias2).every((s) => semVia(s) === semVia(base)))
  ok('1ª e 2ª via com a mesma composição no papel (só muda a via e a hora)', vias2.every((s) => semViaTexto(s) === semViaTexto(base)))
  const t1 = montarPreContaLinhas(base).join('\n')
  const t2 = montarPreContaLinhas(vias2[0]).join('\n')
  ok('1ª via diz "1ª via" e a 2ª diz "2ª VIA (reimpressão)"', t1.includes('1ª via') && t2.includes('2ª VIA (reimpressão)'))
  const iPix = t1.indexOf('Pix: R$ 50,00')
  const iDin = t1.indexOf('Dinheiro: R$ 30,00')
  ok('no papel, Dinheiro sai depois do Pix', iPix > 0 && iDin > iPix)
} finally {
  await db.query('rollback')
  await db.end()
}
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram (transação desfeita)`)
process.exit(falhas ? 1 : 0)
