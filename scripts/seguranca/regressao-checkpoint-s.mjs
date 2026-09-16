/**
 * Regressão do checkpoint S: o que o painel e o servidor precisam continuar
 * fazendo depois de fechar os grants.
 *
 * Cria um usuário autenticado de verdade no Auth local, pega o JWT dele e bate no
 * PostgREST — o mesmo caminho do painel, que é 100% client-side. Depois exercita
 * os caminhos de servidor (checkout, PDV, impressão) com service_role.
 *
 * Só loopback.
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_KEY = process.env.SERVICE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

if (!/127\.0\.0\.1|localhost/.test(API_URL) || !/127\.0\.0\.1|localhost/.test(DB_URL)) {
  console.error('\n❌ Só loopback.\n'); process.exit(1)
}

const res = []
const ok = (nome, passou, detalhe) => { res.push(passou); console.log(`${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`) }

const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

const loja = (await db.query("select id from restaurantes where slug='loja-teste-s'")).rows[0].id
const pedido = (await db.query('select id from pedidos where restaurante_id=$1 order by criado_em desc limit 1', [loja])).rows[0]?.id

// --- usuário autenticado (dono) --------------------------------------------
const email = `dono.s@local.test`
const senha = 'senha-local-123456'
let userId
{
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  userId = data?.user?.id ?? (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email).id
  await db.query(
    `insert into usuarios (id, restaurante_id, papel, nome) values ($1,$2,'dono','Dono Teste')
     on conflict (id) do update set restaurante_id = excluded.restaurante_id`, [userId, loja])
}

const comoDono = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
const { data: sessao, error: erroLogin } = await comoDono.auth.signInWithPassword({ email, password: senha })
if (erroLogin) throw erroLogin
ok('dono autentica no Auth local', !!sessao.session)

console.log('\n── PAINEL (authenticated, via PostgREST) ──')
{
  const { data, error } = await comoDono.from('pedidos').select('id, status, total').eq('restaurante_id', loja).limit(5)
  ok('Kanban LÊ pedidos', !error && Array.isArray(data), error?.message ?? `${data?.length} linha(s)`)
}
{
  const { error } = await comoDono.from('pedidos').update({ status: 'preparando' }).eq('id', pedido)
  ok('Kanban AVANÇA status (update)', !error, error?.message)
}
{
  const { error } = await comoDono.from('pedidos').update({ impresso: true, reimprimir: false }).eq('id', pedido)
  ok('Impressão marca impresso/reimprimir', !error, error?.message)
}
{
  const { data, error } = await comoDono.from('pedido_itens').select('id, nome, quantidade').limit(3)
  ok('Painel LÊ itens do pedido', !error, error?.message ?? `${data?.length} linha(s)`)
}
{
  const { error } = await comoDono.from('pedidos').insert({ restaurante_id: loja, total: 1 })
  ok('Painel NÃO insere pedido direto', !!error, error?.message?.slice(0, 60))
}
{
  const { error } = await comoDono.from('pedidos').delete().eq('id', pedido)
  ok('Painel NÃO apaga pedido direto', !!error, error?.message?.slice(0, 60))
}
{
  const { data, error } = await comoDono.from('restaurantes').select('impressao_agente_token').eq('id', loja).maybeSingle()
  ok('Dono AINDA lê o token do agente (Ajustes)', !error && !!data, error?.message)
}

console.log('\n── SERVIDOR (service_role) ──')
{
  const { data, error } = await admin.from('pedidos').select('id').eq('restaurante_id', loja).limit(1)
  ok('service_role lê pedidos (fila de impressão)', !error && !!data, error?.message)
}
{
  const { error } = await admin.from('pedidos').update({ impresso: true }).eq('id', pedido)
  ok('service_role marca impresso', !error, error?.message)
}
{
  const { data, error } = await admin.from('restaurantes').select('impressao_agente_token').eq('id', loja).maybeSingle()
  ok('service_role resolve o token do agente', !error && !!data, error?.message)
}

await comoDono.auth.signOut()
await db.end()

const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
