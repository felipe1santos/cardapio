/**
 * E2E — card do pedido no Kanban, mais limpo (2026-10-03). Loja local ordem-qr-e2e com os pedidos
 * de kanban-cards-semente.mjs (entrega, retirada, mesa, PDV, vitrine; nome longo, muitos itens,
 * valor alto; 4 min, 3 horas, 2 dias). Mede no navegador: fundos, cores, posições e tamanhos.
 *
 *   node scripts/seguranca/kanban-cards-semente.mjs criar
 *   node scripts/seguranca/e2e-kanban-card.mjs
 */
import { execSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const texto = (v) => JSON.stringify(v)

const b = await chromium.launch()
try {
  for (const [nome, vp] of [['desktop', { width: 1600, height: 1000 }], ['tablet', { width: 1024, height: 900 }], ['celular', { width: 390, height: 900 }]]) {
    console.log(`\n── ${nome} (${vp.width}) ──`)
    const ctx = await b.newContext({ viewport: vp, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', 'dono.ordemqr'); await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
    await p.locator('[data-testid^="pedido-"]').first().waitFor({ timeout: 15000 })
    await p.waitForTimeout(1200)
    const m = await p.evaluate(() => {
      const transparente = (el) => { const c = getComputedStyle(el).backgroundColor; return c === 'rgba(0, 0, 0, 0)' || c === 'transparent' }
      const botaoPronto = [...document.querySelectorAll('[data-testid^="pedido-"] button')].find((x) => /Pronto/.test(x.textContent))
      const verdePronto = botaoPronto ? getComputedStyle(botaoPronto).backgroundColor : null
      return [...document.querySelectorAll('[data-testid^="pedido-"]')].map((card) => {
        const q = (s) => card.querySelector(s)
        const preco = q('[data-testid="card-preco"]'), pag = q('[data-testid="info-pagamento"]'), ul = q('ul'), tempo = q('[data-testid="card-tempo"]')
        const r = (el) => el?.getBoundingClientRect()
        const selos = [...card.querySelectorAll('[data-testid="selo-origem"], [data-testid^="etiqueta-"]')]
        const botoes = [...card.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().height > 0)
        const ver = q('[data-testid="card-detalhes"]')
        const avanco = botoes.find((x) => /Aceitar|Pronto|Entregue|Saiu p\/ entrega/.test(x.textContent))
        const st = getComputedStyle(card)
        return {
          nome: card.querySelector('span.font-semibold')?.textContent?.trim().slice(0, 40),
          numeroEscuro: getComputedStyle(card.querySelector('span.bg-text-main') ?? card).backgroundColor,
          selosSemFundo: selos.length > 0 && selos.every(transparente) && selos.every((s) => s.querySelector('svg')),
          tempo: tempo?.textContent.trim(), tempoSemFundo: tempo ? transparente(tempo) : false, corTempo: tempo ? getComputedStyle(tempo).color : null,
          parado: /parado h[aá]/i.test(card.innerText),
          preco: { semFundo: preco ? transparente(preco) : false, cor: preco ? getComputedStyle(preco).color : null, peso: preco ? Number(getComputedStyle(preco).fontWeight) : 0 },
          verdePronto,
          pagamento: pag ? { abaixoDoValor: r(pag).top >= r(preco).bottom - 1, alinhadoDireita: Math.abs(r(pag).right - r(preco).right) <= 2, antesDosItens: !ul || r(pag).bottom <= r(ul).top + 40, texto: pag.innerText.replace(/\s+/g, ' ') } : null,
          itensPx: ul ? parseFloat(getComputedStyle(ul).fontSize) : null,
          ver: ver ? { texto: ver.textContent.trim(), iconeAntes: ver.firstElementChild?.tagName.toLowerCase() === 'svg' } : null,
          avanco: avanco ? { texto: avanco.textContent.trim(), setaDepois: avanco.lastElementChild?.tagName.toLowerCase() === 'svg' } : null,
          alturas: [...new Set(botoes.map((x) => Math.round(x.getBoundingClientRect().height)))],
          paddingTop: parseFloat(st.paddingTop), paddingBottom: parseFloat(st.paddingBottom),
          vaza: [...card.querySelectorAll('span, div, li, button')].some((e) => e.getClientRects().length && (e.getBoundingClientRect().right > card.getBoundingClientRect().right + 1 || e.getBoundingClientRect().left < card.getBoundingClientRect().left - 1)),
        }
      })
    })
    const larg = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vis: window.innerWidth }))
    ok('sem rolagem horizontal', larg.doc <= larg.vis + 1, texto(larg))
    ok(`${m.length} cards: selos (origem e atendimento) sem fundo, com ícone`, m.length >= 8 && m.every((c) => c.selosSemFundo), texto(m.filter((c) => !c.selosSemFundo).map((c) => c.nome)))
    ok('número do pedido continua no fundo escuro', m.every((c) => c.numeroEscuro !== 'rgba(0, 0, 0, 0)'))
    ok('nenhum selo "Parado há…" separado', m.every((c) => !c.parado))
    ok('tempo sem fundo', m.every((c) => c.tempoSemFundo))
    const t = Object.fromEntries(m.map((c) => [c.nome, c.tempo]))
    const achar = (prefixo) => Object.entries(t).find(([n]) => n?.startsWith(prefixo))?.[1]
    ok('tempo em minutos (< 1 h): "4 min"', /^\d+ min$/.test(achar('TESTE Card Vitrine') ?? ''), achar('TESTE Card Vitrine'))
    ok('tempo em horas: "3 horas"', achar('TESTE Card Cliente') === '3 horas', achar('TESTE Card Cliente'))
    ok('tempo em dias: "2 dias"', achar('TESTE Card Parado') === '2 dias', achar('TESTE Card Parado'))
    const corDe = (pref) => m.find((c) => c.nome?.startsWith(pref))?.corTempo
    ok('alerta de atraso mantido sem fundo: 2 dias em vermelho, 4 min em verde', corDe('TESTE Card Parado') === 'rgb(239, 68, 68)' && corDe('TESTE Card Vitrine') !== corDe('TESTE Card Parado'), `${corDe('TESTE Card Parado')} / ${corDe('TESTE Card Vitrine')}`)
    ok('valor sem fundo, negrito, no mesmo verde do botão Pronto', m.every((c) => c.preco.semFundo && c.preco.peso >= 700 && c.preco.cor === m[0].verdePronto), `${m[0].preco.cor} × ${m[0].verdePronto}`)
    const comPag = m.filter((c) => c.pagamento)
    ok('forma de pagamento logo abaixo do valor, alinhada à direita, antes dos itens', comPag.length >= 6 && comPag.every((c) => c.pagamento.abaixoDoValor && c.pagamento.alinhadoDireita && c.pagamento.antesDosItens), texto(comPag.filter((c) => !(c.pagamento.abaixoDoValor && c.pagamento.alinhadoDireita)).map((c) => c.nome)))
    ok('formato "Forma · status" (ex.: "Pix · Pago", "Dinheiro · A receber na entrega")', comPag.every((c) => / · /.test(c.pagamento.texto)), comPag[0]?.pagamento.texto)
    ok('mesa sem forma de pagamento no card', !m.find((c) => c.nome?.startsWith('TESTE Card Mesa'))?.pagamento)
    ok('itens maiores (13 px)', m.every((c) => !c.itensPx || c.itensPx >= 13), texto([...new Set(m.map((c) => c.itensPx))]))
    ok('"Detalhes" virou "Ver" com olho antes do texto', m.every((c) => c.ver?.texto === 'Ver' && c.ver.iconeAntes))
    ok('botões de avanço com seta → depois do texto', m.filter((c) => c.avanco).every((c) => c.avanco.setaDepois), texto(m.filter((c) => c.avanco).map((c) => c.avanco.texto)))
    ok('botões do card na mesma altura', m.every((c) => c.alturas.length === 1), texto(m.map((c) => c.alturas)))
    ok('card mais compacto (espaço em cima ≤ 8 px, embaixo ≤ 10 px)', m.every((c) => c.paddingTop <= 8 && c.paddingBottom <= 10), texto([...new Set(m.map((c) => `${c.paddingTop}/${c.paddingBottom}`))]))
    ok('nome longo, valor alto e muitos itens não vazam do card', m.every((c) => !c.vaza), texto(m.filter((c) => c.vaza).map((c) => c.nome)))
    if (nome === 'desktop') {
      await p.getByTestId('kanban-tela-cheia').click().catch(async () => { await p.getByTestId('kanban-mais').click(); await p.locator('text=Tela cheia').last().click() })
      await p.waitForTimeout(800)
      const cheia = await p.evaluate(() => ({ cards: document.querySelectorAll('[data-testid^="pedido-"]').length, horizontal: document.documentElement.scrollWidth > window.innerWidth + 1 }))
      ok('tela cheia do Kanban: cards visíveis, sem rolagem lateral', cheia.cards >= 8 && !cheia.horizontal, texto(cheia))
    }
    await ctx.close()
  }
} finally {
  await b.close()
}

console.log('\n── Despacho de rotas ──')
const diff = execSync('git diff --stat origin/main -- components/pedidos/rota-panel.tsx components/pedidos/rota-map.tsx components/maps components/ui/badge.tsx components/ui/button.tsx', { encoding: 'utf8' }).trim()
ok('tela "Despacho de rotas" sem nenhuma alteração (rota-panel, rota-map, mapas, Badge e Button intactos)', diff === '', diff)

const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
