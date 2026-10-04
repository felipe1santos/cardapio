/**
 * Capturas do Financeiro para o redesign "estilo Meta" (item 4b, 2026-10-04).
 * Loja local `fin6-e2e` (dono.fin6 / caixa.fin6). Para cada tela e aba, no desktop (1366) e no celular (390):
 *   - print em docs/financeiro-redesign/<rotulo>/;
 *   - retrato dos valores exibidos (todo "R$ …", % e data-valor) em valores-<rotulo>.json — antes × depois
 *     têm que ser IGUAIS (o redesign é só visual);
 *   - contraste de todo texto visível da área do financeiro (WCAG: 4,5:1; 3:1 para texto grande).
 * Não grava nada: só navega, abre janelas e cancela.
 *
 *   node scripts/financeiro/capturas-redesign.mjs antes|depois [--sem-prints]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const ROTULO = process.argv[2] ?? 'depois'
const PRINTS = !process.argv.includes('--sem-prints')
const PASTA = join('docs', 'financeiro-redesign', ROTULO)
mkdirSync(PASTA, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const SENHA = 'demo-local-123456'

const TELAS = [
  ['caixa'], ['fluxo'], ['motoboys'], ['pix'], ['movimentacoes'],
  ['cmv', 'precos'], ['cmv', 'insumos'], ['cmv', 'vendas'], ['cmv', 'config'],
  ['contas', 'pagar'], ['contas', 'receber'], ['contas', 'compras'], ['contas', 'dre'], ['contas', 'cadastros'],
  ['dashboard'], ['auditoria'], ['risco'], ['regras'],
]

const browser = await chromium.launch()
async function logar(login, opcoes) {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  await p.getByTestId('abertura-rapida-depois').click({ timeout: 1500 }).catch(() => {})
  return { ctx, p }
}

/** Valores exibidos na área do financeiro (sem o topo do sistema). */
const valores = (p) => p.evaluate(() => {
  const area = document.querySelector('[data-financeiro-area]') ?? document.querySelector('div.space-y-4.overflow-y-auto') ?? document.body
  const txt = area.innerText
  const dinheiro = (txt.match(/−?-?R\$\s?[\d.]+,\d{2}/g) ?? []).map((s) => s.replace(/\s/g, '').replace('−', '-'))
  const pct = (txt.match(/-?\d+(?:,\d+)?%/g) ?? [])
  const dv = [...area.querySelectorAll('[data-valor]')].map((e) => `${e.getAttribute('data-testid') ?? ''}=${e.getAttribute('data-valor')}`)
  return { dinheiro: dinheiro.sort(), pct: pct.sort(), dataValor: dv.sort() }
})

/** Contraste de todo texto visível da área (cor do texto × fundo efetivo, subindo até achar um fundo sólido). */
const contraste = (p, todaTela = false) => p.evaluate((todaTela) => {
  const area = todaTela ? document.body : (document.querySelector('[data-financeiro-raiz]') ?? document.querySelector('div.space-y-4.overflow-y-auto') ?? document.body)
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const rgb = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { c: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 } }
  const mistura = (fg, bg) => fg.c.map((x, i) => x * fg.a + bg[i] * (1 - fg.a))
  function fundo(el) {
    const pilha = []
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/url\(/.test(cs.backgroundImage)) {
        const cores = [...cs.backgroundImage.matchAll(/rgba?\([^)]+\)|#[0-9a-f]{6}/gi)].map((m) => m[0])
        const c = cores.map((x) => x.startsWith('#') ? { c: [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16)), a: 1 } : rgb(x)).filter(Boolean)
        if (c.length) { pilha.push(c.reduce((a, b) => a.c[0] + a.c[1] + a.c[2] < b.c[0] + b.c[1] + b.c[2] ? b : a)); if (c.every((x) => x.a >= 1)) break }
      }
      const b = rgb(cs.backgroundColor)
      if (b && b.a > 0) { pilha.push(b); if (b.a >= 1) break }
    }
    let cor = [255, 255, 255]
    for (const b of pilha.reverse()) cor = mistura(b, cor)
    return cor
  }
  const falhas = []
  let total = 0
  const andar = document.createTreeWalker(area, NodeFilter.SHOW_TEXT)
  const vistos = new Set()
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const el = n.parentElement
    if (!el || vistos.has(el) || !n.textContent.trim()) continue
    vistos.add(el)
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    if (el.closest('svg, [aria-hidden="true"], button:disabled, [disabled], input, select, textarea, option')) continue
    let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
    const fg = rgb(cs.color); if (!fg) continue
    const bg = fundo(el)
    const cor = mistura({ c: fg.c, a: fg.a * op }, bg)
    const [l1, l2] = [lum(cor), lum(bg)].sort((a, b) => b - a)
    const razao = (l1 + 0.05) / (l2 + 0.05)
    const px = parseFloat(cs.fontSize), peso = Number(cs.fontWeight)
    const grande = px >= 24 || (px >= 18.66 && peso >= 700)
    total++
    if (razao < (grande ? 3 : 4.5)) falhas.push({ texto: n.textContent.trim().slice(0, 40), razao: Math.round(razao * 100) / 100, cor: cs.color, fundo: `rgb(${bg.map(Math.round).join(',')})`, px })
  }
  return { total, falhas }
}, todaTela)

const relatorio = { rotulo: ROTULO, telas: {} }
async function abrirTela(p, secao, aba) {
  await p.goto(`${BASE}/admin/financeiro?secao=${secao}`, { waitUntil: 'networkidle' })
  await p.getByTestId('abertura-rapida-depois').click({ timeout: 800 }).catch(() => {})
  if (aba) await p.getByTestId(`${secao === 'cmv' ? 'cmv' : 'contas'}-aba-${aba}`).click({ timeout: 5000 }).catch(() => {})
  await p.waitForTimeout(1600)
}

try {
  for (const [disp, opcoes] of [['desktop', { viewport: { width: 1366, height: 860 } }], ['celular', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['Pixel 7'].userAgent }]]) {
    const { ctx, p } = await logar('dono.fin6', opcoes)
    for (const [secao, aba] of TELAS) {
      const nome = `${secao}${aba ? '-' + aba : ''}`
      await abrirTela(p, secao, aba)
      const chave = `${nome}@${disp}`
      relatorio.telas[chave] = { valores: await valores(p), contraste: await contraste(p) }
      if (PRINTS) await p.screenshot({ path: join(PASTA, `${nome}-${disp}.png`), fullPage: disp === 'desktop' })
    }
    // Janelas: fechamento (se o caixa estiver aberto) e abertura (se fechado), cancelando sempre.
    await abrirTela(p, 'caixa')
    if (await p.getByTestId('caixa-fechar').isVisible().catch(() => false)) {
      await p.getByTestId('caixa-fechar').click(); await p.waitForTimeout(800)
      if (PRINTS) await p.screenshot({ path: join(PASTA, `janela-fechamento-${disp}.png`) })
      relatorio.telas[`janela-fechamento@${disp}`] = { contraste: await contraste(p, true) }
      await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    } else if (await p.getByTestId('caixa-abrir').isVisible().catch(() => false)) {
      await p.getByTestId('caixa-abrir').click(); await p.waitForTimeout(800)
      if (PRINTS) await p.screenshot({ path: join(PASTA, `janela-abertura-${disp}.png`) })
      relatorio.telas[`janela-abertura@${disp}`] = { contraste: await contraste(p, true) }
      await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    }
    await ctx.close()
    // Aprovação por PIN: o caixa pede uma sangria acima do limite e cancela (nada é gravado).
    const cx = await logar('caixa.fin6', opcoes)
    await abrirTela(cx.p, 'movimentacoes')
    const sangria = cx.p.getByTestId('mov-sangria')
    if (await sangria.isVisible().catch(() => false)) {
      await sangria.click(); await cx.p.getByTestId('mov-valor').fill('999,00'); await cx.p.getByTestId('mov-motivo').fill('TESTE captura do redesign')
      await cx.p.getByTestId('mov-confirmar').click(); await cx.p.waitForTimeout(1200)
      if (PRINTS) await cx.p.screenshot({ path: join(PASTA, `janela-aprovacao-${disp}.png`) })
      relatorio.telas[`janela-aprovacao@${disp}`] = { contraste: await contraste(cx.p, true) }
    }
    await cx.ctx.close()
  }
} finally {
  await browser.close()
}
writeFileSync(join(PASTA, `valores-${ROTULO}.json`), JSON.stringify(relatorio, null, 1))
const falhas = Object.entries(relatorio.telas).flatMap(([t, r]) => (r.contraste?.falhas ?? []).map((f) => ({ tela: t, ...f })))
console.log(`telas: ${Object.keys(relatorio.telas).length} · textos conferidos: ${Object.values(relatorio.telas).reduce((s, r) => s + (r.contraste?.total ?? 0), 0)} · abaixo do contraste: ${falhas.length}`)
for (const f of falhas.slice(0, 40)) console.log(`   ${f.tela}: "${f.texto}" ${f.razao}:1 (${f.cor} em ${f.fundo}, ${f.px}px)`)
