/**
 * Item 56 — novo visual do Kanban: os 5 pedidos do modelo (docs/kanban-56/modelo.jpeg) na loja local
 * `dash54-loja`, prints (desktop, tablet, celular), o lado a lado com o modelo e as verificações:
 * origem certa (sem ícone para Direto; PDV mostra o canal), 3 linhas, botão só com a seta à direita e
 * com contraste ≥ 4,5:1, cabeçalhos das colunas, faixa na cor da coluna, piscar do pedido novo,
 * painel lateral com a origem, sem rolagem lateral no celular/tablet. Apaga os pedidos no fim.
 *
 *   node scripts/kanban/e2e-kanban-56.mjs
 */
import { mkdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'dash54-loja'
const PASTA = 'docs/kanban-56'
mkdirSync(PASTA, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id, usa_logistica from restaurantes where slug=$1`, [SLUG])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const criados = []

// Os pedidos do modelo (nomes, telefones, valores e tempos iguais ao print).
const MODELO = [
  { n: 'João Silva', tel: '27999123344', status: 'recebido', tipo: 'entrega', forma: 'dinheiro', total: 28.5, canal: 'delivery', origem: 'cardapio', oc: 'google_anuncio', min: 2 },
  { n: 'Maria Souza', tel: '27998441100', status: 'recebido', tipo: 'entrega', forma: 'pix', total: 48.9, canal: 'delivery', origem: 'cardapio', oc: 'whatsapp', min: 5 },
  { n: 'Carlos Lima', tel: '27997720901', status: 'preparando', tipo: 'retirada', forma: 'cartao', total: 72, canal: 'delivery', origem: 'cardapio', oc: 'meta', min: 6 },
  { n: 'Ana Oliveira', tel: '27996557821', status: 'preparando', tipo: 'retirada', forma: 'dinheiro', total: 33, canal: 'balcao', origem: 'pdv', oc: null, min: 12 },
  { n: 'Pedro Santos', tel: '27999885511', status: 'pronto', tipo: 'entrega', forma: 'pix', total: 25, canal: 'delivery', origem: 'cardapio', oc: 'whatsapp', min: 1 },
  { n: 'Lucas Direto', tel: '27999001122', status: 'recebido', tipo: 'retirada', forma: 'pix', total: 19.9, canal: 'delivery', origem: 'cardapio', oc: 'direto', min: 1 },
]
const lum = (hex) => { const c = hex.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const hexDe = (rgb) => '#' + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('')

const browser = await chromium.launch()
try {
  // fluxo sem despacho de rotas, como no modelo (pronto mostra a seta); volta ao final
  await db.query(`update restaurantes set usa_logistica=false where id=$1`, [loja.id])
  for (const m of MODELO) {
    const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem, origem_canal, observacao, endereco_rua, criado_em, preparando_notificado)
      values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,'','', now() - ($11 || ' minutes')::interval, false) returning id, numero`, [loja.id, m.tipo, m.status, m.total, m.n, m.tel, m.forma, m.canal, m.origem, m.oc, String(m.min)])
    criados.push(p.id); m.numero = p.numero
  }

  for (const [disp, opcoes] of [
    ['desktop', { viewport: { width: 1280, height: 670 } }],
    ['tablet', { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['Galaxy Tab S4'].userAgent }],
    ['celular', { ...devices['Pixel 7'] }],
  ]) {
    secao(disp)
    const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', 'dono.dash54'); await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
    await p.getByTestId(`pedido-${MODELO[0].numero}`).waitFor({ timeout: 20000 })
    const aviso = p.locator('[aria-labelledby="setup-alerta-titulo"]').first()
    if (await aviso.isVisible().catch(() => false)) await aviso.click({ position: { x: 5, y: 5 } }).catch(() => {})
    await p.waitForTimeout(1200)
    await p.screenshot({ path: `${PASTA}/kanban-${disp}.png`, fullPage: disp !== 'desktop' })

    if (disp === 'desktop') {
      // origem certa e sem ícone para direto
      for (const m of MODELO) {
        const card = p.getByTestId(`pedido-${m.numero}`)
        const o = await card.getByTestId('card-origem').getAttribute('data-origem').catch(() => null)
        const esperado = m.oc === 'direto' ? null : m.canal === 'balcao' ? 'pdv' : m.oc
        ok(`#${m.numero} ${m.n}: origem ${esperado ?? 'nenhuma (Direto)'}`, o === esperado, String(o))
      }
      const dica = await p.getByTestId(`pedido-${MODELO[0].numero}`).getByTestId('card-origem').getAttribute('title')
      ok('dica da origem: "Origem: Google"', dica === 'Origem: Google', dica)
      const pdvTxt = await p.getByTestId(`pedido-${MODELO[3].numero}`).getByTestId('card-origem').textContent()
      ok('balcão mostra "PDV" e BALCÃO no atendimento', pdvTxt.trim() === 'PDV' && /BALCÃO/.test(await p.getByTestId(`pedido-${MODELO[3].numero}`).getByTestId('etiqueta-balcao').textContent()))
      // 3 linhas: número/origem/tempo; cliente/telefone/pagamento/valor; botão
      const m0 = await p.getByTestId(`pedido-${MODELO[0].numero}`).evaluate((el) => {
        const linhas = [...el.children].map((c) => c.getBoundingClientRect())
        const b = el.querySelector('[data-testid="card-etapa"]')?.getBoundingClientRect()
        const card = el.getBoundingClientRect()
        const cs = b ? getComputedStyle(el.querySelector('[data-testid="card-etapa"]')) : null
        const borda = getComputedStyle(el).borderLeftColor
        return { n: linhas.length, b: b && { w: b.width, direita: Math.round(card.right - b.right), raio: cs.borderRadius, fundo: cs.backgroundColor, cor: cs.color }, cardW: card.width, borda, tel: !!el.querySelector('[data-testid="card-telefone"]'), txt: el.textContent }
      })
      ok('card com 3 linhas', m0.n === 3, String(m0.n))
      ok('botão só com a seta, à direita, sem ocupar a largura toda', m0.b && m0.b.w < m0.cardW / 2 && m0.b.direita <= 16 && !/Aceitar/i.test(m0.txt.split('\n').pop()), JSON.stringify(m0.b))
      // Noite 3 (2026-10-06): o dono pediu os botões do modelo mais vivos — fundo sólido, seta branca,
      // cantos menos arredondados — com contraste ≥ 4,5:1.
      ok('cantos do botão menos arredondados (4px)', m0.b?.raio === '4px', m0.b?.raio)
      ok('botão de aceitar: amarelo sólido #A16207, seta branca, contraste ≥ 4,5', hexDe(m0.b.fundo) === '#a16207' && hexDe(m0.b.cor) === '#ffffff' && contraste(hexDe(m0.b.fundo), '#ffffff') >= 4.5, `${hexDe(m0.b.fundo)} / ${hexDe(m0.b.cor)}`)
      const verde = await p.getByTestId(`pedido-${MODELO[2].numero}`).getByTestId('card-etapa').evaluate((b) => [getComputedStyle(b).backgroundColor, getComputedStyle(b).color, b.getAttribute('data-cor')])
      ok('botão de próxima etapa: verde sólido #15803D, seta branca, contraste ≥ 4,5', hexDe(verde[0]) === '#15803d' && hexDe(verde[1]) === '#ffffff' && verde[2] === 'avancar' && contraste(hexDe(verde[0]), '#ffffff') >= 4.5, `${hexDe(verde[0])} / ${hexDe(verde[1])}`)
      const pesoMax = await p.getByTestId(`pedido-${MODELO[0].numero}`).evaluate((el) => Math.max(...[...el.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => Number(getComputedStyle(e).fontWeight))))
      ok('card com peso de fonte até 600 (regra 6)', pesoMax <= 600, String(pesoMax))
      ok('telefone e forma de pagamento na linha 2', m0.tel && /Dinheiro/.test(m0.txt))
      const preco = await p.getByTestId(`pedido-${MODELO[0].numero}`).getByTestId('card-preco').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color])
      ok(`valor em selo verde-claro como no modelo (${hexDe(preco[0])} / ${hexDe(preco[1])})`, hexDe(preco[0]) === '#e3faed')
      for (const col of ['recebido', 'preparando', 'pronto']) {
        const h = await p.getByTestId(`coluna-cabecalho-${col}`).evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color])
        const corModelo = { recebido: '#fe4b11', preparando: '#015bb1', pronto: '#00946e' }
        ok(`cabeçalho "${col}" na cor do modelo (${corModelo[col]}) com texto branco`, hexDe(h[0]) === corModelo[col] && hexDe(h[1]) === '#ffffff', hexDe(h[0]))
      }
      ok('contador em pílula', /^\d+$/.test((await p.getByTestId('coluna-contador-recebido').innerText()).trim()))
      const faixa = await p.getByTestId(`pedido-${MODELO[2].numero}`).evaluate((e) => getComputedStyle(e).borderLeftColor)
      const cab = await p.getByTestId('coluna-cabecalho-preparando').evaluate((e) => getComputedStyle(e).backgroundColor)
      ok('faixa à esquerda na cor da coluna', faixa === cab, `${faixa} / ${cab}`)
      ok('pedido novo continua piscando (animate-new-order)', /animate-new-order/.test(await p.getByTestId(`pedido-${MODELO[0].numero}`).getAttribute('class')))
      ok('pedido em preparo não pisca', !/animate-new-order/.test(await p.getByTestId(`pedido-${MODELO[2].numero}`).getAttribute('class')))
      // painel lateral com a origem
      await p.getByTestId(`pedido-${MODELO[1].numero}`).click()
      await p.getByTestId('painel-origem').waitFor({ timeout: 5000 }).catch(() => {})
      ok('painel lateral mostra a origem (WhatsApp)', /WhatsApp/.test(await p.getByTestId('painel-origem').innerText().catch(() => '')))
      await p.screenshot({ path: `${PASTA}/kanban-desktop-painel.png` })
      await p.getByTestId('painel-fechar').click().catch(() => {})
      // Print comparável ao modelo: 3 colunas, sem a barra de métricas (preferências do próprio Kanban).
      await p.evaluate(() => { localStorage.setItem('menuzia:kanban-stats', '0'); localStorage.setItem('menuzia:kanban-col4', '0') })
      await p.reload({ waitUntil: 'networkidle' }); await p.getByTestId(`pedido-${MODELO[0].numero}`).waitFor()
      if (await aviso.isVisible().catch(() => false)) await aviso.click({ position: { x: 5, y: 5 } }).catch(() => {})
      await p.waitForTimeout(800)
      await p.screenshot({ path: `${PASTA}/kanban-desktop-como-modelo.png` })
      const sobre = await p.evaluate(() => [...document.querySelectorAll('.kanban-card')].some((c) => { const f = [...c.children[1].querySelectorAll(':scope > div')].map((d) => d.getBoundingClientRect()); return f.length === 2 && f[0].right > f[1].left + 1 }))
      ok('linha 2 sem sobreposição (3 colunas)', !sobre)
      await p.setViewportSize({ width: 1600, height: 760 }); await p.waitForTimeout(600)
      await p.screenshot({ path: `${PASTA}/kanban-desktop-1600.png` })
      await p.evaluate(() => { localStorage.setItem('menuzia:kanban-stats', '1'); localStorage.setItem('menuzia:kanban-col4', '1') })
      await p.setViewportSize({ width: 1280, height: 670 }); await p.reload({ waitUntil: 'networkidle' }); await p.getByTestId(`pedido-${MODELO[0].numero}`).waitFor()
      if (await aviso.isVisible().catch(() => false)) await aviso.click({ position: { x: 5, y: 5 } }).catch(() => {})
      await p.waitForTimeout(600)
      const sobre4 = await p.evaluate(() => [...document.querySelectorAll('.kanban-card')].some((c) => { const f = [...c.children[1].querySelectorAll(':scope > div')].map((d) => d.getBoundingClientRect()); return f.length === 2 && f[0].right > f[1].left + 1 }))
      ok('linha 2 sem sobreposição mesmo com menu + métricas + 4ª coluna em 1280 px', !sobre4)
      await p.screenshot({ path: `${PASTA}/kanban-desktop-4-colunas.png` })
      // seta avança (aceitar)
      await p.getByTestId(`pedido-${MODELO[5].numero}`).getByTestId('card-etapa').click()
      ok('seta amarela aceita o pedido (vai para Preparando)', await (async () => { for (let i = 0; i < 20; i++) { if ((await um(`select status from pedidos where id=$1`, [criados[5]])).status === 'preparando') return true; await new Promise((r) => setTimeout(r, 300)) } return false })())
    } else {
      const larg = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
      ok(`${disp}: sem rolagem lateral`, larg[0] <= larg[1] + 1, JSON.stringify(larg))
      const linhas = await p.getByTestId(`pedido-${MODELO[0].numero}`).evaluate((el) => [...el.children].map((c) => Math.round(c.getBoundingClientRect().height)))
      ok(`${disp}: card mínimo (3 linhas, nenhuma quebrando em duas)`, linhas.length === 3 && linhas[0] <= 30 && linhas[1] <= 30, JSON.stringify(linhas))
      const b = await p.getByTestId(`pedido-${MODELO[0].numero}`).getByTestId('card-etapa').boundingBox()
      ok(`${disp}: seta com alvo de toque confortável (≥ 34 px de altura)`, b && b.height >= 34, JSON.stringify(b))
    }
    await ctx.close()
  }

  secao('lado a lado com o modelo')
  {
    const ctx = await browser.newContext({ viewport: { width: 2600, height: 760 } })
    const p = await ctx.newPage()
    const b64 = (f) => readFileSync(f).toString('base64')
    await p.setContent(`<html><body style="margin:0;background:#fff;font-family:sans-serif;display:flex;gap:20px;padding:20px">
      <figure style="margin:0"><figcaption style="font:600 18px sans-serif;margin-bottom:8px">Modelo</figcaption><img src="data:image/jpeg;base64,${b64(`${PASTA}/modelo.jpeg`)}" style="width:1280px"></figure>
      <figure style="margin:0"><figcaption style="font:600 18px sans-serif;margin-bottom:8px">Menuzia (item 56)</figcaption><img src="data:image/png;base64,${b64(`${PASTA}/kanban-desktop-1600.png`)}" style="width:1280px"></figure></body></html>`)
    await p.screenshot({ path: `${PASTA}/lado-a-lado.png`, fullPage: true })
    ok('print lado a lado gerado', true, `${PASTA}/lado-a-lado.png`)
    await ctx.close()
  }
} finally {
  await browser.close()
  await db.query(`update restaurantes set usa_logistica=$2 where id=$1`, [loja.id, loja.usa_logistica])
  if (criados.length) await db.query(`delete from pedidos where id = any($1)`, [criados]).catch((e) => console.log('   (limpeza)', e.message))
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
