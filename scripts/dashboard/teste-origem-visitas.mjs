/**
 * Teste da 0153 (origem das visitas com a mesma regra dos pedidos). Banco LOCAL, numa transação que é
 * desfeita no fim. Linha do tempo conhecida → painel_analytics_vitrine → contagem por origem.
 *   node scripts/dashboard/teste-origem-visitas.mjs
 */
import pg from 'pg'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'
const { DB_URL } = chavesLocais(); exigirLoopback(DB_URL)
const c = new pg.Client({ connectionString: DB_URL }); await c.connect()
const res = []; const ok = (n, v, d = '') => { res.push(!!v); console.log(`   ${v ? '✅' : '❌'} ${n}${d && !v ? ' — ' + d : ''}`) }
try {
  await c.query('begin')
  const u = (await c.query(`select u.id, u.restaurante_id from usuarios u join restaurantes r on r.id=u.restaurante_id where r.slug='cantina-demo' and u.papel='dono' limit 1`)).rows[0]
  const L = u.restaurante_id
  await c.query(`delete from vitrine_eventos where restaurante_id=$1`, [L])
  const ini = new Date('2026-09-10T00:00:00-03:00'), fim = new Date('2026-09-11T00:00:00-03:00')
  const ev = (vis, ses, tipo, quando, origem) => c.query(`insert into vitrine_eventos (restaurante_id, visitante_id, sessao_id, tipo, origem, criado_em) values ($1,$2,$3,$4,$5,$6)`, [L, vis, ses, tipo, origem, quando])
  const h = (s) => new Date(`2026-09-10T${s}:00-03:00`)
  // A: direto; depois chega pelo Instagram (recarrega); no mesmo passeio chega pelo anúncio da Meta; volta direto e pede.
  await ev('vA', 'sA1', 'visita', h('10:00'), 'Direto')
  await ev('vA', 'sA2', 'visita', h('11:00'), 'instagram')
  await ev('vA', 'sA2', 'visita', h('11:05'), 'Direto')
  await ev('vA', 'sA2', 'visita', h('11:10'), 'meta-ads')
  await ev('vA', 'sA3', 'visita', h('12:00'), 'Direto')
  await ev('vA', 'sA3', 'pedido', h('12:10'), null)
  // B: veio do Instagram há 8 dias (fora dos 7) e volta direto → Direto.
  await ev('vB', 'sB0', 'visita', new Date('2026-09-02T09:00:00-03:00'), 'instagram')
  await ev('vB', 'sB1', 'visita', h('13:00'), 'Direto')
  // C: veio pelo WhatsApp há 3 dias (antes do período, dentro dos 7) e volta direto → WhatsApp.
  await ev('vC', 'sC0', 'visita', new Date('2026-09-07T09:00:00-03:00'), 'whatsapp')
  await ev('vC', 'sC1', 'visita', h('14:00'), 'Direto')
  await c.query(`set local role authenticated`)
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated' })])
  const r = (await c.query(`select painel_analytics_vitrine($1, $2) j`, [ini.toISOString(), fim.toISOString()])).rows[0].j
  const m = Object.fromEntries((r.origens ?? []).map((o) => [o.origem, o]))
  console.log(JSON.stringify(r.origens))
  ok('Direto: 2 (A antes de qualquer link; B, cujo Instagram tem 8 dias)', m.Direto?.visitas === 2, JSON.stringify(m.Direto))
  ok('Instagram: 1 (a recarga na mesma sessão não conta de novo)', m.instagram?.visitas === 1, JSON.stringify(m.instagram))
  ok('Meta: 2 (chegada pelo anúncio + a volta direta 50 min depois)', m['meta-ads']?.visitas === 2, JSON.stringify(m['meta-ads']))
  ok('WhatsApp: 1 (link de 3 dias antes do período, dentro dos 7)', m.whatsapp?.visitas === 1, JSON.stringify(m.whatsapp))
  ok('pedido no canal da última origem não-direta (Meta), como o pedido gravaria', m['meta-ads']?.pedidos === 1 && !m.Direto?.pedidos, JSON.stringify(m['meta-ads']))
  ok('funil (visitantes únicos) não mudou: 3 visitantes no período', r.funil?.visita === 3, JSON.stringify(r.funil))
} finally {
  await c.query('rollback').catch(() => {}); await c.end()
}
const f = res.filter((x) => !x).length; console.log(`\n${res.length - f}/${res.length} verificações passaram`); process.exit(f ? 1 : 0)
