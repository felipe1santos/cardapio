/**
 * E2E — Pendência 8 da vitrine (2026-10-04): fim do cardápio sem lacuna, menu de baixo sempre visível,
 * botão do WhatsApp sempre visível (e só com WhatsApp configurado), "Mais Pedidos" marcado pela loja
 * (selo sobre a foto + seção só com os marcados) e selo de desconto inteiro no cartão de destaque.
 *
 * Stack local, lojas PRÓPRIAS (`p8-curta`, `p8-longa`, `p8-grade`, `p8-sem-wa`), recriadas a cada rodada.
 * Tamanhos: 360, 390, 430 (celular), 768 (tablet), 1366 (desktop).
 *
 *   node scripts/vitrine/e2e-vitrine-p8.mjs [pasta-de-prints] [rotulo]
 * `rotulo` (antes|depois) entra no nome dos prints.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
const ROTULO = process.argv[3] ?? 'depois'
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)

// Foto de teste: SVG inline (sem rede), cor diferente por item.
const foto = (cor) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${cor}"/><circle cx="200" cy="200" r="120" fill="#ffffff55"/></svg>`)}`
const CORES = ['#B45309', '#15803D', '#1D4ED8', '#9333EA', '#BE123C', '#0F766E']

async function loja(slug, nome, { telefone, layout }) {
  await db.query(`delete from itens_cardapio where restaurante_id in (select id from restaurantes where slug=$1)`, [slug])
  await db.query(`delete from grupos_cardapio where restaurante_id in (select id from restaurantes where slug=$1)`, [slug])
  const r = await um(`insert into restaurantes (nome, slug, status_loja, telefone, layout_cardapio, aceita_retirada, horario_funcionamento)
    values ($1,$2,'aberto_manual',$3,$4,true,null)
    on conflict (slug) do update set nome=excluded.nome, telefone=excluded.telefone, layout_cardapio=excluded.layout_cardapio, status_loja='aberto_manual', horario_funcionamento=null
    returning id`, [nome, slug, telefone, layout])
  return r.id
}
async function categoria(L, nome, pos, itens) {
  const g = (await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,$2,$3) returning id`, [L, nome, pos])).id
  let i = 0
  for (const it of itens) {
    const f = foto(CORES[i % CORES.length])
    await db.query(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, promocao_preco, status, dias_disponiveis, mais_vendido, tipo_item, posicao, imagem_url, imagem_thumb_url)
      values ($1,$2,$3,$4,$5,$6,'disponivel','{0,1,2,3,4,5,6}',$7,'simples',$8,$9,$9)`,
      [L, g, it.nome, it.descricao ?? 'Pão, carne, queijo e molho da casa.', it.preco ?? 29.9, it.promo ?? null, !!it.mp, i++, f])
  }
}

secao('Semente (lojas locais próprias)')
const curta = await loja('p8-curta', 'P8 Cardápio Curto', { telefone: '27999990000', layout: 'lista' })
await categoria(curta, 'Lanches', 0, [
  { nome: 'P8 Burger com desconto', promo: 19.9, mp: true },
  { nome: 'P8 Duplo', mp: true },
])
await categoria(curta, 'Bebidas', 1, [{ nome: 'P8 Refri (último)' }])
const longa = await loja('p8-longa', 'P8 Cardápio Longo', { telefone: '(27) 99999-0001', layout: 'lista' })
await categoria(longa, 'Lanches', 0, Array.from({ length: 14 }, (_, i) => ({ nome: `P8 Lanche ${i + 1}`, mp: i === 2 || i === 5, promo: i === 2 ? 24.9 : null })))
await categoria(longa, 'Porções', 1, Array.from({ length: 8 }, (_, i) => ({ nome: `P8 Porção ${i + 1}` })))
await categoria(longa, 'Sobremesa', 2, [{ nome: 'P8 Pudim (último)' }])
const grade = await loja('p8-grade', 'P8 Cardápio em Grade', { telefone: '27999990002', layout: 'categoria' })
await categoria(grade, 'Destaques da casa', 0, Array.from({ length: 6 }, (_, i) => ({ nome: `P8 Grade ${i + 1}`, mp: i < 3, promo: i % 2 === 0 ? 139.9 : null, preco: 189.9 })))
await categoria(grade, 'Final', 1, [{ nome: 'P8 Grade último' }])
const semWa = await loja('p8-sem-wa', 'P8 Sem WhatsApp', { telefone: '', layout: 'lista' })
await categoria(semWa, 'Lanches', 0, [{ nome: 'P8 Sem destaque 1' }, { nome: 'P8 Sem destaque 2' }, { nome: 'P8 Sem destaque 3' }])
ok('4 lojas semeadas', !!curta && !!longa && !!grade && !!semWa)

const browser = await chromium.launch()
const TAMANHOS = [
  { nome: '360', viewport: { width: 360, height: 740 }, celular: true },
  { nome: '390', viewport: { width: 390, height: 844 }, celular: true },
  { nome: '430', viewport: { width: 430, height: 932 }, celular: true },
  { nome: 'tablet', viewport: { width: 768, height: 1024 }, celular: true },
  { nome: 'desktop', viewport: { width: 1366, height: 860 }, celular: false },
]

async function abrir(slug, t) {
  const ctx = await browser.newContext({
    viewport: t.viewport, deviceScaleFactor: t.celular ? 2 : 1, isMobile: t.celular && t.viewport.width < 600, hasTouch: t.celular,
    userAgent: t.celular ? devices['Pixel 7'].userAgent : undefined, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
  })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/loja/${slug}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-item-id]', { timeout: 20000 })
  // Avisos que aparecem por cima no primeiro acesso (convite do app etc.) não fazem parte do teste.
  await p.waitForTimeout(800)
  return { ctx, p }
}

/** Retângulo do que fica fixo embaixo (menu, WhatsApp, sacola) — o topo mais alto deles. */
const medirFundo = (p) => p.evaluate(() => {
  const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.top < innerHeight ? r : null }
  const nav = vis(document.querySelector('[data-testid="nav-rodape"]'))
  const wa = vis(document.querySelector('[data-testid="tirar-duvidas-whatsapp"]')) ?? vis(document.querySelector('[data-testid="tirar-duvidas-whatsapp-desktop"]'))
  const sacola = vis(document.querySelector('[data-testid="barra-sacola"]'))
  const botoes = vis(document.querySelector('[data-testid="nav-botoes"]')) ?? nav
  const fixos = [nav, wa, sacola].filter(Boolean)
  const topoFixos = fixos.length ? Math.min(...fixos.map((r) => r.top)) : innerHeight
  const itens = [...document.querySelectorAll('[data-item-id]')].filter((e) => e.getBoundingClientRect().height > 0 && !e.closest('[data-testid="mais-pedidos"]'))
  const ultimo = itens.at(-1)?.getBoundingClientRect()
  // Desktop com cardápio curto: a sacola lateral (sticky) pode ser mais alta que a lista e estender a página.
  const aside = [...document.querySelectorAll('aside')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0).reduce((m, r) => Math.max(m, r.bottom), 0)
  return {
    nav: nav && { top: nav.top, bottom: nav.bottom }, botoes: botoes && { top: botoes.top }, wa: wa && { top: wa.top, bottom: wa.bottom, left: wa.left, right: wa.right }, sacola: sacola && { top: sacola.top, bottom: sacola.bottom },
    topoFixos, ultimoBottom: ultimo?.bottom ?? null, asideBottom: aside, curto: (() => { const c = document.querySelector('[class*="pb-[var(--rodape-vitrine)]"]'); return !!c && c.getBoundingClientRect().height <= innerHeight + 1 })(), alturaJanela: innerHeight,
    fimDoCardapio: /fim do cardápio/i.test(document.body.innerText),
    rolavel: document.documentElement.scrollHeight > innerHeight + 4,
  }
})

const rolarAoFim = async (p) => {
  for (let i = 0; i < 4; i++) { await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(350) }
}

try {
  for (const t of TAMANHOS) {
    secao(`Tamanho ${t.nome}`)
    for (const slug of ['p8-curta', 'p8-longa', 'p8-grade', 'p8-sem-wa']) {
      const { ctx, p } = await abrir(slug, t)
      const temWa = slug !== 'p8-sem-wa'
      // 1. Fim do cardápio sem lacuna.
      await rolarAoFim(p)
      const m = await medirFundo(p)
      ok(`${slug}: sem o bloco "fim do cardápio"`, !m.fimDoCardapio)
      if (m.rolavel && m.ultimoBottom !== null) {
        const folga = m.topoFixos - m.ultimoBottom
        const limite = t.viewport.width < 1024 ? 12 : 28
        const peloAside = t.viewport.width >= 1024 && m.asideBottom > m.ultimoBottom + limite
        ok(`${slug}: último item aparece inteiro e encosta no que é fixo (folga ${Math.round(folga)} px${peloAside ? ', página estendida pela sacola lateral' : ''}${m.curto ? ', cardápio mais curto que a tela' : ''})`, folga >= -1 && (folga <= limite || peloAside || m.curto), texto(m))
      }
      if (PRINTS && ['390', 'desktop', '360'].includes(t.nome)) await p.screenshot({ path: join(PRINTS, `${ROTULO}-${slug}-${t.nome}-fim.png`) })
      // 2. Menu de baixo sempre visível (celular): rola rápido para baixo e confere.
      if (t.viewport.width < 1024) {
        await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200)
        for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 500); await p.waitForTimeout(60) }
        await p.waitForTimeout(400)
        const meio = await medirFundo(p)
        const oculta = await p.getAttribute('[data-testid="nav-rodape"]', 'data-oculta')
        ok(`${slug}: menu de baixo continua visível depois de rolar para baixo`, !!meio.nav && meio.nav.bottom <= meio.alturaJanela + 1 && oculta !== 'sim', texto({ nav: meio.nav, oculta }))
        // 3. WhatsApp sempre visível ao rolar (com WhatsApp) / não aparece (sem).
        ok(`${slug}: WhatsApp ${temWa ? 'visível ao rolar' : 'não aparece (loja sem WhatsApp)'}`, temWa ? !!meio.wa && meio.wa.bottom <= meio.alturaJanela + 1 : !meio.wa, texto(meio.wa))
        if (meio.wa && meio.botoes) ok(`${slug}: WhatsApp não cobre os botões do menu de baixo`, meio.wa.bottom <= meio.botoes.top + 1, texto([meio.wa, meio.botoes]))
      } else {
        const d = await medirFundo(p)
        ok(`${slug}: WhatsApp no desktop ${temWa ? 'visível' : 'ausente'}`, temWa ? !!d.wa : !d.wa, texto(d.wa))
      }
      await ctx.close()
    }

    // 4. "Mais Pedidos": seção só com os marcados; selo sobre a foto no canto superior esquerdo.
    {
      const { ctx, p } = await abrir('p8-longa', t)
      const sec = await p.evaluate(() => {
        const s = document.querySelector('[data-testid="mais-pedidos"]')
        return s ? { titulo: s.querySelector('h2')?.textContent, itens: [...s.querySelectorAll('[data-item-id]')].map((e) => e.textContent) } : null
      })
      ok('seção "Mais Pedidos" só com os itens marcados (2)', !!sec && sec.titulo === 'Mais Pedidos' && sec.itens.length === 2 && sec.itens.every((x) => /Lanche (3|6)(?!\d)/.test(x)), texto(sec))
      const selo = await p.evaluate(() => {
        const linha = [...document.querySelectorAll('[data-item-id]')].find((e) => !e.closest('[data-testid="mais-pedidos"]') && /P8 Lanche 3(?!\d)/.test(e.textContent))
        const s = linha?.querySelector('[data-selo-mais-pedidos]')
        const img = s?.parentElement?.querySelector('img')
        if (!s || !img) return null
        const a = s.getBoundingClientRect(), b = img.getBoundingClientRect()
        const cs = getComputedStyle(s)
        return { dTopo: Math.round(a.top - b.top), dEsq: Math.round(a.left - b.left), texto: s.textContent, fundo: cs.backgroundColor, cor: cs.color, dentro: a.right <= b.right && a.bottom <= b.bottom }
      })
      ok('selo "Mais Pedidos" sobre a foto, colado no topo, canto esquerdo', !!selo && selo.dTopo === 0 && selo.dEsq <= 1 && selo.dentro && /Mais Pedidos/.test(selo.texto), texto(selo))
      ok('selo com fundo vivo e texto branco', !!selo && selo.cor === 'rgb(255, 255, 255)' && selo.fundo === 'rgb(232, 0, 2)', texto(selo))
      const semSeloComum = await p.evaluate(() => {
        const l = [...document.querySelectorAll('[data-item-id]')].find((e) => /P8 Lanche 1(?!\d)/.test(e.textContent))
        return !l?.querySelector('[data-selo-mais-pedidos]')
      })
      ok('item não marcado não tem selo', semSeloComum)
      const nomesLinha = await p.evaluate(() => [...document.querySelectorAll('[data-etiqueta]')].map((e) => e.getAttribute('data-etiqueta')))
      ok('o nome antigo "Mais vendido" não aparece mais na linha do nome', !nomesLinha.includes('mais_vendido') && !/Mais vendido|Favorito/i.test(await p.evaluate(() => document.body.innerText)))
      if (PRINTS && ['390', 'desktop'].includes(t.nome)) await p.screenshot({ path: join(PRINTS, `${ROTULO}-mais-pedidos-${t.nome}.png`) })
      await ctx.close()
    }
    {
      const { ctx, p } = await abrir('p8-sem-wa', t)
      ok('sem item marcado: a seção "Mais Pedidos" não aparece', (await p.locator('[data-testid="mais-pedidos"]').count()) === 0)
      await ctx.close()
    }

    // 5. Selo de desconto inteiro em todos os cartões (destaque, grade e lista).
    for (const slug of ['p8-grade', 'p8-curta', 'p8-longa']) {
      const { ctx, p } = await abrir(slug, t)
      const cortes = await p.evaluate(() => {
        const out = []
        for (const pil of document.querySelectorAll('[data-preco] [data-desconto]')) {
          const card = pil.closest('[data-item-id]')
          if (!card) continue
          const a = pil.getBoundingClientRect(), c = card.getBoundingClientRect()
          // Ancestral que corta (overflow) até o cartão.
          let el = pil.parentElement, corta = false
          while (el && el !== card.parentElement) {
            const cs = getComputedStyle(el)
            if (/(hidden|clip)/.test(cs.overflowX + cs.overflowY)) { const r = el.getBoundingClientRect(); if (a.right > r.right + 0.5 || a.left < r.left - 0.5 || a.bottom > r.bottom + 0.5) corta = true }
            el = el.parentElement
          }
          if (corta || a.right > c.right + 0.5) out.push({ item: card.textContent.slice(0, 30), pil: [Math.round(a.left), Math.round(a.right)], card: [Math.round(c.left), Math.round(c.right)] })
        }
        return { cortes: out, total: document.querySelectorAll('[data-preco] [data-desconto]').length }
      })
      ok(`${slug}: selo de desconto inteiro em todos os cartões (${cortes.total})`, cortes.total > 0 && cortes.cortes.length === 0, texto(cortes.cortes.slice(0, 3)))
      if (slug === 'p8-grade' && t.nome !== 'desktop') {
        // Desconto + "Mais Pedidos" no mesmo item: selo na foto, desconto no preço, sem se cobrirem.
        const juntos = await p.evaluate(() => {
          const card = [...document.querySelectorAll('[data-item-id]')].find((e) => !e.closest('[data-testid="mais-pedidos"]') && /P8 Grade 1(?!\d)/.test(e.textContent))
          const s = card?.querySelector('[data-selo-mais-pedidos]')?.getBoundingClientRect(), d = card?.querySelector('[data-desconto]')?.getBoundingClientRect()
          if (!s || !d) return null
          return { sobrepoe: !(s.right <= d.left || d.right <= s.left || s.bottom <= d.top || d.bottom <= s.top) }
        })
        ok('desconto + "Mais Pedidos" no mesmo cartão sem se cobrirem', !!juntos && !juntos.sobrepoe, texto(juntos))
      }
      if (PRINTS && ['360', '390', 'desktop'].includes(t.nome) && slug === 'p8-grade') await p.screenshot({ path: join(PRINTS, `${ROTULO}-desconto-${slug}-${t.nome}.png`) })
      await ctx.close()
    }
  }

  // 5b. Área segura (iPhone com a barrinha de gestos / app instalado): o Chromium não emula
  // env(safe-area-inset-bottom), então simula o respiro de 34 px que o CSS dá ao menu nesses casos e
  // confere que o espaço embaixo do cardápio acompanha (é medido, não fixo).
  secao('Área segura simulada (34 px)')
  for (const slug of ['p8-longa', 'p8-curta']) {
    const { ctx, p } = await abrir(slug, TAMANHOS[1])
    const antes = await p.evaluate(() => document.querySelector('[data-testid="rodape-fixo"]').getBoundingClientRect().height)
    await p.addStyleTag({ content: '.nav-rodape { padding-bottom: 34px !important; }' })
    await p.waitForTimeout(500)
    const depois = await p.evaluate(() => document.querySelector('[data-testid="rodape-fixo"]').getBoundingClientRect().height)
    await rolarAoFim(p)
    const m = await medirFundo(p)
    const folga = m.topoFixos - m.ultimoBottom
    ok(`${slug}: com área segura o rodapé cresce ${Math.round(depois - antes)} px e o último item continua inteiro, sem lacuna (folga ${Math.round(folga)} px)`, depois - antes >= 27 && folga >= -1 && folga <= 12, texto({ antes, depois, folga }))
    if (PRINTS) await p.screenshot({ path: join(PRINTS, `${ROTULO}-area-segura-${slug}-390.png`) })
    await ctx.close()
  }

  // 6. Fluxo: abrir/fechar produto, sacola, WhatsApp não cobre a sacola, checkout abre.
  secao('Fluxo no celular (390)')
  {
    const { ctx, p } = await abrir('p8-curta', TAMANHOS[1])
    await p.locator('[data-item-id]').filter({ hasText: 'P8 Duplo' }).last().click()
    await p.waitForTimeout(700)
    const add = p.getByRole('button', { name: /Adicionar/i }).last()
    ok('ficha do produto abre', await add.isVisible())
    await add.click()
    await p.waitForTimeout(900)
    const m = await medirFundo(p)
    ok('sacola aparece', !!m.sacola, texto(m.sacola))
    ok('WhatsApp continua visível com a sacola, sem cobrir a sacola nem o menu', !!m.wa && !!m.sacola && (m.wa.bottom <= m.sacola.top + 1 || m.sacola.bottom <= m.wa.top + 1) && m.wa.bottom <= m.botoes.top + 1, texto(m))
    await rolarAoFim(p)
    const f = await medirFundo(p)
    ok('com sacola: último item ainda aparece inteiro acima do que é fixo', f.ultimoBottom === null || !f.rolavel || f.topoFixos - f.ultimoBottom >= -1, texto(f))
    if (PRINTS) await p.screenshot({ path: join(PRINTS, `${ROTULO}-sacola-390.png`) })
    await p.getByTestId('barra-sacola').click()
    await p.waitForTimeout(700)
    const fin = p.getByRole('button', { name: /Finalizar|Continuar/i }).first()
    ok('carrinho abre com o botão de seguir', await fin.isVisible().catch(() => false))
    await ctx.close()
  }
} finally {
  await browser.close()
}

const passou = res.filter(Boolean).length
console.log(`\nResultado: ${passou}/${res.length}`)
await db.end()
process.exit(passou === res.length ? 0 : 1)
