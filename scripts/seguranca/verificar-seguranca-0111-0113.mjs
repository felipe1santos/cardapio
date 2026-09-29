/**
 * Prova local das migrations 0111 (instância do WhatsApp só pelo servidor), 0112
 * (descadastro + pausa das campanhas) e 0113 (cancelamento só pelo servidor).
 *
 * Usa login de verdade (PostgREST com a sessão do usuário, como um atacante faria) nas
 * lojas locais cantina-pdv2 / vizinha-pdv2. Tudo o que o script cria é apagado no fim.
 * Só roda contra a stack local (loopback).
 *
 *   node scripts/seguranca/verificar-seguranca-0111-0113.mjs
 */
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL, API_URL, ANON_KEY, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, API_URL)
const SENHA = 'demo-local-123456'

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

async function logar(email) {
  const c = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: SENHA })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return c
}

const A = (await um(`select id, nome, evolution_instance from restaurantes where slug='cantina-pdv2'`))
const B = (await um(`select id, evolution_instance from restaurantes where slug='vizinha-pdv2'`))
const instA = A.evolution_instance
const criados = []
const pausadasPeloTeste = []

try {
  console.log('\n── 0111: instância do WhatsApp ──')
  await db.query(`update restaurantes set evolution_instance = 'menuzia-teste-b-0111' where id = $1`, [B.id])
  for (const email of ['atendente.pdv2@demo.local', 'dono.pdv2@local.test']) {
    const c = await logar(email)
    const { error } = await c.from('restaurantes').update({ evolution_instance: 'menuzia-teste-b-0111' }).eq('id', A.id)
    const depois = await um(`select evolution_instance from restaurantes where id=$1`, [A.id])
    ok(`${email.split('.')[0]} NÃO troca a instância pela API`, !!error && depois.evolution_instance === instA, error?.message?.slice(0, 60))
    const { error: e2 } = await c.from('restaurantes').update({ nome: A.nome }).eq('id', A.id)
    ok(`${email.split('.')[0]} continua salvando outras configurações`, !e2, e2?.message?.slice(0, 60))
  }
  let dup = false
  try { await db.query(`update restaurantes set evolution_instance = 'menuzia-teste-b-0111' where id = $1`, [A.id]) } catch { dup = true }
  ok('a mesma instância não pode ser de duas lojas (índice único)', dup)
  await db.query(`update restaurantes set evolution_instance = $2 where id = $1`, [A.id, instA])

  console.log('\n── 0113: cancelamento ──')
  const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem)
    values ($1,'retirada','entregue',10,10,'QA 0113','',  'dinheiro','balcao','pdv') returning id`, [A.id])
  criados.push(p.id)
  const p2 = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem)
    values ($1,'retirada','recebido',10,10,'QA 0113 delivery','5511912340777','pix','delivery','cardapio') returning id`, [A.id])
  criados.push(p2.id)
  for (const email of ['atendente.pdv2@demo.local', 'dono.pdv2@local.test']) {
    const c = await logar(email)
    for (const alvo of [p.id, p2.id]) {
      const { error } = await c.from('pedidos').update({ status: 'cancelado' }).eq('id', alvo)
      const st = (await um(`select status from pedidos where id=$1`, [alvo])).status
      ok(`${email.split('.')[0]} NÃO cancela pedido direto pela API (${alvo === p.id ? 'balcão entregue' : 'delivery'})`, st !== 'cancelado', error?.message?.slice(0, 50) ?? `status ${st}`)
    }
    const { error: eAv } = await c.from('pedidos').update({ status: 'preparando' }).eq('id', p2.id).eq('status', 'recebido')
    ok(`${email.split('.')[0]} continua avançando status normal (Kanban)`, !eAv, eAv?.message?.slice(0, 60))
    await db.query(`update pedidos set status='recebido' where id=$1`, [p2.id])
  }
  const srv = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { error: eSrv } = await srv.from('pedidos').update({ status: 'cancelado', cancelado_motivo: 'outro' }).eq('id', p2.id)
  ok('servidor (service_role) continua cancelando', !eSrv && (await um(`select status from pedidos where id=$1`, [p2.id])).status === 'cancelado', eSrv?.message)

  console.log('\n── 0112: descadastro e pausa ──')
  const camp = await um(`insert into campanhas (restaurante_id, nome, status, mensagem, agendado_em, total_destinatarios) values ($1,'QA 0112','agendada','oi', now() + interval '1 hour', 2) returning id`, [A.id])
  await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente) values ($1,$2,'5511912340881','Sai'),($1,$2,'5511912340882','Fica')`, [camp.id, A.id])
  const { data: saiu } = await srv.rpc('whatsapp_descadastrar', { p_restaurante: A.id, p_telefone: '11912340881', p_sair: true, p_origem: 'cliente' })
  const env = (await db.query(`select nome_cliente, status from campanha_envios where campanha_id=$1 order by nome_cliente`, [camp.id])).rows
  ok('SAIR cancela o envio pendente só de quem saiu (formato do número diferente)', saiu === true && env.find((e) => e.nome_cliente === 'Sai').status === 'cancelado' && env.find((e) => e.nome_cliente === 'Fica').status === 'pendente', JSON.stringify(env))
  const outraLoja = await um(`select count(*)::int n from whatsapp_descadastros where restaurante_id=$1 and telefone_chave=telefone_chave('5511912340881')`, [B.id])
  ok('descadastro vale só para a loja onde o cliente respondeu', outraLoja.n === 0)
  const cDono = await logar('dono.pdv2@local.test')
  const { data: lista } = await cDono.from('whatsapp_descadastros').select('telefone_chave')
  const cViz = await logar('dono.pdv2@vizinha.local').catch(() => null)
  const { data: listaViz } = cViz ? await cViz.from('whatsapp_descadastros').select('telefone_chave') : { data: [] }
  ok('dono vê os descadastros da própria loja; o da vizinha não vê', (lista ?? []).length >= 1 && (listaViz ?? []).length === 0)
  const { error: eIns } = await cDono.from('whatsapp_descadastros').insert({ restaurante_id: A.id, telefone_chave: '1100000000', telefone: '1100000000' })
  ok('navegador não grava descadastro direto', !!eIns)
  await srv.rpc('whatsapp_descadastrar', { p_restaurante: A.id, p_telefone: '11912340881', p_sair: false })
  ok('VOLTAR tira da lista', (await um(`select count(*)::int n from whatsapp_descadastros where restaurante_id=$1 and telefone_chave=telefone_chave('5511912340881')`, [A.id])).n === 0)

  await db.query(`update campanhas set agendado_em = now() - interval '1 minute' where id=$1`, [camp.id])
  // Isola o teste: outras campanhas locais em andamento ficam pausadas e voltam no fim.
  pausadasPeloTeste.push(...(await db.query(`update campanhas set status='pausada' where id <> $1 and status in ('agendada','enviando') returning id, 'x' as s`, [camp.id])).rows.map((r) => r.id))
  const { data: reservados } = await srv.rpc('campanha_reservar_envios', { p_limite: 5 })
  const meu = (reservados ?? []).find((r) => r.campanha_id === camp.id)
  ok('seletor devolve incluir_descadastro', !!meu && 'incluir_descadastro' in meu)
  const { data: fim } = await srv.rpc('campanha_concluir_envio', { p_id: meu.id, p_resultado: 'pausa', p_id_externo: null, p_erro: 'WhatsApp da loja desconectado' })
  const depoisPausa = await um(`select e.status, e.tentativas, c.status cst, c.pausa_motivo from campanha_envios e join campanhas c on c.id=e.campanha_id where e.id=$1`, [meu.id])
  ok('"pausa": contato volta para a fila sem gastar tentativa e a campanha fica pausada', fim === 'pausa' && depoisPausa.status === 'pendente' && depoisPausa.tentativas === 0 && depoisPausa.cst === 'pausada' && depoisPausa.pausa_motivo === 'whatsapp_desconectado', JSON.stringify(depoisPausa))
  const { data: nada } = await srv.rpc('campanha_reservar_envios', { p_limite: 5 })
  ok('campanha pausada não sai', !(nada ?? []).some((r) => r.campanha_id === camp.id))
  await db.query(`delete from campanhas where id=$1`, [camp.id])
} catch (e) {
  console.error(e); res.push(false)
} finally {
  if (pausadasPeloTeste.length) await db.query(`update campanhas set status='enviando' where id = any($1)`, [pausadasPeloTeste])
  if (criados.length) await db.query(`delete from pedidos where id = any($1)`, [criados])
  await db.query(`delete from whatsapp_descadastros where restaurante_id=$1 and telefone like '%912340881'`, [A.id])
  await db.query(`update restaurantes set evolution_instance = $2 where id = $1`, [A.id, instA])
  await db.query(`update restaurantes set evolution_instance = $2 where id = $1`, [B.id, B.evolution_instance])
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
