/**
 * Cards variados no Kanban da loja local `ordem-qr-e2e` (visual do card, 2026-10-03).
 *   node scripts/seguranca/kanban-cards-semente.mjs criar   → cria os pedidos TESTE Card…
 *   node scripts/seguranca/kanban-cards-semente.mjs limpar  → cancela todos os TESTE Card…
 * Pedidos entram pela vitrine (caminho real) e o banco só ajusta canal/origem/status/horário
 * para cobrir PDV, mesa, colunas e tempos — só loopback.
 */
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
// Itens sem complemento obrigatório (o X-Burger pede o ponto da carne).
const itens = (await db.query(`select id, nome from itens_cardapio where restaurante_id=$1 and status='disponivel' and nome not like 'X-%' order by preco desc`, [loja.id])).rows
const acao = process.argv[2] ?? 'criar'

async function limpar() {
  await db.query(`update pedidos set status='cancelado', cancelado_motivo='teste', cancelado_em=now() where restaurante_id=$1 and cliente_nome like 'TESTE Card%' and status <> 'cancelado'`, [loja.id])
  await db.query(`update comandas set status='cancelada' where restaurante_id=$1 and cliente_nome='TESTE Card Mesa' and status='aberta'`, [loja.id])
}

let seq = 0
async function pedido({ nome, tipo = 'retirada', pagamento = 'pix', troco = null, qtd = [1], ajuste = {}, obsItem = null }) {
  const corpo = {
    tipo, cliente: { nome, telefone: `279999${String(80000 + seq++).padStart(5, '0')}` }, pagamento, trocoPara: troco,
    endereco: tipo === 'entrega' ? { rua: 'Rua Teste', numero: '10', complemento: '', bairro: 'Centro', cep: '29000000', cidade: 'Vitória' } : { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
    itens: qtd.map((q, i) => ({ itemId: itens[i % itens.length].id, quantidade: q, complementos: [] })),
  }
  const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).then(async (x) => ({ s: x.status, j: await x.json().catch(() => ({})) }))
  if (r.s !== 201) throw new Error(`${nome}: ${r.s} ${r.j?.error}`)
  const sets = Object.entries(ajuste).map(([k], i) => `${k} = $${i + 2}`)
  if (sets.length) await db.query(`update pedidos set ${sets.join(', ')} where id = $1`, [r.j.id, ...Object.values(ajuste)])
  if (obsItem) await db.query(`update pedido_itens set observacao=$2 where id = (select id from pedido_itens where pedido_id=$1 order by id limit 1)`, [r.j.id, obsItem])
  return r.j
}

if (acao === 'limpar') {
  await limpar()
} else {
  await limpar()
  const agora = Date.now()
  const ha = (min) => new Date(agora - min * 60_000).toISOString()
  // Recebido
  await pedido({ nome: 'TESTE Card Vitrine Pix', pagamento: 'pix', ajuste: { criado_em: ha(4) } })
  await pedido({ nome: 'TESTE Card Entrega Dinheiro com Troco', tipo: 'entrega', pagamento: 'dinheiro', troco: 200, qtd: [2, 1], obsItem: 'Sem cebola, maionese à parte', ajuste: { criado_em: ha(14), observacao: 'Interfone quebrado: ligar ao chegar' } })
  await pedido({ nome: 'TESTE Card Cliente Com Um Nome Muito Comprido Para Testar O Corte', tipo: 'retirada', pagamento: 'cartao', qtd: [3, 2, 1, 1, 2], ajuste: { criado_em: ha(185) } })
  // Preparando (PDV balcão e mesa)
  await pedido({ nome: 'TESTE Card PDV Balcão', pagamento: 'dinheiro', ajuste: { criado_em: ha(25), status: 'preparando', canal: 'balcao', origem: 'pdv', cliente_telefone: '27992534407' } })
  // Mesa exige comanda: uma comanda de mesa TESTE na Mesa 1 (cancelada no limpar).
  // Mesa própria da semente (outras suítes deixam conta aberta na Mesa 1 — índice de uma conta aberta por mesa).
  const mesa = (await um(`select id from mesas where restaurante_id=$1 and nome='Mesa TESTE Card'`, [loja.id]))
    ?? (await um(`insert into mesas (restaurante_id, nome, ordem) values ($1, 'Mesa TESTE Card', 99) returning id`, [loja.id]))
  const com = await um(`insert into comandas (restaurante_id, tipo, mesa_id, cliente_nome, status) values ($1, 'mesa', $2, 'TESTE Card Mesa', 'aberta') returning id`, [loja.id, mesa.id])
  await pedido({ nome: 'TESTE Card Mesa 4', ajuste: { criado_em: ha(9), status: 'preparando', canal: 'mesa', origem: 'salao', tipo: 'retirada', comanda_id: com.id } })
  await pedido({ nome: 'TESTE Card Valor Alto', pagamento: 'pix', qtd: [40, 30], ajuste: { criado_em: ha(55), status: 'preparando' } })
  // Pronto (parado há 2 dias)
  await pedido({ nome: 'TESTE Card Parado Dois Dias', tipo: 'entrega', pagamento: 'cartao', ajuste: { criado_em: ha(2 * 24 * 60 + 30), status: 'pronto' } })
  await pedido({ nome: 'TESTE Card Retirada Pronta', pagamento: 'dinheiro', ajuste: { criado_em: ha(18), status: 'pronto' } })
}
await db.end()
console.log(acao, 'ok')
