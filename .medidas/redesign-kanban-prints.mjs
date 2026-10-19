// Prints do redesign do Kanban (18/10/2026), em 1366×768, com um perfil do Playwright em que o dono já fez login.
// Não grava nada: só navega, abre menus/modais e fotografa. Prints em .shots/redesign-kanban/<rotulo>/ (fora do git).
//   node .medidas/redesign-kanban-prints.mjs <perfil> <rotulo> [base]      base padrão: http://localhost:3000
//   Login uma vez (janela aberta):  node .medidas/redesign-kanban-prints.mjs <perfil> login http://localhost:3000
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const [PERFIL, ROTULO = 'atual', BASE = 'http://localhost:3000'] = process.argv.slice(2)
if (!PERFIL) { console.error('uso: node .medidas/redesign-kanban-prints.mjs <perfil> <rotulo> [base]'); process.exit(1) }
const PASTA = `.shots/redesign-kanban/${ROTULO}`
mkdirSync(PASTA, { recursive: true })
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const ctx = await chromium.launchPersistentContext(PERFIL, { headless: ROTULO !== 'login', viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
const p = ctx.pages()[0] ?? await ctx.newPage()
try {
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  if (ROTULO === 'login') {
    // Login no local (prints DEPOIS) e em produção (prints ANTES), na mesma janela, com a loja Menuzia.
    console.log('Faça login nesta janela (loja Menuzia) no LOCAL. Aguardando até 5 min…')
    await p.waitForURL(/\/admin\//, { timeout: 300_000 }).catch(() => {})
    await espera(2000)
    await p.goto('https://app.menuzia.com.br/admin/pedidos', { waitUntil: 'domcontentloaded' }).catch(() => {})
    console.log('Agora faça login em PRODUÇÃO (app.menuzia.com.br), também na Menuzia. Aguardando até 5 min…')
    await p.waitForURL(/app\.menuzia\.com\.br\/admin\//, { timeout: 300_000 }).catch(() => {})
    await espera(3000); console.log('url', p.url()); await ctx.close(); process.exit(0)
  }
  await p.waitForSelector('[data-testid="kanban-quadro"]', { timeout: 60_000 })
  // 4ª coluna ligada para o print (preferência local do navegador do perfil).
  const col4 = await p.evaluate(() => localStorage.getItem('menuzia:kanban-col4'))
  if (col4 !== '1') { await p.evaluate(() => localStorage.setItem('menuzia:kanban-col4', '1')); await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('[data-testid="kanban-quadro"]', { timeout: 60_000 }) }
  await espera(2500)
  const foto = async (nome) => { await p.screenshot({ path: `${PASTA}/${nome}.png` }); console.log('print', `${PASTA}/${nome}.png`) }
  await foto('01-kanban')
  const primeiro = p.locator('[data-testid^="pedido-"]').first()
  if (await primeiro.count()) {
    // Menu "Mais informações" (só no card novo).
    const mais = primeiro.locator('[data-testid="card-mais"]')
    if (await mais.count()) {
      await mais.click(); await espera(400); await foto('02-mais-informacoes')
      await p.locator('[data-testid="mais-info-pagamento"]').click(); await espera(500); await foto('03-modal-pagamento')
      await p.keyboard.press('Escape'); await espera(300)
    }
    await primeiro.click(); await espera(600); await foto('04-painel-direita')
    await p.keyboard.press('Escape'); await espera(300)
  } else {
    console.log('sem card no quadro — crie pedidos de teste na Menuzia')
  }
  await p.screenshot({ path: `${PASTA}/05-topo.png`, clip: { x: 0, y: 0, width: 1366, height: 120 } })
  console.log('print', `${PASTA}/05-topo.png`)
} finally {
  await ctx.close()
}
