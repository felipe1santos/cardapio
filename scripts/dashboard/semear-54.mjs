/**
 * Semente LOCAL do item 54 (Dashboard geral em abas). Cria lojas próprias, recriadas a cada rodada:
 *   dash54-loja        — loja "real": ~30 pedidos em endereços reais de Vila Velha (5 bairros), clientes novos e
 *                        recorrentes, Pix/cartão/dinheiro, entrega e retirada, cliques variados na vitrine.
 *   dash54-sem-pedidos — loja com endereço e nenhum pedido (o mapa enquadra a loja).
 *   dash54-sem-bairro  — pedidos sem bairro (ranking vazio, mapa sem contorno).
 *   menuzia            — loja de teste local (o slug que o Dashboard trata como teste).
 * `--com-teste` acrescenta pedidos de TESTE na dash54-loja e na menuzia (para conferir a limpeza).
 *
 *   node scripts/dashboard/semear-54.mjs [--com-teste]
 */
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais } from '../seguranca/chaves-locais.mjs'

const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
if (!/127\.0\.0\.1|localhost/.test(DB_URL)) throw new Error('só no banco local')
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const sb = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
const SENHA = 'demo-local-123456'
const COM_TESTE = process.argv.includes('--com-teste')
const DIA = 86_400_000

async function loja(slug, nome, endereco) {
  const id = (await um(`select id from restaurantes where slug=$1`, [slug]))?.id
  if (id) {
    for (const t of ['pedido_itens_custo']) await db.query(`delete from ${t} where restaurante_id=$1`, [id]).catch(() => {})
    await db.query(`delete from pedido_itens where pedido_id in (select id from pedidos where restaurante_id=$1)`, [id])
    await db.query(`delete from pedidos where restaurante_id=$1`, [id])
    await db.query(`delete from vitrine_eventos where restaurante_id=$1`, [id])
    await db.query(`delete from itens_cardapio where restaurante_id=$1`, [id])
    await db.query(`delete from grupos_cardapio where restaurante_id=$1`, [id])
  }
  const r = await um(`insert into restaurantes (nome, slug, status_loja, telefone, cep, endereco, endereco_rua, endereco_numero, endereco_bairro, endereco_cidade, endereco_estado)
    values ($1,$2,'aberto_manual','27999990000',$3,$4,$5,$6,$7,'Vila Velha','ES')
    on conflict (slug) do update set nome=excluded.nome, cep=excluded.cep, endereco=excluded.endereco, endereco_rua=excluded.endereco_rua, endereco_numero=excluded.endereco_numero, endereco_bairro=excluded.endereco_bairro
    returning id`, [nome, slug, endereco.cep, endereco.texto, endereco.rua, endereco.numero, endereco.bairro])
  return r.id
}
async function dono(login, restauranteId) {
  const email = `${login}@dash54.local`
  const { data, error } = await sb.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  let uid = data?.user?.id
  if (!uid) { const { data: l } = await sb.auth.admin.listUsers({ perPage: 1000 }); uid = l.users.find((u) => u.email === email).id }
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,'dono',$3,$4,$5,true)
    on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel='dono', autorizado=true, usuario=excluded.usuario`, [uid, restauranteId, `Dono ${login}`, email, login])
}

const ENDERECO_LOJA = { cep: '29101-010', texto: 'Av. Champagnat, 1000 - Centro, Vila Velha - ES', rua: 'Avenida Champagnat', numero: '1000', bairro: 'Centro' }
// Endereços reais de Vila Velha (rua, número, bairro).
const ENDERECOS = [
  ['Avenida Hugo Musso', '1200', 'Praia da Costa'], ['Rua Henrique Moscoso', '850', 'Praia da Costa'], ['Avenida Antônio Gil Veloso', '2000', 'Praia da Costa'],
  ['Rua Quinze de Novembro', '300', 'Praia da Costa'], ['Avenida Champagnat', '600', 'Centro'], ['Rua Cabo Aylson Simões', '400', 'Centro'],
  ['Avenida Luciano das Neves', '1500', 'Centro'], ['Rua Itapemirim', '50', 'Itapuã'], ['Avenida Estudante José Júlio de Souza', '3000', 'Itapuã'],
  ['Rua Castelo Branco', '1400', 'Itapuã'], ['Avenida Carioca', '700', 'Glória'], ['Rua Santa Rosa', '120', 'Glória'], ['Avenida Jerônimo Monteiro', '900', 'Glória'],
  ['Rua Inácio Higino', '200', 'Praia de Itaparica'],
]
const CLIENTES = ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Alves', 'Eva Rocha', 'Fábio Nunes', 'Gabi Torres', 'Hugo Matos', 'Iara Pinto', 'João Melo', 'Kátia Reis', 'Leo Cruz']

async function cardapio(L) {
  const g1 = (await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,'Lanches',0) returning id`, [L])).id
  const g2 = (await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,'Bebidas',1) returning id`, [L])).id
  const item = async (g, nome, preco) => ({ id: (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status, tipo_item) values ($1,$2,$3,$4,'disponivel','simples') returning id`, [L, g, nome, preco])).id, nome, preco })
  return [await item(g1, 'X-Bacon', 32), await item(g1, 'X-Salada', 26), await item(g1, 'Smash Duplo', 38), await item(g2, 'Refrigerante Lata', 7), await item(g2, 'Suco Natural', 10)]
}

async function pedido(L, itens, { cliente, telefone, endereco, tipo, forma, diasAtras, hora, status = 'entregue', observacao = '' }) {
  const linhas = itens.map(([it, q]) => ({ it, q }))
  const subtotal = linhas.reduce((s, l) => s + l.it.preco * l.q, 0)
  const taxa = tipo === 'entrega' ? 6 : 0
  const quando = new Date(Date.now() - diasAtras * DIA); quando.setHours(hora, 15, 0, 0)
  const p = await um(`insert into pedidos (restaurante_id, status, tipo, cliente_nome, cliente_telefone, forma_pagamento, subtotal, taxa_entrega, desconto, total,
      endereco_rua, endereco_numero, endereco_bairro, endereco_cidade, criado_em, origem, canal, observacao)
    values ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12,'Vila Velha',$13,'cardapio','delivery',$14) returning id`,
    [L, status, tipo, cliente, telefone, forma, subtotal, taxa, subtotal + taxa, endereco?.[0] ?? '', endereco?.[1] ?? '', endereco?.[2] ?? '', quando.toISOString(), observacao])
  for (const l of linhas) await db.query(`insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade) values ($1,$2,$3,$4,$5)`, [p.id, l.it.id, l.it.nome, l.it.preco, l.q])
}

async function pedidosReais(L, itens, { semBairro = false } = {}) {
  const formas = ['pix', 'cartao', 'dinheiro']
  for (let i = 0; i < 30; i++) {
    const c = i % CLIENTES.length // os primeiros clientes voltam (recorrentes)
    const e = ENDERECOS[(i * 5) % ENDERECOS.length]
    const tipo = i % 4 === 3 ? 'retirada' : 'entrega'
    await pedido(L, [[itens[i % 3], 1 + (i % 2)], [itens[3 + (i % 2)], 1]], {
      cliente: CLIENTES[c], telefone: `2799900${String(1000 + c)}`, endereco: tipo === 'entrega' ? (semBairro ? [e[0], e[1], ''] : e) : null,
      tipo, forma: formas[i % 3], diasAtras: (i * 7) % 25, hora: 11 + (i % 11),
    })
  }
}

async function cliques(L) {
  const alvos = [['×', 40], ['Adicionar', 35], ['Home', 20], ['X-Bacon Pão, bife, bacon…', 18], ['Continuar para pagamento', 15], ['Lanches', 12], ['🏷️ Promoções', 9],
    ['Cupons', 8], ['←', 8], ['Fechar', 6], ['Verde Grátis', 5], ['2 Ver sacola', 5], ['Smash Duplo', 4], ['Continuar no cardápio', 4], ['APLICAR', 3], ['Revisar pedido', 3], ['Bebidas', 2]]
  for (const [alvo, n] of alvos) for (let k = 0; k < n; k++) {
    await db.query(`insert into vitrine_eventos (restaurante_id, visitante_id, sessao_id, tipo, alvo, criado_em) values ($1, gen_random_uuid(), gen_random_uuid(), 'clique', $2, now() - ($3 || ' hours')::interval)`, [L, alvo, String(1 + (k % 200))])
  }
  for (let k = 0; k < 60; k++) await db.query(`insert into vitrine_eventos (restaurante_id, visitante_id, sessao_id, tipo, criado_em) values ($1, gen_random_uuid(), gen_random_uuid(), 'visita', now() - ($2 || ' hours')::interval)`, [L, String(1 + k * 3)])
}

const L = await loja('dash54-loja', 'Lanchonete Dash 54', ENDERECO_LOJA)
await dono('dono.dash54', L)
const itens = await cardapio(L)
await pedidosReais(L, itens)
await cliques(L)

const S = await loja('dash54-sem-pedidos', 'Dash 54 Sem Pedidos', ENDERECO_LOJA)
await dono('dono.dash54sp', S)
const B = await loja('dash54-sem-bairro', 'Dash 54 Sem Bairro', ENDERECO_LOJA)
await dono('dono.dash54sb', B)
await pedidosReais(B, await cardapio(B), { semBairro: true })
const M = await loja('menuzia', 'Angus Burguer (local)', ENDERECO_LOJA)
await dono('dono.menuzialocal', M)
const itensM = await cardapio(M)
await pedidosReais(M, itensM)

if (COM_TESTE) {
  // Pedidos de TESTE: na loja real saem das análises; na menuzia (loja de teste) continuam.
  for (const [Lx, its] of [[L, itens], [M, itensM]]) {
    await pedido(Lx, [[its[2], 3]], { cliente: 'TESTE tempo de resposta', telefone: '27999991111', endereco: ['Rua Teste', '1', 'Bairro Fictício'], tipo: 'entrega', forma: 'pix', diasAtras: 1, hora: 14 })
    await pedido(Lx, [[its[0], 2]], { cliente: 'Cliente Suporte', telefone: '27992534407', endereco: ENDERECOS[0], tipo: 'entrega', forma: 'dinheiro', diasAtras: 2, hora: 19 })
  }
}
console.log(`ok — lojas dash54-loja, dash54-sem-pedidos, dash54-sem-bairro, menuzia${COM_TESTE ? ' (com 2 pedidos de TESTE em dash54-loja e menuzia)' : ''}`)
await db.end()
