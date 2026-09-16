/**
 * Prova que a matriz de `lib/auth/permissoes.ts` e as policies do banco dizem a mesma
 * coisa — batendo no PostgREST com um JWT real por papel, que é exatamente o caminho do
 * painel (client-side).
 *
 * Só loopback. Cria loja, pedidos e usuários descartáveis na base local.
 *
 *   npx supabase start && node scripts/seguranca/verificar-rls-papeis.mjs
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL, API_URL, ANON_KEY, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, API_URL)

const SENHA = 'local-somente-123456'
const PAPEIS = ['dono', 'gerente', 'garcom', 'atendente', 'cozinha', 'logistica']

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── cenário ─────────────────────────────────────────────────────────────────
console.log('\n── montando cenário local ──')

const loja = (await db.query(
  `insert into restaurantes (nome, slug, status_loja) values ('Loja RLS','loja-rls','aberto_manual')
   on conflict (slug) do update set nome = excluded.nome returning id`)).rows[0].id
const outraLoja = (await db.query(
  `insert into restaurantes (nome, slug) values ('Loja Vizinha','loja-vizinha')
   on conflict (slug) do update set nome = excluded.nome returning id`)).rows[0].id

const mesa = (await db.query(
  `insert into mesas (restaurante_id, nome, ordem) values ($1,'Mesa 01',0) returning id`, [loja])).rows[0].id
const comanda = (await db.query(
  `insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id`, [loja, mesa])).rows[0].id

const pedidoDelivery = (await db.query(
  `insert into pedidos (restaurante_id, tipo, status, total, canal, cliente_nome, cliente_telefone)
   values ($1,'entrega','recebido',50,'delivery','Cliente Delivery','5527999990001') returning id`, [loja])).rows[0].id
const pedidoMesa = (await db.query(
  `insert into pedidos (restaurante_id, tipo, status, total, canal, comanda_id, cliente_nome)
   values ($1,'retirada','recebido',30,'mesa',$2,'Mesa 01') returning id`, [loja, comanda])).rows[0].id
await db.query(
  `insert into pedido_itens (pedido_id, nome, preco_unitario, quantidade) values ($1,'X-Burger',30,1)`, [pedidoMesa])
await db.query(
  `insert into clientes (restaurante_id, telefone, nome) values ($1,'5527999990001','Cliente Delivery')
   on conflict do nothing`, [loja])
await db.query(
  `insert into eventos_auditoria (restaurante_id, usuario_nome, acao, entidade)
   values ($1,'Sistema','teste','pedido')`, [loja])

console.log(`   loja ${loja.slice(0, 8)} · pedido delivery e pedido de mesa criados`)

// ── usuários, um por papel ──────────────────────────────────────────────────
const sessoes = {}
for (const papel of PAPEIS) {
  // Domínio próprio: a semente da demonstração usa dono@local.test com outra senha.
  const email = `${papel}@rls.local.test`
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  let userId = data?.user?.id
  if (error) {
    if (!/already/i.test(error.message)) throw error
    const { data: lista } = await admin.auth.admin.listUsers()
    userId = lista.users.find((u) => u.email === email).id
  }
  await db.query(
    `insert into usuarios (id, restaurante_id, papel, nome, autorizado, usuario, email)
     values ($1,$2,$3::papel_usuario,$4,true,$5,$6)
     on conflict (id) do update set restaurante_id = excluded.restaurante_id, papel = excluded.papel,
       desativado_em = null, autorizado = true`,
    [userId, loja, papel, papel.toUpperCase(), `${papel}.rls`, email])

  const cli = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: erroLogin } = await cli.auth.signInWithPassword({ email, password: SENHA })
  if (erroLogin) throw new Error(`${papel}: ${erroLogin.message}`)
  sessoes[papel] = { cli, userId }
}
console.log(`   ${PAPEIS.length} usuários autenticados no Auth local`)

// ── canal: quem vê o quê ────────────────────────────────────────────────────
console.log('\n── canal do pedido ──')
const esperaCanais = {
  dono: ['delivery', 'mesa'],
  gerente: ['delivery', 'mesa'],
  atendente: ['delivery'],
  logistica: ['delivery'],
  garcom: ['mesa'],
  cozinha: ['mesa'],
}
for (const papel of PAPEIS) {
  const { data } = await sessoes[papel].cli.from('pedidos').select('id, canal')
  const canais = [...new Set((data ?? []).map((p) => p.canal))].sort()
  ok(`${papel} enxerga ${JSON.stringify(esperaCanais[papel])}`,
    JSON.stringify(canais) === JSON.stringify(esperaCanais[papel]), JSON.stringify(canais))
}

// itens espelham o pedido pai
{
  const { data } = await sessoes.garcom.cli.from('pedido_itens').select('id')
  // `>= 1`: o script é re-executável sem `db reset`, então as linhas acumulam.
  ok('garçom lê itens do pedido de mesa', (data ?? []).length >= 1, `${data?.length} linha(s)`)
}

// ── escrita ─────────────────────────────────────────────────────────────────
console.log('\n── escrita pelo navegador ──')
{
  const { error } = await sessoes.dono.cli.from('pedidos').update({ status: 'preparando' }).eq('id', pedidoDelivery)
  ok('dono avança status (Kanban)', !error, error?.message)
}
{
  const { error } = await sessoes.dono.cli.from('pedidos').update({ total: 0 }).eq('id', pedidoDelivery)
  ok('NINGUÉM altera o total pelo navegador', !!error, error?.message?.slice(0, 55))
}
{
  const { error } = await sessoes.dono.cli.from('pedidos').update({ canal: 'mesa' }).eq('id', pedidoDelivery)
  ok('NINGUÉM altera o canal pelo navegador', !!error, error?.message?.slice(0, 55))
}
{
  const { error } = await sessoes.dono.cli.from('pedidos').insert({ restaurante_id: loja, total: 1 })
  ok('NINGUÉM insere pedido pelo navegador', !!error, error?.message?.slice(0, 55))
}
{
  const { error } = await sessoes.dono.cli.from('pedidos').delete().eq('id', pedidoDelivery)
  ok('NINGUÉM apaga pedido pelo navegador', !!error, error?.message?.slice(0, 55))
}
{
  // Atenção: quando a policy filtra a linha, o UPDATE afeta zero linhas e o PostgREST
  // responde SEM erro. Confiar no `error` daria falso verde — o que vale é o dado.
  const antes = (await db.query('select status from pedidos where id = $1', [pedidoMesa])).rows[0].status
  await sessoes.garcom.cli.from('pedidos').update({ status: 'pronto' }).eq('id', pedidoMesa)
  const depois = (await db.query('select status from pedidos where id = $1', [pedidoMesa])).rows[0].status
  ok('garçom NÃO avança preparo (é da cozinha)', antes === depois, `status seguiu '${depois}'`)
}
{
  const { error } = await sessoes.cozinha.cli.from('pedidos').update({ status: 'pronto' }).eq('id', pedidoMesa)
  ok('cozinha avança o preparo da mesa', !error, error?.message?.slice(0, 55))
}

// ── dados sensíveis ─────────────────────────────────────────────────────────
console.log('\n── dados sensíveis ──')
for (const papel of ['garcom', 'cozinha', 'logistica']) {
  const { data } = await sessoes[papel].cli.from('clientes').select('id, telefone')
  ok(`${papel} não lê clientes do delivery`, (data ?? []).length === 0, `${data?.length ?? 0} linha(s)`)
}
{
  const { data } = await sessoes.atendente.cli.from('clientes').select('id')
  ok('atendente do delivery lê clientes', (data ?? []).length > 0, `${data?.length} linha(s)`)
}
for (const papel of ['garcom', 'atendente', 'cozinha']) {
  const { data } = await sessoes[papel].cli.from('eventos_auditoria').select('id')
  ok(`${papel} não lê auditoria`, (data ?? []).length === 0, `${data?.length ?? 0} linha(s)`)
}
{
  const { data } = await sessoes.gerente.cli.from('eventos_auditoria').select('id')
  ok('gestor lê auditoria', (data ?? []).length > 0, `${data?.length} linha(s)`)
}
{
  const { error } = await sessoes.gerente.cli.from('eventos_auditoria').insert({
    restaurante_id: loja, usuario_nome: 'X', acao: 'forjado', entidade: 'pedido' })
  ok('auditoria é append-only (nem gestor escreve)', !!error, error?.message?.slice(0, 55))
}
{
  // `select('*')` em `usuarios` agora é recusado: o grant é por coluna, e `*` exige
  // SELECT de tabela. É o comportamento desejado — e o motivo de nenhum código do
  // painel poder usar `*` nessa tabela.
  const estrela = await sessoes.garcom.cli.from('usuarios').select('*').limit(1)
  ok('select(*) em usuarios é recusado', !!estrela.error, estrela.error?.message?.slice(0, 45))

  const permitido = await sessoes.garcom.cli.from('usuarios').select('id, nome, papel').limit(5)
  ok('colunas públicas de usuarios continuam legíveis', !permitido.error, permitido.error?.message?.slice(0, 45))

  for (const col of ['email', 'telefone', 'autorizado', 'acesso_expira_em']) {
    const r = await sessoes.garcom.cli.from('usuarios').select(col).limit(1)
    ok(`usuarios.${col} fora do alcance`, !!r.error, r.error?.message?.slice(0, 45))
  }
}

// ── salão ───────────────────────────────────────────────────────────────────
console.log('\n── salão ──')
{
  const { data } = await sessoes.garcom.cli.from('mesas').select('id')
  ok('garçom lê as mesas', (data ?? []).length > 0, `${data?.length} linha(s)`)
}
{
  const { error } = await sessoes.garcom.cli.from('mesas').insert({ restaurante_id: loja, nome: 'Mesa 99', ordem: 9 })
  ok('garçom NÃO cadastra mesa', !!error, error?.message?.slice(0, 55))
}
{
  const { error } = await sessoes.gerente.cli.from('mesas').insert({ restaurante_id: loja, nome: 'Mesa 02', ordem: 1 })
  ok('gestor cadastra mesa', !error, error?.message?.slice(0, 55))
}
{
  const { data } = await sessoes.atendente.cli.from('mesas').select('id')
  ok('atendente do delivery não enxerga mesas', (data ?? []).length === 0, `${data?.length ?? 0} linha(s)`)
}
{
  const { error } = await sessoes.garcom.cli.from('comandas').update({ status: 'fechada' }).eq('id', comanda)
  ok('comanda não se fecha pelo navegador', !!error, error?.message?.slice(0, 55))
}

// ── tabelas legadas (0066) ──────────────────────────────────────────────────
// Antes da 0066, um garçom com o próprio JWT alterava preço e fechava a loja pelo
// console. O que vale é o DADO: UPDATE filtrado pela policy responde sem erro.
console.log('\n── tabelas legadas: catálogo, loja, marketing ──')
{
  const grupoCat = (await db.query(`insert into grupos_cardapio (restaurante_id, nome) values ($1,'Cat RLS') returning id`, [loja])).rows[0].id
  const itemCat = (await db.query(
    `insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status) values ($1,$2,'Item RLS',50,'disponivel') returning id`,
    [loja, grupoCat])).rows[0].id
  const preco = async () => Number((await db.query('select preco from itens_cardapio where id=$1', [itemCat])).rows[0].preco)
  const statusLoja = async () => (await db.query('select status_loja from restaurantes where id=$1', [loja])).rows[0].status_loja

  await sessoes.garcom.cli.from('itens_cardapio').update({ preco: 1 }).eq('id', itemCat)
  ok('garçom NÃO altera preço do cardápio', (await preco()) === 50, `preço ${await preco()}`)
  await sessoes.cozinha.cli.from('itens_cardapio').update({ preco: 1 }).eq('id', itemCat)
  ok('cozinha NÃO altera preço do cardápio', (await preco()) === 50)
  await sessoes.gerente.cli.from('itens_cardapio').update({ preco: 55 }).eq('id', itemCat)
  ok('gerente altera preço do cardápio', (await preco()) === 55, `preço ${await preco()}`)

  const { data: cardapioGarcom } = await sessoes.garcom.cli.from('itens_cardapio').select('id').eq('id', itemCat)
  ok('garçom continua LENDO o cardápio (precisa para lançar)', (cardapioGarcom ?? []).length === 1)

  await db.query(`update restaurantes set status_loja='aberto_manual' where id=$1`, [loja])
  await sessoes.garcom.cli.from('restaurantes').update({ status_loja: 'fechado_manual' }).eq('id', loja)
  ok('garçom NÃO fecha a loja', (await statusLoja()) === 'aberto_manual', await statusLoja())
  await sessoes.atendente.cli.from('restaurantes').update({ status_loja: 'fechado_manual' }).eq('id', loja)
  ok('atendente do delivery abre/fecha a loja', (await statusLoja()) === 'fechado_manual', await statusLoja())
  await db.query(`update restaurantes set status_loja='aberto_manual' where id=$1`, [loja])

  await db.query(`insert into campanhas (restaurante_id, nome) values ($1,'Campanha RLS') on conflict do nothing`, [loja]).catch(() => {})
  for (const tabela of ['campanhas', 'cupons', 'fidelidade_recompensas', 'entregadores', 'impressoras']) {
    const { data } = await sessoes.garcom.cli.from(tabela).select('id').limit(5)
    ok(`garçom não lê ${tabela}`, (data ?? []).length === 0, `${data?.length ?? 0} linha(s)`)
  }
  const { error: erroCupom } = await sessoes.garcom.cli.from('cupons').insert({ restaurante_id: loja, codigo: 'GARCOM', tipo: 'percentual', valor: 10 })
  const cupomCriado = (await db.query(`select 1 from cupons where codigo='GARCOM' and restaurante_id=$1`, [loja])).rowCount > 0
  ok('garçom NÃO cria cupom', !cupomCriado, erroCupom?.message?.slice(0, 50))
}

// ── isolamento e sessão ─────────────────────────────────────────────────────
console.log('\n── isolamento e sessão ──')
{
  const { data } = await sessoes.dono.cli.from('pedidos').select('id').eq('restaurante_id', outraLoja)
  ok('cross-tenant volta vazio', (data ?? []).length === 0)
}
{
  await db.query('update usuarios set desativado_em = now() where id = $1', [sessoes.garcom.userId])
  const { data } = await sessoes.garcom.cli.from('pedidos').select('id')
  ok('desativado perde acesso com o JWT já emitido', (data ?? []).length === 0, `${data?.length ?? 0} linha(s)`)
  await db.query('update usuarios set desativado_em = null where id = $1', [sessoes.garcom.userId])
}
{
  // Loja sem dono válido: todo mundo cai, inclusive quem está logado.
  await db.query(`update usuarios set acesso_expira_em = now() - interval '1 day' where restaurante_id = $1 and papel = 'dono'`, [loja])
  const { data } = await sessoes.gerente.cli.from('pedidos').select('id')
  ok('loja sem dono válido bloqueia todo mundo', (data ?? []).length === 0, `${data?.length ?? 0} linha(s)`)
  await db.query('update usuarios set acesso_expira_em = null where restaurante_id = $1', [loja])
}
{
  const { data } = await sessoes.gerente.cli.from('pedidos').select('id')
  ok('e volta ao normal quando a loja é revalidada', (data ?? []).length > 0, `${data?.length} linha(s)`)
}

for (const papel of PAPEIS) await sessoes[papel].cli.auth.signOut()
await db.end()

const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram\n`)
process.exit(falhas ? 1 : 0)
