/**
 * E2E — auditoria de abrir/fechar a loja (0156, noite 5). Stack LOCAL.
 *   · dono fecha e reabre pelo Kanban: evento 'loja.status' com quem, de→para, origem "kanban",
 *     aparelho; aparece legível na tela de Auditoria;
 *   · rotina /api/cron/loja-horario: loja no automático registra abriu/fechou pela grade, sem
 *     repetir;
 *   · mudança feita pelo sistema (sem usuário) também fica registrada.
 * Devolve status e horário da loja.
 *
 *   CRON_SECRET=… node scripts/seguranca/e2e-auditoria-loja.mjs [prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const CRON = process.env.CRON_SECRET
const PRINTS = process.argv[2] ?? '.shots/auditoria-loja'
mkdirSync(PRINTS, { recursive: true })
if (!CRON) { console.error('Defina CRON_SECRET (o do servidor).'); process.exit(2) }
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const dono = await um(`select u.id, u.nome, u.restaurante_id from usuarios u where u.usuario='dono.finint'`)
const loja = await um(`select id, status_loja, horario_funcionamento from restaurantes where id=$1`, [dono.restaurante_id])
const ultimo = (acao) => um(`select usuario_id, usuario_nome, ator, dados, hash is not null tem_hash from eventos_auditoria where restaurante_id=$1 and acao=$2 order by seq desc limit 1`, [loja.id, acao])
const cron = () => fetch(`${BASE}/api/cron/loja-horario`, { method: 'POST', headers: { 'x-cron-secret': CRON } }).then((r) => r.json())

const browser = await chromium.launch()
try {
  secao('Kanban: dono fecha e reabre a loja')
  await db.query(`update restaurantes set status_loja='aberto_manual' where id=$1`, [loja.id])
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.finint'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'load' })
  await p.waitForTimeout(2500)
  const abrirMenu = async () => { await p.locator('button[aria-label*="abrir ou fechar a loja"]').first().evaluate((e) => e.click()); await p.getByTestId('kanban-status-menu').waitFor({ timeout: 8000 }) }
  await abrirMenu()
  await p.getByTestId('kanban-status-menu').getByText('Fechar agora').click()
  await p.waitForTimeout(1500)
  const fechou = await ultimo('loja.status')
  ok('evento registrado com quem fechou (usuário da sessão)', fechou?.usuario_id === dono.id && fechou.usuario_nome === dono.nome && fechou.ator === 'usuario', JSON.stringify(fechou))
  ok('de "aberta (manual)" para "fechada (manual)"', fechou?.dados?.de === 'aberto_manual' && fechou.dados.para === 'fechado_manual')
  ok('de onde: Painel de Pedidos (kanban), computador', fechou?.dados?.origem === 'kanban' && fechou.dados.aparelho === 'computador', JSON.stringify(fechou?.dados))
  ok('entra encadeado na auditoria (hash)', fechou?.tem_hash === true)
  await abrirMenu()
  await p.getByTestId('kanban-status-menu').getByText('Forçar aberta agora').click()
  await p.waitForTimeout(1500)
  const abriu = await ultimo('loja.status')
  ok('reabrir também registra (fechada → aberta)', abriu?.dados?.de === 'fechado_manual' && abriu.dados.para === 'aberto_manual')

  secao('tela de Auditoria')
  await p.goto(`${BASE}/admin/auditoria`, { waitUntil: 'load' })
  await p.waitForTimeout(2500)
  const texto = await p.locator('main').first().innerText()
  ok('aparece "Abriu/fechou a loja manualmente" com o resumo legível', /Abriu\/fechou a loja manualmente/.test(texto) && /Fechada \(manual\) → Aberta \(manual\)|Aberta \(manual\) → Fechada \(manual\)/.test(texto) && /pelo Painel de Pedidos/.test(texto), texto.slice(0, 300))
  await p.screenshot({ path: join(PRINTS, 'auditoria-1366.png') })
  await ctx.close()

  secao('mudança pelo sistema (sem usuário)')
  await db.query(`update restaurantes set status_loja='fechado_manual' where id=$1`, [loja.id])
  const sis = await ultimo('loja.status')
  ok('registrada como "Sistema"', sis?.ator === 'sistema' && sis.usuario_nome === 'Sistema' && sis.dados?.origem === 'sistema', JSON.stringify(sis))

  secao('automático pela grade de horário')
  const tudoAberto = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, [{ abre: '00:00', fecha: '23:59' }]]))
  const fmt = (await um(`select jsonb_typeof(horario_funcionamento) t, horario_funcionamento h from restaurantes where horario_funcionamento is not null limit 1`))
  console.log('   (formato de horário de exemplo)', JSON.stringify(fmt?.h)?.slice(0, 160))
  await db.query(`delete from eventos_auditoria where restaurante_id=$1 and acao in ('loja.abriu_horario','loja.fechou_horario')`, [loja.id]).catch(() => {})
  await db.query(`update restaurantes set status_loja='automatico' where id=$1`, [loja.id])
  const c1 = await cron()
  const ev1 = await um(`select acao, usuario_nome, dados from eventos_auditoria where restaurante_id=$1 and acao in ('loja.abriu_horario','loja.fechou_horario') order by seq desc limit 1`, [loja.id])
  ok('rotina registra o estado da loja no automático', c1.ok && !!ev1 && ev1.usuario_nome === 'Sistema (horário)' && ev1.dados?.origem === 'horario', JSON.stringify({ c1, ev1 }))
  const n1 = (await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao like 'loja.%horario'`, [loja.id])).n
  await cron()
  const n2 = (await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao like 'loja.%horario'`, [loja.id])).n
  ok('sem mudança, não repete', n2 === n1, `${n1} → ${n2}`)
  // Inverte: se estava aberta, fecha todos os dias (e vice-versa) e a rotina registra a passagem.
  const fechadoSempre = {}
  await db.query(`update restaurantes set horario_funcionamento=$2 where id=$1`, [loja.id, ev1?.acao === 'loja.abriu_horario' ? fechadoSempre : tudoAberto])
  await cron()
  const ev2 = await um(`select acao from eventos_auditoria where restaurante_id=$1 and acao like 'loja.%horario' order by seq desc limit 1`, [loja.id])
  ok('passagem aberta↔fechada pela grade fica registrada', ev2 && ev2.acao !== ev1?.acao, JSON.stringify({ antes: ev1?.acao, depois: ev2?.acao }))
} catch (e) {
  ok('execução sem exceção', false, String(e?.message ?? e).slice(0, 400))
} finally {
  await browser.close()
  await db.query(`update restaurantes set status_loja=$2, horario_funcionamento=$3 where id=$1`, [loja.id, loja.status_loja, loja.horario_funcionamento])
  await db.end()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram`)
process.exit(passou === res.length ? 0 : 1)
