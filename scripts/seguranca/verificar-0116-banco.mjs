/**
 * Verificação da 0116 no banco LOCAL — tudo numa transação desfeita no fim.
 *   1. restaurantes: atendente não muda configuração (só status_loja/despacho/modo de entrega); dono muda;
 *   2. storage 'cardapio': anon não lista; logado lista só a pasta da própria loja;
 *   3. conversa única com e sem o 9 (saída com 9, resposta sem 9);
 *   4. reentrega do webhook sem envio devolve a decisão do robô; com envio, não.
 *
 *   node scripts/seguranca/verificar-0116-banco.mjs
 */
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)
const c = new pg.Client({ connectionString: DB_URL })
await c.connect()
const res = []
const ok = (n, v, d = '') => { res.push(!!v); console.log(`   ${v ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const um = async (s, p = []) => (await c.query(s, p)).rows[0]
const como = async (papelDb, uid) => {
  await c.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`, [papelDb, JSON.stringify(uid ? { sub: uid, role: papelDb } : { role: papelDb })])
}
const tenta = async (sql, p = []) => {
  await c.query('savepoint t')
  try { const r = await c.query(sql, p); await c.query('release savepoint t'); return { ok: true, n: r.rowCount } } catch (e) { await c.query('rollback to savepoint t'); return { ok: false, code: e.code, msg: e.message } }
}

try {
  await c.query('begin')
  const loja = await um(`select id from restaurantes where slug='cantina-pdv2'`)
  const atend = await um(`select u.id from usuarios u where u.restaurante_id=$1 and u.papel='atendente' limit 1`, [loja.id])
  const dono = await um(`select u.id from usuarios u where u.restaurante_id=$1 and u.papel='dono' limit 1`, [loja.id])

  console.log('\n── 1. configuração só pela gestão ──')
  await como('authenticated', atend.id)
  const taxa = await tenta(`update restaurantes set taxa_entrega_padrao = coalesce(taxa_entrega_padrao,0) + 1 where id=$1`, [loja.id])
  ok('atendente NÃO muda a taxa de entrega (42501)', !taxa.ok && taxa.code === '42501', taxa.msg ?? '')
  const slug = await tenta(`update restaurantes set slug = slug || '-x' where id=$1`, [loja.id])
  ok('atendente NÃO muda o slug', !slug.ok)
  const status = await tenta(`update restaurantes set status_loja = 'fechado_manual' where id=$1`, [loja.id])
  ok('atendente abre/fecha a loja (status_loja)', status.ok && status.n === 1)
  const desp = await tenta(`update restaurantes set despacho_aberto = not coalesce(despacho_aberto,false) where id=$1`, [loja.id])
  ok('atendente liga o despacho (despacho_aberto)', desp.ok && desp.n === 1)
  await como('authenticated', dono.id)
  const donoTaxa = await tenta(`update restaurantes set taxa_entrega_padrao = coalesce(taxa_entrega_padrao,0) + 1 where id=$1`, [loja.id])
  ok('dono muda a taxa de entrega', donoTaxa.ok && donoTaxa.n === 1)
  await c.query(`reset role`)
  const servidor = await tenta(`update restaurantes set taxa_entrega_padrao = taxa_entrega_padrao where id=$1`, [loja.id])
  ok('servidor/conexão direta continua passando', servidor.ok)

  console.log('\n── 2. storage cardapio ──')
  await c.query(`insert into storage.objects (bucket_id, name, owner) values ('cardapio', $1, null), ('cardapio', 'outra-loja/qa-0116.jpg', null)`, [`${loja.id}/qa-0116.jpg`])
  await como('anon')
  const anon = await um(`select count(*)::int n from storage.objects where bucket_id='cardapio' and name like '%qa-0116%'`)
  ok('anon não lista o bucket', anon.n === 0, `${anon.n}`)
  await como('authenticated', dono.id)
  const logado = await c.query(`select name from storage.objects where bucket_id='cardapio' and name like '%qa-0116%'`)
  ok('logado vê só a pasta da própria loja', logado.rowCount === 1 && logado.rows[0].name.startsWith(loja.id))
  await c.query(`reset role`)

  console.log('\n── 3. uma conversa com e sem o 9 ──')
  const saida = await um(`select public.whatsapp_registrar_saida($1, '5527981116116', 'aviso qa', null, 'automatico') r`, [loja.id])
  const ent = await um(`select public.whatsapp_registrar_entrada($1, '552781116116', 'qa-0116-a', false, 'texto', 'oi', now(), 'outro', 'QA', true) r`, [loja.id])
  ok('resposta sem o 9 cai na conversa do aviso (com o 9)', saida.r.conversa_id === ent.r.conversa_id)
  const n = await um(`select count(*)::int n from whatsapp_conversas where restaurante_id=$1 and telefone = any(public.whatsapp_variantes_telefone('5527981116116'))`, [loja.id])
  ok('uma conversa só para o número', n.n === 1, `${n.n}`)

  console.log('\n── 4. reentrega sem envio (B11) ──')
  const acao1 = ent.r.acao
  const dup = await um(`select public.whatsapp_registrar_entrada($1, '552781116116', 'qa-0116-a', false, 'texto', 'oi', now(), 'outro', 'QA', true) r`, [loja.id])
  ok('reentrega sem envio na fila devolve a decisão gravada', dup.r.duplicada === true && dup.r.sem_envio === true && dup.r.mensagem_id === ent.r.mensagem_id && dup.r.acao === acao1, JSON.stringify(dup.r))
  await c.query(`insert into whatsapp_envios (restaurante_id, chave, tipo, telefone, texto, conversa_id, origem_mensagem_id) values ($1, $2, 'robo', '552781116116', 'resp', $3, $4)`,
    [loja.id, `resposta:${ent.r.mensagem_id}`, ent.r.conversa_id, ent.r.mensagem_id])
  const dup2 = await um(`select public.whatsapp_registrar_entrada($1, '552781116116', 'qa-0116-a', false, 'texto', 'oi', now(), 'outro', 'QA', true) r`, [loja.id])
  ok('com o envio já na fila, reentrega é só "duplicada"', dup2.r.duplicada === true && !dup2.r.sem_envio)
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await c.query('rollback').catch(() => {})
  await c.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram (tudo desfeito)`)
process.exit(falhas ? 1 : 0)
