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

// Conta e pagamentos em um estado conhecido: os E2E conferem totais com taxa de
// serviço, e um valor deixado por outra execução faz todos eles falharem por 3,75.
await db.query(
  `update restaurantes set taxa_servico_padrao = 10,
          formas_pagamento_mesa = array['dinheiro','pix','credito','debito']
    where id = $1`, [loja])

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

// ── equipe: um garçom e um atendente (delivery e caixa do salão) ────────────────────────────────────────
// O atendente existe para provar a separação por canal: ele não pode lançar em mesa.
async function criarFuncionario(email, usuario, papel, nome) {
  let id
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  id = data?.user?.id
  if (!id) {
    const { data: lista } = await admin.auth.admin.listUsers()
    id = lista.users.find((u) => u.email === email).id
    await admin.auth.admin.updateUserById(id, { password: SENHA })
  }
  await db.query(`
    insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado)
    values ($1, $2, $3::papel_usuario, $4, $5, $6, true)
    on conflict (id) do update set restaurante_id = excluded.restaurante_id, papel = excluded.papel,
      autorizado = true, desativado_em = null, usuario = excluded.usuario, nome = excluded.nome`,
    [id, loja, papel, nome, email, usuario])
}
await criarFuncionario('garcom@demo.local', 'garcom.local', 'garcom', 'Garçom Demo')
await criarFuncionario('atendente@demo.local', 'atendente.local', 'atendente', 'Atendente Demo')

// ── cardápio ────────────────────────────────────────────────────────────────
// Item antes de categoria: apagar a categoria primeiro deixaria itens órfãos
// (grupo_id nulo), que somem da tela mas continuam no banco.
await db.query('delete from itens_cardapio where restaurante_id = $1', [loja])
await db.query('delete from grupos_cardapio where restaurante_id = $1', [loja])

const FOTOS = {
  'Filé à Parmegiana': 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=600&q=70',
  'Risoto de Funghi': 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=600&q=70',
  'Burger da Casa': 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=70',
  'Água com Gás': 'https://images.unsplash.com/photo-1523362628745-0c100150b504?w=600&q=70',
  'Suco de Laranja': 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=600&q=70',
}

async function criarCategoria(nome, posicao) {
  const { rows } = await db.query(
    `insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,$2,$3) returning id`,
    [loja, nome, posicao])
  return rows[0].id
}

async function criarItem(grupoId, nome, preco, descricao) {
  const { rows } = await db.query(
    `insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, descricao, imagem_url, status)
     values ($1,$2,$3,$4,$5,$6,'disponivel') returning id`,
    [loja, grupoId, nome, preco, descricao ?? '', FOTOS[nome] ?? null])
  return rows[0].id
}

/** Cria um grupo de opções com seus complementos — é o que vira uma etapa do configurador. */
async function criarEtapa(itemId, nome, { obrigatorio, min, max, posicao }, opcoes) {
  const { rows } = await db.query(
    `insert into grupos_item_complementos (item_id, nome, obrigatorio, min_escolhas, max_escolhas, posicao)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [itemId, nome, obrigatorio, min, max, posicao])
  const grupoId = rows[0].id
  for (const [i, [nomeOpcao, preco]] of opcoes.entries()) {
    await db.query(
      `insert into item_complementos (item_id, grupo_id, nome, preco, posicao) values ($1,$2,$3,$4,$5)`,
      [itemId, grupoId, nomeOpcao, preco, i])
  }
}

const catPratos = await criarCategoria('Pratos', 0)
const catBurgers = await criarCategoria('Burgers', 1)
const catBebidas = await criarCategoria('Bebidas', 2)

await criarItem(catPratos, 'Filé à Parmegiana', 68, 'Filé empanado, molho da casa, queijo gratinado e fritas.')
await criarItem(catPratos, 'Risoto de Funghi', 54, 'Arroz arbóreo, mix de cogumelos frescos e parmesão.')

// Item com as três etapas das referências: ponto, adicionais e bebida.
const burger = await criarItem(
  catBurgers, 'Burger da Casa', 42,
  'Blend de 180 g, queijo, alface, tomate e molho especial no pão brioche.')
await criarEtapa(burger, 'Escolha o ponto', { obrigatorio: true, min: 1, max: 1, posicao: 0 }, [
  ['Ao ponto', 0], ['Mal passado', 0], ['Bem passado', 0],
])
await criarEtapa(burger, 'Que tal turbinar seu lanche?', { obrigatorio: false, min: 0, max: 4, posicao: 1 }, [
  ['Adicional de burger', 15], ['Bacon crocante', 8], ['Queijo cheddar', 6], ['Cebola caramelizada', 5],
])
await criarEtapa(burger, 'Escolha a bebida', { obrigatorio: true, min: 1, max: 1, posicao: 2 }, [
  ['Coca-Cola lata', 7], ['Coca-Cola Zero lata', 7], ['Suco de laranja', 12],
])

await criarItem(catBebidas, 'Água com Gás', 7, 'Garrafa 500 ml gelada.')
await criarItem(catBebidas, 'Suco de Laranja', 12, 'Laranja espremida na hora, 400 ml.')

await db.query(`update restaurantes set banner_promocional_url = $1 where id = $2`,
  ['https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=70', loja])

// ── mesas em estados diferentes ─────────────────────────────────────────────
// Ordem importa: pedido referencia comanda, que referencia mesa.
await db.query('delete from pedidos where restaurante_id = $1', [loja])
await db.query('delete from sessoes_mesa where restaurante_id = $1', [loja])
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

// Mesa 02 ocupada: comanda aberta com dois lançamentos. Os itens entram de verdade — a
// conta soma itens (comanda_totais), não o total gravado no pedido.
const comanda = (await db.query(
  `insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id`, [loja, ids[1].id])).rows[0].id
for (const linhas of [[['Filé à Parmegiana', 68, 1]], [['Risoto de Funghi', 54, 1], ['Água com Gás', 7, 1]]]) {
  const total = linhas.reduce((t, [, preco, qtd]) => t + preco * qtd, 0)
  const pedido = (await db.query(
    `insert into pedidos (restaurante_id, tipo, status, subtotal, total, canal, comanda_id, mesa, origem, cliente_nome, impresso)
     values ($1,'retirada','recebido',$2,$2,'mesa',$3,'Mesa 02','pdv','Mesa 02', true) returning id`, [loja, total, comanda])).rows[0].id
  for (const [nome, preco, qtd] of linhas) {
    await db.query(
      `insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade)
       select $1, id, nome, $2, $3 from itens_cardapio where restaurante_id = $4 and nome = $5`,
      [pedido, preco, qtd, loja, nome])
  }
}

// Varanda 02 bloqueada; Balcão 01 desativado.
await db.query('update mesas set bloqueada_em = now() where id = $1', [ids[4].id])
await db.query('update mesas set ativa = false where id = $1', [ids[5].id])

// ── segunda loja: a prova de isolamento entre inquilinos ────────────────────
// Existe só para os testes tentarem alcançá-la e falharem. Uma mesa, um dono, nada mais.
const lojaVizinha = (await db.query(`
  insert into restaurantes (nome, slug, status_loja, modulo_mesas_ativo, aceita_retirada, cor_tema)
  values ('Vizinha Demo', 'vizinha-demo', 'aberto_manual', true, true, 'ciano')
  on conflict (slug) do update set modulo_mesas_ativo = true, status_loja = 'aberto_manual'
  returning id`)).rows[0].id
{
  const email = 'dono@vizinha.local'
  let id
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  id = data?.user?.id
  if (!id) {
    const { data: lista } = await admin.auth.admin.listUsers()
    id = lista.users.find((u) => u.email === email).id
    await admin.auth.admin.updateUserById(id, { password: SENHA })
  }
  await db.query(`
    insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado)
    values ($1, $2, 'dono', 'Dono Vizinha', $3, 'dono.vizinha', true)
    on conflict (id) do update set restaurante_id = excluded.restaurante_id, papel = 'dono',
      autorizado = true, desativado_em = null, usuario = excluded.usuario`,
    [id, lojaVizinha, email])
}
await db.query('delete from pedidos where restaurante_id = $1', [lojaVizinha])
await db.query('delete from sessoes_mesa where restaurante_id = $1', [lojaVizinha])
await db.query('delete from comandas where restaurante_id = $1', [lojaVizinha])
await db.query('delete from mesas where restaurante_id = $1', [lojaVizinha])
await db.query('delete from itens_cardapio where restaurante_id = $1', [lojaVizinha])
await db.query('delete from grupos_cardapio where restaurante_id = $1', [lojaVizinha])
const grupoVizinho = (await db.query(
  `insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,'Pratos',0) returning id`, [lojaVizinha])).rows[0].id
await db.query(
  `insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, descricao, status)
   values ($1,$2,'Prato da Vizinha',33,'','disponivel')`, [lojaVizinha, grupoVizinho])
await db.query(
  `insert into mesas (restaurante_id, nome, ordem, setor, capacidade) values ($1,'Mesa V1',0,'Salão',2)`, [lojaVizinha])

await db.end()

console.log(`
✅ Ambiente de demonstração pronto (LOCAL, descartável)

   Loja ......... Cantina Demo (slug: cantina-demo), módulo Mesas e Comandas LIGADO
   Senha (todos)  ${SENHA}

   Dono ......... ${USUARIO}
   Garçom ....... garcom.local
   Atendente .... atendente.local   (delivery e caixa do salão — não lança em mesa)

   6 mesas: 3 livres, 1 ocupada (2 lançamentos), 1 bloqueada, 1 desativada

   Loja vizinha . Vizinha Demo (slug: vizinha-demo) — existe só para os testes de
                  isolamento entre inquilinos. Dono: dono.vizinha
`)
