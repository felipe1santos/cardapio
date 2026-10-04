/**
 * E2E — "tela cheia" no celular por navegador (2026-10-01), em EMULAÇÃO (Chromium do
 * Playwright com o user-agent e a tela de cada um). Confere, para cada perfil:
 *   · a rolagem é a do documento (é ela que faz a barra do navegador recolher);
 *   · o menu da vitrine (com o WhatsApp) fica SEMPRE visível ao rolar (P8, 2026-10-04);
 *   · o convite de instalar aparece só onde faz sentido (dica no iOS; nunca em navegador
 *     interno do WhatsApp/Instagram);
 *   · no checkout o menu não aparece e o botão principal fica visível.
 * Tira 3 quadros por perfil (parado, descendo, subindo) e monta uma tira por perfil.
 * Limite: emulação não desenha a barra do navegador real — isso fica no relatório.
 *
 *   node scripts/vitrine/e2e-tela-cheia-navegadores.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = process.env.SLUG ?? 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

const IOS = { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
const AND = { viewport: { width: 412, height: 780 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }
const PERFIS = [
  ['chrome-iphone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1', IOS, 'ios'],
  ['safari-ios', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', IOS, 'ios'],
  ['chrome-android', 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36', AND, null],
  ['samsung-internet', 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', AND, null],
  ['whatsapp-android', 'Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.18', AND, null],
  ['instagram-iphone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.0 (iPhone15,2; iOS 17_5; pt_BR)', IOS, null],
]

const browser = await chromium.launch()
try {
  for (const [nome, ua, tela, conviteEsperado] of PERFIS) {
    console.log(`\n── ${nome} ──`)
    const ctx = await browser.newContext({ ...tela, userAgent: ua, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.evaluate(() => localStorage.clear())
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(700)
    const quadros = []
    const foto = async () => { quadros.push(await p.screenshot()) }
    const nav = p.getByTestId('nav-rodape')
    const h = tela.viewport.height
    await foto()
    const navParado = await nav.boundingBox()
    for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, 150); await p.waitForTimeout(110) }
    await p.waitForTimeout(450)
    await foto()
    const navDescendo = await nav.boundingBox()
    const doc = await p.evaluate(() => document.scrollingElement.scrollTop)
    for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, -60); await p.waitForTimeout(110) }
    await p.waitForTimeout(450)
    await foto()
    const navSubindo = await nav.boundingBox()
    ok(`${nome}: rolagem do documento`, doc > 0, `scrollTop=${doc}`)
    ok(`${nome}: menu no fundo, fora da barra do sistema (parado)`, navParado && Math.abs(navParado.y + navParado.height - h) <= 1)
    ok(`${nome}: menu continua no fundo ao descer e ao subir (sempre visível)`, navDescendo && Math.abs(navDescendo.y + navDescendo.height - h) <= 1 && navSubindo && Math.abs(navSubindo.y + navSubindo.height - h) <= 1, `${navDescendo?.y}/${navSubindo?.y}`)
    const convite = await p.getByTestId('convite-app').getAttribute('data-modo').catch(() => null)
    ok(`${nome}: convite de instalar ${conviteEsperado ? `(${conviteEsperado})` : 'não aparece'}`, conviteEsperado ? convite === conviteEsperado : convite === null, String(convite))

    // Checkout: sem menu, botão principal visível.
    await p.evaluate(() => window.scrollTo(0, 0))
    await p.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().tap()
    await p.getByRole('button', { name: /Adicionar/ }).last().tap()
    await p.waitForTimeout(400)
    await p.getByText('Ver sacola').first().tap()
    await p.getByRole('button', { name: /^Retirada/ }).first().tap().catch(() => {})
    await p.getByRole('button', { name: /Continuar para pagamento/ }).last().tap()
    const tel = p.getByPlaceholder('(00) 00000-0000').first()
    await tel.waitFor({ timeout: 8000 })
    await tel.fill('27999880066')
    await p.locator('div').filter({ has: p.getByText('Informe seu telefone') }).last().getByRole('button', { name: /^Continuar$/i }).tap()
    await p.waitForTimeout(1000)
    const botao = p.getByRole('button', { name: /Ir para endereço|Continuar/ }).last()
    const bb = await botao.boundingBox()
    const navVisivel = await nav.isVisible().catch(() => false)
    ok(`${nome}: checkout sem o menu, botão principal visível`, !navVisivel && bb && bb.y + bb.height <= h, `${bb?.y}`)
    await foto()
    if (PRINTS) {
      const larg = 260
      const imgs = await Promise.all(quadros.map((b) => sharp(b).resize(larg).png().toBuffer()))
      const alt = Math.round(h * (larg / tela.viewport.width))
      await sharp({ create: { width: larg * imgs.length + 12 * (imgs.length - 1), height: alt, channels: 3, background: '#9CA3AF' } })
        .composite(imgs.map((input, i) => ({ input, left: i * (larg + 12), top: 0 }))).png().toFile(join(PRINTS, `${nome}.png`))
    }
    await ctx.close()
  }
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await browser.close()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
