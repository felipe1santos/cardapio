/**
 * Conferência do item 54 (Dashboard geral: análises em abas, no visual do financeiro). Só no servidor LOCAL,
 * com as lojas de scripts/dashboard/semear-54.mjs. Lê a tela; não grava nada.
 *   abas      — clique, URL (?aba=), voltar/avançar do navegador, recarregar na aba, setas do teclado;
 *   filtro    — um período só: o mesmo texto no topo e no bloco;
 *   gráfico   — hover (abre/fecha), teclado (← → / Esc), toque (fica aberto e fecha ao tocar fora);
 *   mapa      — pinos, áreas, enquadramento; loja sem pedidos; loja sem bairro; dica do pino por toque;
 *   cliques   — "Ver todos" abre a tabela completa.
 *
 *   node scripts/dashboard/e2e-54.mjs
 */
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
exigirLoopback(chavesLocais().DB_URL, BASE)
const SENHA = 'demo-local-123456'
const DESKTOP = { viewport: { width: 1366, height: 860 } }
const CELULAR = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['Pixel 7'].userAgent }

let ok = 0, falhas = 0
const conferir = (cond, msg) => { if (cond) { ok++; console.log(`  ✅ ${msg}`) } else { falhas++; console.log(`  ❌ ${msg}`) } }

const browser = await chromium.launch()
async function entrar(login, opcoes) {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
const abaAtual = (p) => p.getByTestId('dash-analises-painel').getAttribute('data-aba')
const abaDaUrl = (p) => new URL(p.url()).searchParams.get('aba')
async function esperarMapa(p) {
  await p.waitForFunction(() => document.querySelector('[data-testid="mapa-pedidos"]')?.getAttribute('data-enquadrado') === 'sim', null, { timeout: 25000 }).catch(() => {})
  const m = p.getByTestId('mapa-pedidos')
  return { enquadrado: await m.getAttribute('data-enquadrado'), pinos: Number(await m.getAttribute('data-pinos')), areas: Number(await m.getAttribute('data-areas')), fora: Number(await m.getAttribute('data-fora')) }
}

try {
  // ── Desktop, loja com pedidos ───────────────────────────────────────────────────────────────────────────
  console.log('dash54-loja · desktop')
  {
    const { ctx, p } = await entrar('dono.dash54', DESKTOP)
    await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
    await p.getByTestId('dash-analises').scrollIntoViewIfNeeded()
    conferir((await abaAtual(p)) === 'pedidos', 'abre na aba Pedidos')
    const historico = []
    for (const aba of ['entrega', 'bairros', 'produtos', 'cliques']) {
      await p.getByTestId(`dash-aba-${aba}`).click(); await p.waitForTimeout(300)
      historico.push(aba)
      conferir((await abaAtual(p)) === aba && abaDaUrl(p) === aba, `aba ${aba}: painel e ?aba=${aba}`)
    }
    await p.goBack(); await p.waitForTimeout(400)
    conferir((await abaAtual(p)) === 'produtos' && abaDaUrl(p) === 'produtos', 'voltar do navegador → Produtos')
    await p.goBack(); await p.waitForTimeout(400)
    conferir((await abaAtual(p)) === 'bairros', 'voltar de novo → Bairros')
    await p.goForward(); await p.waitForTimeout(400)
    conferir((await abaAtual(p)) === 'produtos', 'avançar → Produtos')
    await p.goto(`${BASE}/admin/dashboard?aba=entrega`, { waitUntil: 'networkidle' })
    conferir((await abaAtual(p)) === 'entrega', 'recarregar com ?aba=entrega abre Entrega')
    const selecionadas = await p.locator('[data-testid^="dash-aba-"][aria-selected="true"]').count()
    conferir(selecionadas === 1, 'uma aba selecionada (aria-selected)')

    // Teclado nas abas
    await p.getByTestId('dash-aba-entrega').focus()
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300)
    conferir((await abaAtual(p)) === 'bairros' && (await p.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'dash-aba-bairros', 'seta → leva à próxima aba e o foco vai junto')
    await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(300)
    conferir((await abaAtual(p)) === 'entrega', 'seta ← volta')

    // Filtro único: o texto do período é o mesmo no topo e no bloco.
    const gatilhos = p.getByRole('button', { name: 'Escolher o período do dashboard' })
    const textos = await gatilhos.allInnerTexts()
    conferir((await gatilhos.count()) === 2, `o mesmo filtro no topo e no bloco (${await gatilhos.count()})`)
    const periodos = [...new Set(textos.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => /\d{2}\/\d{2}\/\d{4}/.test(t)))]
    conferir(periodos.length === 1, `filtro de período único (${periodos.join(' | ') || 'nenhum'})`)

    // Gráfico: hover e teclado (aba Pedidos)
    await p.getByTestId('dash-aba-pedidos').click(); await p.waitForTimeout(500)
    const g = p.getByTestId('dash54-grafico-pedidos')
    const svg = g.locator('svg').first()
    const caixa = await svg.boundingBox()
    await p.mouse.move(caixa.x + caixa.width * 0.5, caixa.y + caixa.height * 0.5); await p.waitForTimeout(200)
    const tip = p.getByTestId('dash54-grafico-pedidos-tooltip')
    conferir(await tip.isVisible(), 'hover no gráfico abre o tooltip')
    await p.mouse.move(caixa.x + caixa.width * 0.5, caixa.y - 120); await p.waitForTimeout(200)
    conferir(!(await tip.isVisible().catch(() => false)), 'tirar o mouse fecha o tooltip')
    await g.locator('[tabindex="0"]').first().focus()
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150)
    conferir(await tip.isVisible(), 'teclado: seta abre o tooltip no gráfico')
    const t1 = await tip.innerText()
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150)
    conferir((await tip.innerText()) !== t1, 'teclado: seta passa para o próximo período')
    await p.keyboard.press('Escape'); await p.waitForTimeout(150)
    conferir(!(await tip.isVisible().catch(() => false)), 'teclado: Esc fecha')

    // Mapa
    await p.getByTestId('dash-aba-bairros').click()
    const m = await esperarMapa(p)
    conferir(m.enquadrado === 'sim' && m.pinos > 0 && m.areas > 0, `mapa enquadrado com ${m.pinos} pinos, ${m.areas} áreas (${m.fora} fora do raio)`)
    await p.locator('[data-pino]').first().waitFor({ timeout: 10000 }).catch(() => {})
    const tamanhos = await p.locator('[data-pino]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.width) === Math.round(r.height) ? Math.round(r.width) : -1 }))
    conferir(tamanhos.length > 0 && tamanhos.every((w) => w >= 9 && w <= 16), `pinos pequenos (${Math.min(...tamanhos)}–${Math.max(...tamanhos)} px)`)
    const cor = await p.locator('[data-pino]').first().evaluate((e) => getComputedStyle(e).backgroundColor)
    conferir(cor === 'rgb(24, 119, 242)', `pino na cor da paleta (${cor})`)
    // O mapa termina o enquadramento (fitBounds + limite de zoom) antes do mouse chegar.
    await p.getByTestId('mapa-pedidos').scrollIntoViewIfNeeded(); await p.waitForTimeout(1500)
    // Pino que está por cima (pinos vizinhos se sobrepõem): o do centro do elemento é ele mesmo.
    const livre = await p.locator('[data-pino]').evaluateAll((els) => els.findIndex((e) => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e }))
    await p.locator('[data-pino]').nth(Math.max(0, livre)).hover(); await p.waitForTimeout(200)
    conferir(await p.getByTestId('mapa-dica').isVisible(), 'hover no pino mostra a dica')
    const rk = await p.getByTestId('dash54-ranking-bairros').boundingBox()
    const mp = await p.getByTestId('mapa-pedidos').boundingBox()
    conferir(rk && mp && rk.x > mp.x + mp.width - 4, 'desktop: ranking ao lado do mapa')

    // Cliques
    await p.getByTestId('dash-aba-cliques').click(); await p.waitForTimeout(400)
    const importantes = await p.locator('[data-testid^="clique-importante"]').count()
    conferir(importantes > 0 && importantes <= 10, `cliques que importam: ${importantes} (até 10)`)
    const ver = p.getByTestId('cliques-ver-todos')
    if (await ver.isVisible().catch(() => false)) {
      await ver.click(); await p.waitForTimeout(300)
      conferir(await p.getByText('Todos os cliques').first().isVisible(), '"Ver todos" abre a tabela completa')
    } else conferir(true, '"Ver todos" não precisa aparecer (poucos cliques)')
    await ctx.close()
  }

  // ── Celular, loja com pedidos ───────────────────────────────────────────────────────────────────────────
  console.log('dash54-loja · celular 390')
  {
    const { ctx, p } = await entrar('dono.dash54', CELULAR)
    await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
    const largura = await p.evaluate(() => document.documentElement.scrollWidth)
    conferir(largura <= 391, `sem rolagem horizontal da página (${largura}px)`)
    const lista = p.locator('[data-testid="dash-analises"] [role="tablist"]')
    const rola = await lista.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, ov: getComputedStyle(e).overflowX }))
    conferir(rola.ov === 'auto', `abas roláveis (overflow ${rola.ov}, ${rola.sw}/${rola.cw}px)`)
    await p.getByTestId('dash-aba-cliques').scrollIntoViewIfNeeded(); await p.getByTestId('dash-aba-cliques').tap(); await p.waitForTimeout(300)
    conferir((await abaAtual(p)) === 'cliques', 'toque na última aba funciona')

    await p.getByTestId('dash-aba-pedidos').tap(); await p.waitForTimeout(400)
    const svg = p.getByTestId('dash54-grafico-pedidos').locator('svg').first()
    await svg.scrollIntoViewIfNeeded()
    const b = await svg.boundingBox()
    await p.touchscreen.tap(b.x + b.width * 0.5, b.y + b.height * 0.5); await p.waitForTimeout(1000)
    const tip = p.getByTestId('dash54-grafico-pedidos-tooltip')
    conferir(await tip.isVisible(), 'toque no gráfico: tooltip continua aberto depois de soltar')
    await p.getByTestId('dash54-total').tap(); await p.waitForTimeout(300)
    conferir(!(await tip.isVisible().catch(() => false)), 'toque fora fecha o tooltip')

    await p.getByTestId('dash-aba-bairros').tap()
    const m = await esperarMapa(p)
    conferir(m.enquadrado === 'sim' && m.pinos > 0 && m.areas > 0, `mapa no celular enquadrado (${m.pinos} pinos, ${m.areas} áreas)`)
    await p.locator('[data-pino]').first().waitFor({ timeout: 10000 }).catch(() => {})
    const caixas = await p.locator('[data-pino]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
    conferir(caixas.length > 0 && caixas.every(([w, h]) => w === h && w <= 16), `celular: pinos redondos e pequenos (${JSON.stringify(caixas.slice(0, 3))}…)`)
    const mb = await p.getByTestId('mapa-pedidos').boundingBox()
    conferir(mb.height >= 300 && mb.width >= 320, `mapa confortável (${Math.round(mb.width)}×${Math.round(mb.height)})`)
    const rk = await p.getByTestId('dash54-ranking-bairros').boundingBox()
    conferir(rk.y >= mb.y + mb.height - 2, 'celular: ranking embaixo do mapa')
    const pino = p.locator('[data-pino]').first()
    await pino.scrollIntoViewIfNeeded()
    const pb = await pino.boundingBox()
    await p.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2); await p.waitForTimeout(500)
    conferir(await p.getByTestId('mapa-dica').isVisible(), 'toque no pino mostra a dica')
    await p.getByTestId('dash54-ranking-bairros').tap(); await p.waitForTimeout(300)
    conferir(!(await p.getByTestId('mapa-dica').isVisible().catch(() => false)), 'toque fora fecha a dica do pino')
    await ctx.close()
  }

  // ── Loja sem pedidos (com endereço) ─────────────────────────────────────────────────────────────────────
  console.log('dash54-sem-pedidos')
  {
    const { ctx, p } = await entrar('dono.dash54sp', DESKTOP)
    await p.goto(`${BASE}/admin/dashboard?aba=bairros`, { waitUntil: 'networkidle' })
    const m = await esperarMapa(p)
    conferir(m.enquadrado === 'sim' && m.pinos === 0 && m.areas === 0, 'mapa enquadra a loja, sem pinos nem áreas')
    conferir(await p.getByTestId('mapa-sem-pedidos').isVisible(), 'mensagem "sem pedidos" no mapa')
    for (const aba of ['pedidos', 'entrega', 'produtos', 'cliques']) {
      await p.getByTestId(`dash-aba-${aba}`).click(); await p.waitForTimeout(300)
      const erro = await p.locator('text=/Application error|Unhandled|NaN|undefined/').count()
      conferir(erro === 0, `aba ${aba} sem erro nem NaN`)
    }
    await ctx.close()
  }

  // ── Loja sem bairro nos pedidos ─────────────────────────────────────────────────────────────────────────
  console.log('dash54-sem-bairro')
  {
    const { ctx, p } = await entrar('dono.dash54sb', DESKTOP)
    await p.goto(`${BASE}/admin/dashboard?aba=bairros`, { waitUntil: 'networkidle' })
    const m = await esperarMapa(p)
    conferir(m.enquadrado === 'sim' && m.areas === 0, `sem bairro: mapa enquadrado, nenhuma área (${m.pinos} pinos)`)
    const nan = await p.locator('[data-testid="dash-analises"]').locator('text=/NaN|undefined/').count()
    conferir(nan === 0, 'sem NaN/undefined no bloco')
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${ok} ok · ${falhas} falha(s)`)
process.exit(falhas ? 1 : 0)
