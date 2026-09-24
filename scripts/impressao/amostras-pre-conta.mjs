/**
 * Amostras da pré-conta com a ordem determinística (0093), montadas pela função REAL do
 * banco local dentro de uma transação desfeita no fim — nenhum dado fica gravado,
 * nenhum trabalho de impressão é criado, nenhum Assistente participa.
 *
 * Mesa (Varanda 01, taxa 10%, desconto R$ 5, item cancelado, Pix R$ 50 e depois
 * Dinheiro R$ 30, saldo em aberto) e balcão (Crédito R$ 20), 1ª e 2ª via, 58 e 80 mm:
 * PNG (print.ps1 -DebugPng), PDF e TXT, mais o snapshot usado (JSON).
 *
 *   node scripts/impressao/amostras-pre-conta.mjs <pasta>
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'
import { renderizarPng, pngsParaPdf } from './renderizar-virtual.mjs'

const require = createRequire(import.meta.url)
const { montarPreConta, colsPreConta } = require('../../printer-agent/src/pre-conta.js')
const DIR = process.argv[2]
if (!DIR) throw new Error('uso: amostras-pre-conta.mjs <pasta>')
mkdirSync(DIR, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)

const legivel = (t) => t.split('\n').map((l) => {
  const m = l.match(/^\x01(\w)(?:\x02(.*))?$/)
  if (!m) return l
  const campos = (m[2] ?? '').split('\x02')
  if (m[1] === 'R') return '-'.repeat(32)
  if (m[1] === 'H') return `==== ${campos[0]} ====`
  return campos.join('   ')
}).join('\n')

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const snaps = {}
await db.query('begin')
try {
  await db.query('set local role service_role')
  const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
  const item = async (nome) => um('select id, nome from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, nome])
  const [AGUA, SUCO, PIZZA, BURGER, FILE] = await Promise.all(['Água com Gás', 'Suco de Laranja', 'Pizza Grande', 'Burger da Casa', 'Filé à Parmegiana'].map(item))
  const mesa = await um(`select id from mesas where restaurante_id=$1 and nome='Varanda 01'`, [loja])
  const comanda = async (tipo, extra) => (await um(`insert into comandas (restaurante_id, tipo, status, mesa_id, cliente_nome, taxa_servico_percentual, desconto_tipo, desconto_valor, aberta_em)
    values ($1, $2, 'aberta', $3, $4, $5, 'valor', $6, now() - interval '40 minutes') returning id`, [loja, tipo, extra.mesa ?? null, extra.cliente ?? null, extra.taxa, extra.desconto])).id
  const pedido = async (c, canal, min) => (await um(`insert into pedidos (restaurante_id, tipo, status, cliente_nome, cliente_telefone, forma_pagamento, pago,
      subtotal, desconto, taxa_entrega, total, origem, canal, comanda_id, criado_em)
    values ($1, 'retirada', 'recebido', 'Demonstração', '', 'dinheiro', false, 0, 0, 0, 0, 'pdv', $2, $3, now() - make_interval(mins => $4)) returning id`, [loja, canal, c, min])).id
  // Um lançamento = um insert, na ordem do lançamento (como o servidor grava).
  const lancar = (p, linhas) => db.query(`insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade, observacao, complementos,
      tamanho_nome, sabor_nome, borda_nome, massa_nome, cancelado_em)
    select $1, x.item_id, x.nome, x.preco_unitario, x.quantidade, coalesce(x.observacao, ''), coalesce(x.complementos, '[]'), coalesce(x.tamanho_nome, ''),
      coalesce(x.sabor_nome, ''), coalesce(x.borda_nome, ''), coalesce(x.massa_nome, ''), x.cancelado_em
      from jsonb_to_recordset($2::jsonb) as x(item_id uuid, nome text, preco_unitario numeric, quantidade int, observacao text, complementos jsonb,
        tamanho_nome text, sabor_nome text, borda_nome text, massa_nome text, cancelado_em timestamptz)`, [p, JSON.stringify(linhas)])
  const pagar = (c, forma, valor, min) => db.query(`insert into pagamentos_comanda (restaurante_id, comanda_id, forma, valor, criado_por_nome, criado_em)
    values ($1, $2, $3, $4, 'Atendente Demo', now() - make_interval(mins => $5))`, [loja, c, forma, valor, min])

  // Mesa: mesmo conteúdo da demonstração virtual; adicionais gravados na ordem do CLIQUE.
  const cm = await comanda('mesa', { mesa: mesa.id, taxa: 10, desconto: 5 })
  const pm = await pedido(cm, 'mesa', 30)
  await lancar(pm, [
    { item_id: AGUA.id, nome: AGUA.nome, preco_unitario: 7, quantidade: 1 },
    { item_id: SUCO.id, nome: SUCO.nome, preco_unitario: 16, quantidade: 1, tamanho_nome: '500 ml' },
    { item_id: PIZZA.id, nome: PIZZA.nome, preco_unitario: 83, quantidade: 1, tamanho_nome: 'Grande', sabor_nome: 'Calabresa / Portuguesa', borda_nome: 'Catupiry', massa_nome: 'Fina' },
    { item_id: BURGER.id, nome: BURGER.nome, preco_unitario: 63, quantidade: 2, observacao: 'Sem cebola, pão bem tostado',
      complementos: [{ nome: 'Coca-Cola lata', preco: 7 }, { nome: 'Queijo cheddar', preco: 6 }, { nome: 'Bacon crocante', preco: 8 }, { nome: 'Ao ponto', preco: 0 }] },
    { item_id: FILE.id, nome: FILE.nome, preco_unitario: 68, quantidade: 1, cancelado_em: new Date().toISOString() },
  ])
  await pagar(cm, 'pix', 50, 20)
  await pagar(cm, 'dinheiro', 30, 10)

  // Balcão: dois lançamentos, pagamento parcial no crédito.
  const cb = await comanda('balcao', { cliente: 'Conceição Demonstração', taxa: 0, desconto: 0 })
  await lancar(await pedido(cb, 'balcao', 25), [
    { item_id: FILE.id, nome: FILE.nome, preco_unitario: 68, quantidade: 1 },
    { item_id: AGUA.id, nome: AGUA.nome, preco_unitario: 7, quantidade: 2 },
  ])
  await lancar(await pedido(cb, 'balcao', 15), [{ item_id: SUCO.id, nome: SUCO.nome, preco_unitario: 12, quantidade: 1, tamanho_nome: '300 ml' }])
  await pagar(cb, 'credito', 20, 5)

  for (const [nome, c] of [['mesa', cm], ['balcao', cb]]) {
    for (const via of [1, 2]) snaps[`${nome}-via${via}`] = (await um('select public.impressao_snapshot_pre_conta($1, $2, $3) s', [c, via, 'Atendente Demo'])).s
  }
} finally {
  await db.query('rollback')
  await db.end()
}

const pdfs = []
for (const [nome, s] of Object.entries(snaps)) {
  writeFileSync(join(DIR, `${nome}.snapshot.json`), JSON.stringify(s, null, 2))
  for (const paperMm of [58, 80]) {
    const base = join(DIR, `pre-conta-${nome}-${paperMm}mm`)
    const texto = montarPreConta(s)
    writeFileSync(`${base}.txt`, legivel(texto), 'utf8')
    renderizarPng(texto, { cols: colsPreConta(paperMm), paperMm, saida: `${base}.png` })
    pdfs.push({ png: `${base}.png`, pdf: `${base}.pdf`, paperMm })
  }
}
await pngsParaPdf(pdfs)
console.log(`${pdfs.length} amostras em ${DIR} (transação desfeita)`)
