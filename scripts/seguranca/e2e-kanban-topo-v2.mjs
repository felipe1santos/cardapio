import { readFileSync } from 'node:fs'
/**
 * E2E — Topo do painel v2 (2026-10-03): Kanban sem título, controles só ícone com dica, botões do
 * sistema à direita numa linha só, cores vivas (contraste ≥ 4,5:1) e popups/menus/dicas SEMPRE por
 * cima (portal no body, z-index 9999, dentro da tela) — no Kanban e nas telas principais.
 * Loja local `ordem-qr-e2e` (semear-cardapio-ordem.mjs + kanban-cards-semente.mjs). Não cria pedidos.
 *
 *   node scripts/seguranca/e2e-kanban-topo-v2.mjs
 */
import { execSync } from 'node:child_process'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const loja = (await db.query(`select id, impressao_aceitar_pedidos_automaticamente auto from restaurantes where slug=$1`, [SLUG])).rows[0]
if (!loja) { console.error('Rode antes semear-cardapio-ordem.mjs'); process.exit(2) }
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)

/** Mede a barra: uma linha só, controles à esquerda, sistema à direita, nada sobreposto. */
function medirTopo() {
  const h = document.querySelector('[data-testid="topo"]')
  const esq = document.querySelector('[data-testid="topo-esquerda"]')
  const sis = document.querySelector('[data-testid="topo-sistema"]')
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const botoes = (raiz) => [...raiz.querySelectorAll('button, a, [data-testid="kanban-rotas-desligado"]')].filter((b) => vis(b) && !b.closest('[data-testid="kanban-rotas-desligado"] button') && !(b.parentElement?.closest('button, a')))
  const rEsq = botoes(esq).map((b) => b.getBoundingClientRect())
  const rSis = botoes(sis).map((b) => b.getBoundingClientRect())
  const todos = [...rEsq, ...rSis]
  const centro = (r) => (r.top + r.bottom) / 2
  const c0 = centro(todos[0])
  let sobrepostos = 0
  for (let i = 0; i < todos.length; i++) for (let j = i + 1; j < todos.length; j++) {
    const a = todos[i], b = todos[j]
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) sobrepostos++
  }
  const titulo = document.querySelector('header h1')
  const tr = titulo?.parentElement?.getBoundingClientRect()
  return {
    alturaTopo: Math.round(h.getBoundingClientRect().height),
    umaLinha: todos.every((r) => Math.abs(centro(r) - c0) < 4),
    sistemaADireita: Math.min(...rSis.map((r) => r.left)) >= Math.max(...rEsq.map((r) => r.right)),
    folgaDireita: Math.round(window.innerWidth - Math.max(...rSis.map((r) => r.right))),
    dentroDaTela: todos.every((r) => r.left >= 0 && r.right <= window.innerWidth + 0.5),
    sobrepostos,
    rolagemLateral: document.documentElement.scrollWidth > window.innerWidth + 1,
    tituloVisivel: !!tr && tr.width > 2 && tr.height > 2,
    nSistema: rSis.length,
  }
}

/** Popup aberto: no body (portal), z 9999, inteiro na tela e no topo da pilha (nada por cima). */
function medirPopup(testid) {
  const el = document.querySelector(`[data-testid="${testid}"]`)
  if (!el) return { existe: false }
  const r = el.getBoundingClientRect()
  const pontos = [[r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [r.left + r.width / 2, r.top + Math.min(r.height - 6, 40)], [r.left + 6, r.bottom - 6], [r.right - 6, r.bottom - 6]]
  const porCima = pontos.every(([x, y]) => { const t = document.elementFromPoint(x, y); return !!t && el.contains(t) })
  return {
    existe: true,
    noBody: el.parentElement === document.body,
    z: getComputedStyle(el).zIndex,
    dentro: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5,
    porCima,
  }
}

/** Contraste WCAG entre o texto e o fundo sólido do próprio elemento. */
function contraste(sel) {
  const el = document.querySelector(sel)
  if (!el) return null
  const cs = getComputedStyle(el)
  const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor))
  return { razao: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100, fundo: cs.backgroundColor, cor: cs.color }
}

async function logar(b, vp, extra = {}) {
  const ctx = await b.newContext({ viewport: vp, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...extra })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.ordemqr'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}
async function abrirKanban(p) {
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await p.getByTestId('topo-controles').waitFor({ timeout: 20000 })
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 1500 }).catch(() => {})
  await p.waitForTimeout(900)
}
const dicaDe = async (p, testid) => {
  await p.mouse.move(1, 500)
  await p.getByTestId(testid).hover()
  const d = p.getByTestId('dica')
  await d.waitFor({ timeout: 2000 }).catch(() => {})
  const t = await d.innerText().catch(() => '')
  const m = await p.evaluate(() => { const el = document.querySelector('[data-testid="dica"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { noBody: el.parentElement === document.body, z: getComputedStyle(el).zIndex, dentro: r.left >= 0 && r.right <= innerWidth + 0.5 && r.top >= 0 } })
  return { t, m }
}

const b = await chromium.launch()
try {
  await db.query(`update restaurantes set impressao_aceitar_pedidos_automaticamente=false where id=$1`, [loja.id])

  secao('1. Kanban — uma linha só em todos os tamanhos')
  for (const [nome, vp, extra] of [
    ['1920', { width: 1920, height: 1000 }, {}],
    ['1366', { width: 1366, height: 768 }, {}],
    ['tablet 1024', { width: 1024, height: 768 }, { isMobile: true, hasTouch: true }],
    ['tablet 768', { width: 768, height: 1024 }, { isMobile: true, hasTouch: true }],
    ['celular 390', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }],
    ['celular 360', { width: 360, height: 740 }, { isMobile: true, hasTouch: true }],
  ]) {
    const { ctx, p } = await logar(b, vp, extra)
    await abrirKanban(p)
    const g = await p.evaluate(medirTopo)
    ok(`${nome}: título "Painel de Pedidos" fora da vista (só leitor de tela)`, !g.tituloVisivel && (await p.locator('header h1').innerText()) === 'Painel de Pedidos')
    ok(`${nome}: tudo numa linha, sem sobreposição, dentro da tela`, g.umaLinha && g.sobrepostos === 0 && g.dentroDaTela && !g.rolagemLateral, texto(g))
    ok(`${nome}: controles à esquerda, botões do sistema colados à direita`, g.sistemaADireita && g.folgaDireita <= 24 && g.nSistema >= 4, texto({ folga: g.folgaDireita, n: g.nSistema }))
    ok(`${nome}: barra baixa (≤ 64 px)`, g.alturaTopo <= 64, `${g.alturaTopo}px`)
    // Silenciar aparece quando há pedido esperando: a linha continua cabendo.
    if (nome.startsWith('celular')) {
      const vis = async (id) => p.getByTestId(id).isVisible().catch(() => false)
      ok(`${nome}: Som/Aceite/Rotas saem da barra (vão para o Mais)`, !(await vis('kanban-som')) && !(await vis('kanban-aceite')) && !(await vis('kanban-rotas')) && await vis('kanban-mais'))
      await p.getByTestId('kanban-mais').tap()
      const m = await p.evaluate(medirPopup, 'kanban-mais-menu')
      ok(`${nome}: menu Mais por cima, inteiro na tela, com Som e Aceite`, m.existe && m.noBody && m.z === '9999' && m.dentro && m.porCima && await vis('kanban-aceite-menu'), texto(m))
      await p.keyboard.press('Escape')
      ok(`${nome}: Esc fecha o Mais`, !(await vis('kanban-mais-menu')))
      await p.getByTestId('avisos-icone').tap()
      const a = await p.evaluate(medirPopup, 'avisos-painel')
      ok(`${nome}: popup de avisos por cima e inteiro na tela`, a.existe && a.noBody && a.dentro && a.porCima, texto(a))
      await p.mouse.click(5, 700)
      ok(`${nome}: clique fora fecha os avisos`, !(await vis('avisos-painel')))
    } else {
      // Item 58: o capacete saiu da barra (virou o botão "Despachar" no canto) e entrou a tela cheia (só a partir de lg).
      const tam = await p.evaluate(() => ['kanban-som', 'kanban-silenciar', 'kanban-aceite', 'kanban-tela-cheia', 'kanban-mais', 'avisos-icone'].map((id) => document.querySelector(`[data-testid="${id}"]`)).filter((el) => el && el.getBoundingClientRect().width > 0).map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), el.textContent.trim()] }))
      ok(`${nome}: Som/Aceite/Tela cheia/Mais/avisos só ícone, quadrados de 44 px`, tam.length >= 4 && tam.every(([w, h, t]) => w === 44 && h === 44 && /^\d*$/.test(t)), texto(tam))
      for (const id of ['avisos-icone', 'kanban-mais']) {
        await p.getByTestId(id).click()
        const alvo = id === 'avisos-icone' ? 'avisos-painel' : 'kanban-mais-menu'
        const m = await p.evaluate(medirPopup, alvo)
        ok(`${nome}: ${alvo} por cima de tudo (body, z 9999), inteiro na tela`, m.existe && m.noBody && m.z === '9999' && m.dentro && m.porCima, texto(m))
        await p.keyboard.press('Escape')
      }
      await p.getByTestId('kanban-status-loja').click()
      const s = await p.evaluate(medirPopup, 'kanban-status-menu')
      ok(`${nome}: menu do status da loja por cima e na tela`, s.existe && s.noBody && s.dentro && s.porCima, texto(s))
      await p.keyboard.press('Escape')
      await p.getByTestId('topo-conta').click()
      const c = await p.evaluate(medirPopup, 'topo-conta-menu')
      ok(`${nome}: menu da conta por cima e na tela`, c.existe && c.noBody && c.dentro && c.porCima, texto(c))
      await p.keyboard.press('Escape')
    }
    await ctx.close()
  }

  secao('2. Kanban — dicas, estados e cores vivas (1366)')
  {
    const { ctx, p } = await logar(b, { width: 1366, height: 768 })
    await abrirKanban(p)
    if (await p.getByTestId('kanban-silenciar').isVisible().catch(() => false)) await p.getByTestId('kanban-silenciar').click()
    const somId = 'kanban-som'
    const d1 = await dicaDe(p, somId)
    const ligado1 = (await p.getByTestId(somId).getAttribute('aria-pressed')) === 'true'
    ok('dica do Som diz o estado e a ação', (ligado1 ? /Som de pedido novo ligado – clique para desligar/ : /desligado – clique para ligar/).test(d1.t), d1.t)
    ok('dica por cima de tudo (body, z 9999) e dentro da tela', d1.m?.noBody && d1.m?.z === '9999' && d1.m?.dentro, texto(d1.m))
    const cor1 = await p.evaluate(contraste, `[data-testid="${somId}"]`)
    await p.getByTestId(somId).click()
    const ligado2 = (await p.getByTestId(somId).getAttribute('aria-pressed')) === 'true'
    const cor2 = await p.evaluate(contraste, `[data-testid="${somId}"]`)
    const d2 = await dicaDe(p, somId)
    ok('clicar alterna o Som (aria-pressed, cor e dica mudam)', ligado1 !== ligado2 && cor1.fundo !== cor2.fundo && d1.t !== d2.t, `${cor1.fundo} → ${cor2.fundo}`)
    const azul = ligado2 ? cor2 : cor1, cinza = ligado2 ? cor1 : cor2
    // Item 58: estilo dos cards do Fluxo de caixa — fundo clarinho e ícone colorido.
    ok('Som ligado = azul claro com ícone azul; desligado = cinza claro com ícone cinza', azul.fundo === 'rgb(224, 242, 254)' && azul.cor === 'rgb(3, 105, 161)' && cinza.fundo === 'rgb(241, 242, 244)' && cinza.cor === 'rgb(75, 85, 99)', texto({ azul, cinza }))
    if (ligado2 !== ligado1) await p.getByTestId(somId).click() // volta como estava
    const da = await dicaDe(p, 'kanban-aceite')
    ok('dica do Aceite automático diz o estado', /Aceite automático (ligado|desligado) – /.test(da.t), da.t)
    const dm = await dicaDe(p, 'kanban-mais')
    ok('dica do Mais', /Mais opções/.test(dm.t), dm.t)
    const dr = await dicaDe(p, 'kanban-tela-cheia')
    ok('dica da Tela cheia', /Tela cheia/.test(dr.t), dr.t)
    const rotulos = await p.evaluate(() => ['kanban-status-loja', 'kanban-som|kanban-silenciar', 'kanban-aceite', 'kanban-mais', 'avisos-icone', 'topo-impressora', 'topo-duvidas', 'topo-conta'].map((ids) => [ids, ids.split('|').map((id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-label')).find(Boolean) ?? '']))
    ok('todos os botões com aria-label', rotulos.every(([, l]) => l.length > 3), texto(rotulos.filter(([, l]) => l.length <= 3)))
    const st = await p.evaluate(contraste, '[data-testid="kanban-status-loja"]')
    const stTexto = await p.getByTestId('kanban-status-loja').innerText()
    ok('status com texto (Recebendo pedidos/Loja fechada · Manual/Automático) em verde/vermelho claro', /Recebendo pedidos|Loja fechada/.test(stTexto) && /Manual|Automático/.test(stTexto) && ['rgb(220, 252, 231)', 'rgb(254, 226, 226)'].includes(st.fundo), `${stTexto.replace(/\s+/g, ' ')} ${st.fundo}`)
    const contrastes = {}
    for (const sel of ['kanban-status-loja', 'kanban-som', 'kanban-silenciar', 'kanban-aceite', 'kanban-mais', 'avisos-icone', 'topo-duvidas']) { const c = await p.evaluate(contraste, `[data-testid="${sel}"]`); if (c) contrastes[sel] = c.razao }
    ok('contraste ≥ 4,5:1 em todos os botões coloridos', Object.keys(contrastes).length >= 6 && Object.values(contrastes).every((r) => r >= 4.5), texto(contrastes))
    // Aceite: ligado roxo vivo, desligado cinza; volta como estava.
    const ac1 = (await p.getByTestId('kanban-aceite').getAttribute('aria-pressed')) === 'true'
    await p.getByTestId('kanban-aceite').click(); await p.waitForTimeout(600)
    const ac2 = (await p.getByTestId('kanban-aceite').getAttribute('aria-pressed')) === 'true'
    const cAc = await p.evaluate(contraste, '[data-testid="kanban-aceite"]')
    ok('Aceite alterna e muda de cor (roxo claro / cinza claro)', ac1 !== ac2 && cAc.fundo === (ac2 ? 'rgb(243, 232, 255)' : 'rgb(241, 242, 244)') && cAc.razao >= 4.5, texto(cAc))
    await p.getByTestId('kanban-aceite').click(); await p.waitForTimeout(600)
    // Métricas e Entregas moram no Mais; a Tela cheia virou botão da barra (item 58), e o Mais
    // ganhou Despacho aberto e Entregar sem entregador.
    await p.getByTestId('kanban-mais').click()
    ok('Mais tem Testar som, repetição, Métricas, Entregas, Despacho aberto e Entregar sem entregador', await p.getByTestId('kanban-testar-som').isVisible() && await p.getByTestId('kanban-metricas').isVisible() && await p.getByTestId('kanban-entregas').isVisible() && await p.getByTestId('kanban-despacho-aberto').isVisible() && await p.getByTestId('kanban-sem-entregador').isVisible())
    const resumo = async () => p.getByTestId('cards-resumo-pedidos').isVisible().catch(() => false)
    const antes = await resumo()
    await p.getByTestId('kanban-metricas').click()
    ok('Métricas pelo Mais alterna a barra de métricas', (await resumo()) !== antes)
    await p.getByTestId('kanban-mais').click(); await p.getByTestId('kanban-metricas').click()
    // Tela cheia (item 58): só as colunas e o Despachar — sem topo; sai pelo botão ou pelo Esc.
    await p.keyboard.press('Escape')
    await p.getByTestId('kanban-tela-cheia').click()
    await p.waitForTimeout(800)
    ok('tela cheia: sem a barra de cima, com o botão de sair', (await p.locator('[data-testid="topo"]').count()) === 0 && await p.getByTestId('sair-tela-cheia-kanban').isVisible())
    await p.getByTestId('sair-tela-cheia-kanban').click()
    await p.waitForTimeout(800)
    ok('sair da tela cheia devolve a barra', await p.locator('[data-testid="topo"]').isVisible())
    // Regressão: o card abre o painel lateral, e o Esc fecha (o Mais não rouba o Esc).
    const card = p.locator('[data-testid^="pedido-"]').first()
    if (await card.count()) {
      await card.click({ position: { x: 30, y: 20 } })
      ok('card abre o painel lateral', await p.getByTestId('painel-pedido').isVisible({ timeout: 3000 }).catch(() => false))
      await p.keyboard.press('Escape')
      ok('Esc fecha o painel lateral', !(await p.getByTestId('painel-pedido').isVisible().catch(() => false)))
    }
    await ctx.close()
  }

  secao('3. Telas principais — sistema à direita numa linha e popups por cima')
  const TELAS = [['Mesas', '/admin/mesas'], ['Cardápio', '/admin/cardapio'], ['Clientes', '/admin/clientes'], ['Financeiro', '/admin/financeiro'], ['Integrações', '/admin/integracoes'], ['Dashboard', '/admin/dashboard'], ['Logística', '/admin/logistica'], ['Impressão', '/admin/impressao']]
  for (const [nome, vp, extra] of [['1366', { width: 1366, height: 768 }, {}], ['celular', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }]]) {
    const { ctx, p } = await logar(b, vp, extra)
    for (const [tela, url] of TELAS) {
      await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
      await p.getByTestId('topo-sistema').waitFor({ timeout: 15000 }).catch(() => {})
      await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 800 }).catch(() => {})
      const g = await p.evaluate(() => {
        const sis = document.querySelector('[data-testid="topo-sistema"]')
        const esq = document.querySelector('[data-testid="topo-esquerda"]')
        if (!sis || !esq) return null
        const bs = [...sis.querySelectorAll('button, a')].filter((x) => x.getBoundingClientRect().width > 0).map((x) => x.getBoundingClientRect())
        const e = esq.getBoundingClientRect()
        const c = (r) => (r.top + r.bottom) / 2
        return { mesmaLinha: bs.every((r) => Math.abs(c(r) - c(e)) < 6), folga: Math.round(innerWidth - Math.max(...bs.map((r) => r.right))), n: bs.length, rolagem: document.documentElement.scrollWidth > innerWidth + 1 }
      })
      ok(`${nome} · ${tela}: sem o aviso 'Novo sistema de impressão' (desligado em 2026-10-04)`, (await p.getByText('Novo sistema de impressão disponível').count()) === 0)
      ok(`${nome} · ${tela}: botões do sistema à direita, na 1ª linha, sem quebrar`, !!g && g.mesmaLinha && g.folga <= 24 && g.n >= 3 && !g.rolagem, texto(g))
      if (nome === '1366' || tela === 'Mesas') {
        await p.getByTestId('topo-conta').click()
        const c = await p.evaluate(medirPopup, 'topo-conta-menu')
        ok(`${nome} · ${tela}: menu da conta por cima e na tela`, c.existe && c.noBody && c.dentro && c.porCima, texto(c))
        await p.keyboard.press('Escape')
      }
    }
    if (nome === '1366') {
      // Cardápio: ⋮ da categoria (dentro da lista que rola) e menu CSV dos clientes.
      await p.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' })
      const tres = p.getByTestId('categoria-menu').last()
      if (await tres.count()) {
        await tres.hover().catch(() => {}); await tres.click({ force: true })
        const m = await p.evaluate(medirPopup, 'categoria-menu-lista')
        ok('Cardápio: menu ⋮ da última categoria por cima, inteiro na tela', m.existe && m.noBody && m.dentro && m.porCima, texto(m))
        await p.mouse.click(700, 700)
        ok('Cardápio: clique fora fecha o ⋮', !(await p.getByTestId('categoria-menu-lista').isVisible().catch(() => false)))
      } else ok('Cardápio: há categorias para testar o ⋮', false)
      await p.goto(`${BASE}/admin/clientes`, { waitUntil: 'networkidle' })
      if (await p.getByTestId('botao-csv').count()) {
        await p.getByTestId('botao-csv').click()
        const m = await p.evaluate(medirPopup, 'menu-csv')
        ok('Clientes: menu CSV por cima e na tela', m.existe && m.noBody && m.dentro && m.porCima, texto(m))
        await p.keyboard.press('Escape')
        ok('Clientes: Esc fecha o menu CSV', !(await p.getByTestId('menu-csv').isVisible().catch(() => false)))
      }
      await p.goto(`${BASE}/admin/campanhas`, { waitUntil: 'networkidle' })
      const ajuda = p.locator('[data-toque-livre]').first()
      if (await ajuda.count()) {
        await ajuda.hover()
        const d = await p.evaluate(() => { const el = document.querySelector('[data-testid="dica"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { noBody: el.parentElement === document.body, dentro: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 } })
        ok('Campanhas: ajuda (?) por cima e dentro da tela', !!d && d.noBody && d.dentro, texto(d))
      }
    }
    await ctx.close()
  }

  secao('4. Financeiro ligado: pílula do caixa também cabe na linha')
  await db.query('update restaurantes set financeiro_ativo=true where id=$1', [loja.id])
  try {
    for (const [nome, vp, extra] of [['768', { width: 768, height: 1024 }, { isMobile: true, hasTouch: true }], ['1024', { width: 1024, height: 768 }, {}], ['1366', { width: 1366, height: 768 }, {}]]) {
      const { ctx, p } = await logar(b, vp, extra)
      await abrirKanban(p)
      await p.getByTestId('aviso-caixa').waitFor({ timeout: 8000 }).catch(() => {})
      const g = await p.evaluate(medirTopo)
      const c = await p.evaluate(contraste, '[data-testid="aviso-caixa"]')
      ok(`financeiro ${nome}: caixa visível em cor viva, tudo numa linha, sistema à direita`, !!c && c.razao >= 4.5 && g.umaLinha && g.sistemaADireita && g.sobrepostos === 0 && !g.rolagemLateral, texto({ g, c }))
      await ctx.close()
    }
  } finally {
    await db.query('update restaurantes set financeiro_ativo=false where id=$1', [loja.id])
  }

  secao('5. Despacho de rotas intocado')
  // Regra 4: o DESIGN do despacho não muda. Desde a noite 3 (mapa abrindo em Fortaleza, item 5) o
  // funcionamento pode mudar; o que não pode é a superfície visual: todas as classes, o estilo do
  // mapa e os ícones dos pinos/motos têm de ser iguais aos do main.
  const superficie = (bruto) => {
    const txt = bruto.replace(/\r\n/g, '\n')
    return [
      ...(txt.match(/className=("[^"]*"|\{`[^`]*`\}|\{\[[\s\S]*?\]\.join\(' '\)\})/g) ?? []),
      (txt.match(/const LIGHT_MAP_STYLE[\s\S]*?\n\]/) ?? [''])[0],
      (txt.match(/function pinIcon[\s\S]*?\n\}/) ?? [''])[0],
      (txt.match(/function motoIcon[\s\S]*?\n\}/) ?? [''])[0],
    ].join('\n')
  }
  const mudou = ['components/pedidos/rota-panel.tsx', 'components/pedidos/rota-map.tsx'].filter((arq) =>
    superficie(execSync(`git show origin/main:${arq}`, { encoding: 'utf8' })) !== superficie(readFileSync(arq, 'utf8')))
  const classes = superficie(readFileSync('components/pedidos/rota-panel.tsx', 'utf8')).split('className=').length
  ok('Despacho de rotas: classes, estilo do mapa e ícones iguais ao main (design intocado)', mudou.length === 0 && classes > 20, mudou.join(', ') || String(classes))
} catch (e) {
  ok('fluxo sem erro', false, String(e).slice(0, 400))
} finally {
  await b.close()
  await db.query(`update restaurantes set impressao_aceitar_pedidos_automaticamente=$2 where id=$1`, [loja.id, loja.auto])
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
