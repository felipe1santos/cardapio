/**
 * Desempenho dos efeitos da vitrine (2026-10-01): celular simulado (390 px), CPU 4× mais
 * lenta (CDP Emulation.setCPUThrottlingRate), 6 s rolando a página com o aviso pulsando e a
 * faixa de cupom balançando. Mede quadros (rAF), quadros > 50 ms e long tasks; compara com
 * "reduzir movimento" (efeitos desligados). Imprime JSON.
 *
 *   node scripts/vitrine/medir-efeitos.mjs <url-da-vitrine>
 */
import { chromium, devices } from 'playwright'

const URL = process.argv[2] ?? 'http://127.0.0.1:3999/loja/ordem-qr-e2e'
const browser = await chromium.launch()

async function medir(reduzir) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, reducedMotion: reduzir ? 'reduce' : 'no-preference' })
  const p = await ctx.newPage()
  const cdp = await ctx.newCDPSession(p)
  await p.goto(URL, { waitUntil: 'networkidle' })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await p.evaluate(() => {
    window.__q = []; window.__lt = 0
    let ant = performance.now()
    const loop = (t) => { window.__q.push(t - ant); ant = t; if (window.__q.length < 2000) requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
    try { new PerformanceObserver((l) => { window.__lt += l.getEntries().length }).observe({ type: 'longtask', buffered: false }) } catch { /* sem suporte */ }
  })
  for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, i % 4 === 3 ? -300 : 220); await p.waitForTimeout(500) }
  const r = await p.evaluate(() => {
    const q = window.__q.slice(5)
    const media = q.reduce((s, x) => s + x, 0) / q.length
    return { quadros: q.length, mediaMs: Math.round(media * 10) / 10, fps: Math.round(1000 / media), lentos50ms: q.filter((x) => x > 50).length, longTasks: window.__lt }
  })
  const efeitos = await p.evaluate(() => [...document.querySelectorAll('.efeito-pulsar, .efeito-balancar')].map((e) => getComputedStyle(e).animationName))
  await ctx.close()
  return { ...r, efeitos }
}

const com = await medir(false)
const sem = await medir(true)
console.log(JSON.stringify({ url: URL, cpu: '4x', comEfeitos: com, reduzirMovimento: sem }, null, 2))
await browser.close()
