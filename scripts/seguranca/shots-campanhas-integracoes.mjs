/**
 * Capturas de Campanhas › Métricas e Integrações em 6 larguras, com a checagem de
 * rolagem horizontal. Só stack local (loja camp-e2e-a semeada pelo e2e das campanhas).
 *
 *   SHOTS=<pasta> SUFIXO=antes|depois node scripts/seguranca/shots-campanhas-integracoes.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL, API_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
const SHOTS = process.env.SHOTS
const SUFIXO = process.env.SUFIXO ?? 'depois'
if (!SHOTS) { console.error('SHOTS=<pasta>'); process.exit(2) }
mkdirSync(SHOTS, { recursive: true })
const LARGURAS = [360, 390, 412, 768, 1366, 1920]

const res = []
const ok = (n, c, d = '') => { res.push({ n, c: !!c }); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

// Algo visível (fora de camadas fixas, como a gaveta fechada) passando da borda direita?
const estouro = (p) => p.evaluate(() => {
  const w = window.innerWidth
  const fixo = (e) => { for (let x = e; x; x = x.parentElement) if (getComputedStyle(x).position === 'fixed') return true; return false }
  const culpados = []
  for (const e of document.querySelectorAll('main *, [data-painel] *')) {
    const r = e.getBoundingClientRect()
    if (!r.width || !r.height || r.right <= w + 1 || fixo(e)) continue
    culpados.push(`${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} ${Math.round(r.right)}`)
  }
  return { doc: document.documentElement.scrollWidth, w, culpados: culpados.slice(0, 3) }
})

// O painel rola dentro de um contêiner: para a captura "página inteira" pegar tudo, o
// contêiner (e quem o prende na altura da tela) passa a crescer com o conteúdo.
const abrirRolagem = (p) => p.evaluate(() => {
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e)
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 2 && cs.position !== 'fixed') {
      for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
        if (getComputedStyle(x).position === 'fixed') break
        x.style.overflow = 'visible'; x.style.height = 'auto'; x.style.maxHeight = 'none'
      }
    }
  }
})

const browser = await chromium.launch()
try {
  for (const largura of LARGURAS) {
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura < 800 ? 844 : 900 }, locale: 'pt-BR', isMobile: largura < 800, hasTouch: largura < 800 })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', 'dono.campa')
    await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
    const dispensar = async () => { const b = p.getByRole('button', { name: /OK, entendi/ }).first(); await b.waitFor({ timeout: 2500 }).catch(() => {}); if (await b.isVisible().catch(() => false)) await b.click() }

    await p.goto(`${BASE}/admin/campanhas`, { waitUntil: 'networkidle' })
    await dispensar()
    await p.getByRole('tab', { name: 'Métricas' }).click()
    await p.getByTestId('metricas-campanhas').getByText(/Pedidos em 12h/i).first().waitFor({ timeout: 15000 })
    await p.waitForTimeout(600)
    const e1 = await estouro(p)
    ok(`${largura}px Métricas sem rolagem horizontal`, e1.doc <= e1.w + 1 && e1.culpados.length === 0, e1.culpados.join(' | ') || `${e1.doc}/${e1.w}`)
    await abrirRolagem(p)
    await p.screenshot({ path: join(SHOTS, `metricas-${largura}-${SUFIXO}.png`), fullPage: true })

    await p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'networkidle' })
    await dispensar()
    await p.getByTestId('robo-whatsapp').waitFor({ timeout: 15000 })
    await p.waitForTimeout(600)
    const e2 = await estouro(p)
    ok(`${largura}px Integrações sem rolagem horizontal`, e2.doc <= e2.w + 1 && e2.culpados.length === 0, e2.culpados.join(' | ') || `${e2.doc}/${e2.w}`)
    await abrirRolagem(p)
    await p.screenshot({ path: join(SHOTS, `integracoes-${largura}-${SUFIXO}.png`), fullPage: true })
    await ctx.close()
  }
} catch (e) {
  ok(`execução sem exceção: ${e.message}`, false)
} finally {
  await browser.close()
}
const f = res.filter((x) => !x.c)
console.log(`\n${res.length - f.length}/${res.length} verificações passaram`)
if (f.length) process.exit(1)
