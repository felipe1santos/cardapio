// Integrações simplificadas (21/10/2026) — SÓ Menuzia, em produção: janela da Uber (campos obrigatórios, "salvo ✓",
// Modo avançado fechado) e o teste de conexão que o "Conectar" faz. Não troca credencial nenhuma.
//   node .medidas/teste-conectar-integracoes.mjs <senha do gerente.aprovador>
import { chromium } from 'playwright'
const BASE = 'https://app.menuzia.com.br'
const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), ...a)
const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 1366, height: 900 } })).newPage()
try {
  await p.goto(`${BASE}/login`); await p.fill('input[name="email"]', 'gerente.aprovador'); await p.fill('input[name="password"]', process.argv[2])
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }), p.click('button[type="submit"]')])
  const cfg = await (await p.request.get(`${BASE}/api/admin/entregas/uber/config`)).json()
  log('uber config: ambiente', cfg.config?.ambiente, '| ativo', cfg.config?.ativo, '| podeTeste', cfg.podeTeste)
  const t = await p.request.post(`${BASE}/api/admin/entregas/uber/config`, { data: { acao: 'testar' } })
  log('testar (o que o Conectar faz depois de salvar):', t.status(), JSON.stringify(await t.json()).slice(0, 160))
  const ll = await p.request.get(`${BASE}/api/admin/entregas/lalamove/config`)
  log('lalamove config:', ll.status(), JSON.stringify(await ll.json()).slice(0, 160))
  await p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(9000)
  await p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
  await p.getByText('Uber Direct', { exact: true }).first().click(); await p.waitForTimeout(6000)
  const dlg = p.locator('[role="dialog"]').last()
  log('janela Uber:', (await dlg.innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 400))
  await p.screenshot({ path: '.medidas/conectar-uber-producao.png' })
} catch (e) { log('PAROU:', e.message) } finally { await nav.close() }
