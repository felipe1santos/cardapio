// Responsividade do Kanban (cards e Detalhes) e do card preto em 6 tamanhos de tela.
// Só navegação e leitura (banco LOCAL); nenhum pedido é criado aqui.
//   node scripts/seguranca/e2e-responsivo-kanban.mjs [pasta-de-screenshots]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
exigirLoopback(BASE)
const SHOTS = process.argv[2] ?? null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const TELAS = [[360, 800], [390, 844], [412, 915], [768, 1024], [1366, 768], [1920, 1080]]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? '✔' : '✘'} ${n}${d ? ` — ${d}` : ''}`) }

const browser = await chromium.launch()
try {
  for (const [w, h] of TELAS) {
    const t = `${w}x${h}`
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', isMobile: w < 900, hasTouch: w < 900 })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', 'gerente.local')
    await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin')), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
    await p.waitForTimeout(1000)

    const medida = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-testid^="pedido-"]')]
      const fora = (el, card) => { const a = el.getBoundingClientRect(), b = card.getBoundingClientRect(); return a.left < b.left - 1 || a.right > b.right + 1 }
      const problemas = []
      for (const card of cards) {
        const n = card.getAttribute('data-testid')
        const preco = card.querySelector('[data-testid="card-preco"]')
        if (preco && preco.getBoundingClientRect().height > 34) problemas.push(`${n}: preço quebrou linha`)
        for (const b of card.querySelectorAll('button, [data-testid="card-na-logistica"]')) {
          if (b.scrollWidth > b.clientWidth + 1) problemas.push(`${n}: "${b.textContent.trim()}" cortado`)
          if (b.getBoundingClientRect().height > 48) problemas.push(`${n}: "${b.textContent.trim()}" em 2 linhas`)
        }
        for (const e of card.querySelectorAll('[data-testid^="etiqueta-"]')) if (fora(e, card)) problemas.push(`${n}: etiqueta saiu do card`)
        // Nada (nome longo, bairro, itens) vaza do card na horizontal.
        for (const e of card.querySelectorAll('span, div, li')) if (e.getClientRects().length && fora(e, card)) { problemas.push(`${n}: "${e.textContent.trim().slice(0, 30)}" saiu do card`); break }
        const atend = card.querySelector('[data-testid="etiqueta-entrega"], [data-testid="etiqueta-retirada"], [data-testid="etiqueta-mesa"]')
        if (!atend) problemas.push(`${n}: sem etiqueta RETIRADA/ENTREGA/MESA`)
        if (![...card.querySelectorAll('span')].some((s) => ['PDV', 'Salão', 'Delivery'].includes(s.textContent.trim()))) problemas.push(`${n}: sem etiqueta de origem`)
        if (!card.querySelector('[title="Tempo desde que o pedido chegou"] svg.lucide-clock')) problemas.push(`${n}: cronômetro sem relógio`)
        if (atend?.getAttribute('data-testid') === 'etiqueta-entrega' && !atend.querySelector('path[d="M3 16.5V15a9 9 0 0 1 17.6-2.7"]')) problemas.push(`${n}: ENTREGA sem capacete`)
        if (/não verif|\b(Pix|Dinheiro|Cartão)\b/i.test(card.innerText)) problemas.push(`${n}: pagamento/"não verif." no resumo do card`)
        // Preço na MESMA linha do nome/mesa; itens usam a largura toda (sem coluna do preço);
        // sem o texto repetido "PDV · …"/"Salão · …" no corpo.
        const nome = card.querySelector('span.truncate.font-semibold')
        if (preco && nome) {
          const a = nome.getBoundingClientRect(), b = preco.getBoundingClientRect()
          if (b.bottom < a.top || b.top > a.bottom) problemas.push(`${n}: preço fora da linha do nome`)
          if (a.right > b.left + 1) problemas.push(`${n}: nome invade o preço`)
        }
        const itens = card.querySelector('ul')
        if (itens && nome && itens.getBoundingClientRect().right < preco.getBoundingClientRect().right - 2) problemas.push(`${n}: resumo dos itens com coluna vazia à direita`)
        if (/(PDV|Salão) · /.test(card.innerText)) problemas.push(`${n}: texto repetido "PDV/Salão · …" no card`)
      }
      return { cards: cards.length, horizontal: document.documentElement.scrollWidth > window.innerWidth + 1, problemas }
    })
    ok(`${t} Kanban sem rolagem horizontal`, !medida.horizontal)
    ok(`${t} ${medida.cards} card(s): preço numa linha, botões inteiros, etiquetas no card`, medida.cards > 0 && medida.problemas.length === 0, medida.problemas.slice(0, 3).join(' | '))
    if (SHOTS) await p.screenshot({ path: join(SHOTS, `${t}-kanban.png`) })

    const primeiro = p.locator('[data-testid^="pedido-"]').first()
    await primeiro.scrollIntoViewIfNeeded()
    await primeiro.getByTestId('card-detalhes').click()
    await p.waitForTimeout(500)
    const det = await p.evaluate(() => {
      const et = document.querySelector('[data-testid="etiquetas-pedido"]')
      const r = et?.getBoundingClientRect()
      return { tem: !!et, dentro: r ? r.right <= window.innerWidth + 1 && r.left >= 0 : false, horizontal: document.documentElement.scrollWidth > window.innerWidth + 1 }
    })
    ok(`${t} Detalhes com etiquetas visíveis e dentro da tela`, det.tem && det.dentro && !det.horizontal)
    if (SHOTS) await p.screenshot({ path: join(SHOTS, `${t}-detalhes.png`) })

    await p.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
    await p.getByTestId('card-balcao').click()
    await p.getByTestId('balcao-novo').click()
    await p.getByTestId('balcao-modalidade-entrega').click()
    await p.waitForTimeout(300)
    const modal = await p.evaluate(() => {
      const f = document.querySelector('[role="dialog"] form')
      const r = f?.getBoundingClientRect()
      const cortados = [...(f?.querySelectorAll('button') ?? [])].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim())
      return { dentro: r ? r.left >= 0 && r.right <= window.innerWidth + 1 : false, cortados, horizontal: document.documentElement.scrollWidth > window.innerWidth + 1 }
    })
    ok(`${t} card preto (Entrega) cabe na tela sem botão cortado`, modal.dentro && modal.cortados.length === 0 && !modal.horizontal, modal.cortados.join(', '))
    if (SHOTS) await p.screenshot({ path: join(SHOTS, `${t}-card-preto.png`) })
    await ctx.close()
  }
} catch (e) {
  ok('execução', false, e.message.split('\n')[0])
} finally {
  await browser.close()
}
const f = res.filter((x) => !x).length
console.log(`\n${res.length - f}/${res.length} passaram`)
process.exit(f ? 1 : 0)
