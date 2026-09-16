/**
 * Semente da demonstração local do módulo Mesas e Comandas.
 *
 * Cria loja, dono, cardápio mínimo e algumas mesas em estados diferentes, para a tela
 * ter o que mostrar. Só loopback — nunca encosta em produção.
 *
 *   npx supabase start && node scripts/seguranca/semear-demo-mesas.mjs
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, API_URL)

const EMAIL = 'dono@local.test'
const SENHA = 'demo-local-123456'
const USUARIO = 'dono.local'

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── loja, já com o módulo ligado ────────────────────────────────────────────
const loja = (await db.query(`
  insert into restaurantes (nome, slug, status_loja, modulo_mesas_ativo, aceita_retirada, cor_tema)
  values ('Cantina Demo', 'cantina-demo', 'aberto_manual', true, true, 'ciano')
  on conflict (slug) do update set modulo_mesas_ativo = true, status_loja = 'aberto_manual'
  returning id`)).rows[0].id

// ── dono ────────────────────────────────────────────────────────────────────
let userId
{
  const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  userId = data?.user?.id
  if (!userId) {
    const { data: lista } = await admin.auth.admin.listUsers()
    userId = lista.users.find((u) => u.email === EMAIL).id
    await admin.auth.admin.updateUserById(userId, { password: SENHA })
  }
  await db.query(`
    insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado)
    values ($1, $2, 'dono', 'Dono Demo', $3, $4, true)
    on conflict (id) do update set restaurante_id = excluded.restaurante_id, papel = 'dono',
      autorizado = true, desativado_em = null, usuario = excluded.usuario`,
    [userId, loja, EMAIL, USUARIO])
}

// ── cardápio mínimo ─────────────────────────────────────────────────────────
const grupo = (await db.query(
  `insert into grupos_cardapio (restaurante_id, nome) values ($1, 'Pratos') returning id`, [loja])).rows[0].id
for (const [nome, preco] of [['Filé à Parmegiana', 68], ['Risoto de Funghi', 54], ['Água com Gás', 7]]) {
  await db.query(
    `insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status)
     values ($1,$2,$3,$4,'disponivel')`, [loja, grupo, nome, preco])
}

// ── mesas em estados diferentes ─────────────────────────────────────────────
await db.query('delete from comandas where restaurante_id = $1', [loja])
await db.query('delete from mesas where restaurante_id = $1', [loja])

const mesas = [
  { nome: 'Mesa 01', setor: 'Salão', capacidade: 4 },
  { nome: 'Mesa 02', setor: 'Salão', capacidade: 2 },
  { nome: 'Mesa 03', setor: 'Salão', capacidade: 6 },
  { nome: 'Varanda 01', setor: 'Varanda', capacidade: 4 },
  { nome: 'Varanda 02', setor: 'Varanda', capacidade: 4 },
  { nome: 'Balcão 01', setor: 'Balcão', capacidade: 1 },
]
const ids = []
for (const [i, m] of mesas.entries()) {
  const { rows } = await db.query(
    `insert into mesas (restaurante_id, nome, ordem, setor, capacidade) values ($1,$2,$3,$4,$5) returning id, token`,
    [loja, m.nome, i, m.setor, m.capacidade])
  ids.push(rows[0])
}

// Mesa 02 ocupada: comanda aberta com dois lançamentos.
const comanda = (await db.query(
  `insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id`, [loja, ids[1].id])).rows[0].id
for (const total of [68, 61]) {
  await db.query(
    `insert into pedidos (restaurante_id, tipo, status, total, canal, comanda_id, mesa, origem, cliente_nome)
     values ($1,'retirada','recebido',$2,'mesa',$3,'Mesa 02','pdv','Mesa 02')`, [loja, total, comanda])
}

// Varanda 02 bloqueada; Balcão 01 desativado.
await db.query('update mesas set bloqueada_em = now() where id = $1', [ids[4].id])
await db.query('update mesas set ativa = false where id = $1', [ids[5].id])

await db.end()

console.log(`
✅ Ambiente de demonstração pronto (LOCAL, descartável)

   Loja ......... Cantina Demo (slug: cantina-demo), módulo Mesas e Comandas LIGADO
   Usuário ...... ${USUARIO}
   Senha ........ ${SENHA}
   E-mail ....... ${EMAIL}

   6 mesas: 3 livres, 1 ocupada (2 lançamentos), 1 bloqueada, 1 desativada
`)
