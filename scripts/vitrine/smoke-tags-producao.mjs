/**
 * Smoke em PRODUÇÃO das tags (2026-10-01): SÓ a vitrine pública da Menuzia, sem login, sem
 * checkout e sem telefone (nada é enviado e nenhum pedido é criado). Confere os produtos
 * "TESTE …" e tira prints em 360/390/414 e desktop (lista, ficha, sacola) + menu ao rolar.
 *
 *   node scripts/vitrine/smoke-tags-producao.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices } from 'playwright'

const BASE = 'https://app.menuzia.com.br'
const SLUG = 'menuzia'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
try {
  for (const [rot, opts] of [
    ['360', { ...devices['iPhone 13'], viewport: { width: 360, height: 800 } }],
    ['390', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }],
    ['414', { ...devices['iPhone 13'], viewport: { width: 414, height: 896 } }],
    ['desktop', { viewport: { width: 1366, height: 900 } }],
  ]) {
    console.log(`\n── ${rot} ──`)
    const ctx = await browser.newContext({ ...opts, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    // Popup de campanha da loja (ex.: cupom de volta): fecha pelo fundo escuro.
    const fundo = p.locator('div[class*="z-[85]"]')
    if (await fundo.count()) { await fundo.first().click({ position: { x: 5, y: 5 } }).catch(() => {}); await p.waitForTimeout(400) }
    const linha = (nome) => p.locator('button[data-item-id]', { hasText: nome }).last()
    await linha('TESTE X-Burger').first().scrollIntoViewIfNeeded()
    const topo = await linha('TESTE Quatro de topo').locator('[data-etiquetas-principais] [data-etiqueta]').evaluateAll((els) => els.map((e) => e.getAttribute('data-etiqueta')))
    const utils = await linha('TESTE Desconto com tags').locator('[data-etiquetas-utilitarias] [data-etiqueta]').evaluateAll((els) => els.map((e) => e.textContent.trim()))
    const pil = await linha('TESTE Desconto').locator('[data-desconto]').first().textContent().catch(() => '')
    const pers = await linha('TESTE Personalizada azul').locator('[data-etiqueta="personalizada"]').getAttribute('data-cor').catch(() => null)
    const ap = await linha('TESTE A partir de').locator('[data-preco]').textContent().catch(() => '')
    ok(`${rot}: 4 de topo → 2 na ordem`, JSON.stringify(topo) === '["mais_vendido","combo_especial"]', topo.join(','))
    ok(`${rot}: utilitárias + desconto -25% + personalizada azul + A partir de`, utils.join('|') === 'Serve até 2 pessoas|Item promocional' && pil.trim() === '-25%' && pers === 'azul' && /A partir de/.test(ap), `${utils.join('|')} · ${pil} · ${pers}`)
    if (PRINTS) {
      await linha('TESTE X-Burger').first().scrollIntoViewIfNeeded(); await p.screenshot({ path: join(PRINTS, `prod-lista-${rot}-1.png`) })
      await linha('TESTE Personalizada preta').scrollIntoViewIfNeeded(); await p.screenshot({ path: join(PRINTS, `prod-lista-${rot}-2.png`) })
      await linha('TESTE Desconto').first().scrollIntoViewIfNeeded(); await p.screenshot({ path: join(PRINTS, `prod-lista-${rot}-3.png`) })
    }
    await linha('TESTE Desconto com tags').click()
    await p.waitForTimeout(800)
    if (PRINTS) await p.screenshot({ path: join(PRINTS, `prod-ficha-${rot}.png`) })
    if (rot === '390') {
      await p.getByRole('button', { name: /Adicionar/ }).last().click()
      await p.waitForTimeout(600)
      await p.getByText('Ver sacola').first().click()
      await p.waitForTimeout(600)
      ok('390: sacola com preço original riscado', (await p.locator('[data-preco-antigo]').count()) >= 1)
      if (PRINTS) await p.screenshot({ path: join(PRINTS, 'prod-sacola-390.png') })
      await p.getByRole('button', { name: /^Home$/ }).first().click()
      await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400)
      for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, 200); await p.waitForTimeout(120) }
      await p.waitForTimeout(400)
      const desce = await p.getByTestId('nav-rodape').getAttribute('data-oculta')
      for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, -80); await p.waitForTimeout(120) }
      await p.waitForTimeout(400)
      const sobe = await p.getByTestId('nav-rodape').getAttribute('data-oculta')
      ok('390: menu some ao descer e volta ao subir', desce === 'sim' && sobe === 'nao', `${desce}/${sobe}`)
      const fontes = await p.evaluate(() => [...new Set([...document.querySelectorAll('body *')].filter((e) => !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(e.tagName) && e.getBoundingClientRect().width > 0 && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => getComputedStyle(e).fontFamily.split(',')[0]))])
      ok('390: só a fonte da vitrine', fontes.every((f) => /Montserrat/i.test(f)), fontes.join(' · '))
    }
    await ctx.close()
  }
  const man = await (await fetch(`${BASE}/api/loja/${SLUG}/manifest`)).json()
  ok('manifesto da loja (standalone, start_url do cardápio)', man.display === 'standalone' && man.start_url === `/loja/${SLUG}` && man.icons?.length === 2)
  const ic = await fetch(`${BASE}/api/loja/${SLUG}/icone/192`)
  ok('ícone 192 PNG', ic.status === 200 && ic.headers.get('content-type') === 'image/png')
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await browser.close()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
