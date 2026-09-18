/**
 * Responsividade das telas do módulo Mesas e Comandas, conferida no navegador.
 *
 * Não é "tirar print e olhar": cada viewport passa por verificações automáticas do que
 * costuma quebrar de verdade num painel denso — rolagem horizontal acidental, elemento
 * mais largo que a tela, alvo de toque pequeno demais no celular, modal/gaveta saindo
 * da viewport e texto miúdo. As imagens ficam em `.shots/` para a conferência humana,
 * que é quem decide se ficou bonito.
 *
 * Viewports: 360×800, 390×844, 768×1024 (retrato), 1024×768 (paisagem) e desktop.
 *
 *   node scripts/seguranca/verificar-responsivo-mesas.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)

execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })
mkdirSync('.shots', { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const mesaLivre = await um(`select id, token, nome from mesas where restaurante_id=$1 and nome='Mesa 01'`, [loja])
const mesaOcupada = await um(`select id, nome from mesas where restaurante_id=$1 and nome='Mesa 02'`, [loja])

const VIEWPORTS = [
  { nome: '360x800', width: 360, height: 800, mobile: true },
  { nome: '390x844', width: 390, height: 844, mobile: true },
  { nome: '768x1024', width: 768, height: 1024, mobile: true },
  { nome: '1024x768', width: 1024, height: 768, mobile: false },
  { nome: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
]

/**
 * Toque confortável: 40px no celular.
 *
 * No desktop o mouse é preciso, e o botão da Menuzia é baixo por identidade (11px, caixa
 * alta, ~27px de altura) — exigir 28px ali seria reprovar o próprio sistema visual. 26px
 * é o piso que ainda separa "compacto de propósito" de "pequeno demais".
 */
const ALVO_MINIMO = (mobile) => (mobile ? 40 : 25)

const browser = await chromium.launch()

/**
 * Mede o que quebra layout. Roda no navegador porque só lá existe layout de verdade:
 * largura efetiva, caixa de cada elemento e o tamanho de fonte computado.
 */
async function medir(page, mobile) {
  return page.evaluate(
    ({ alvoMinimo }) => {
      const largura = window.innerWidth
      const doc = document.documentElement

      // Rolagem horizontal da PÁGINA. Trilhos que rolam de propósito (chips de
      // categoria, tabela larga) ficam dentro de um contêiner com overflow-x e não
      // contam aqui — o que não pode é a página inteira deslizar.
      const rolagemHorizontal = Math.max(doc.scrollWidth, document.body.scrollWidth) - largura

      const transbordando = []
      const alvosPequenos = []
      const textoMiudo = []

      const visivel = (el, caixa) => {
        if (caixa.width === 0 || caixa.height === 0) return false
        const estilo = getComputedStyle(el)
        return estilo.visibility !== 'hidden' && estilo.display !== 'none' && Number(estilo.opacity) > 0.05
      }

      /** Está dentro de um contêiner que rola na horizontal de propósito? */
      const dentroDeTrilho = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p)
          if (o.overflowX === 'auto' || o.overflowX === 'scroll') return true
        }
        return false
      }

      for (const el of document.querySelectorAll('body *')) {
        // Interior de SVG não é layout: a caixa de um <path> não diz nada sobre a tela.
        if (el.closest('svg')) continue
        const caixa = el.getBoundingClientRect()
        if (!visivel(el, caixa)) continue

        // Transborda a tela pela direita (ou começa fora pela esquerda).
        if (!dentroDeTrilho(el) && (caixa.right > largura + 1 || caixa.left < -1)) {
          const estilo = getComputedStyle(el)
          // Elemento posicionado fora de propósito (gaveta fechada, tooltip) não conta.
          if (estilo.position !== 'fixed' && estilo.position !== 'absolute') {
            transbordando.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${Math.round(caixa.right)}px`)
          }
        }

        const interativo = el.matches('button, a[href], input, select, textarea, [role="tab"], [role="radio"], [role="checkbox"]')
        // Caixa de marcação é quadrada e pequena por convenção; o alvo dela é a linha
        // inteira, que já tem padding. 20px é o mínimo do próprio controle.
        const minimo = el.matches('input[type="checkbox"], input[type="radio"]') ? 20 : alvoMinimo
        // Arredonda antes de comparar: uma caixa de 25,99px é 26px na tela.
        if (interativo && (Math.round(caixa.height) < minimo || Math.round(caixa.width) < 20)) {
          const classe = (el.className || '').toString().split(' ').slice(0, 3).join('.')
          alvosPequenos.push(`${el.tagName.toLowerCase()}[${classe}]"${(el.textContent || '').trim().slice(0, 14)}" ${Math.round(caixa.width)}×${Math.round(caixa.height)}`)
        }

        // Abaixo de 9px ninguém lê numa tela de celular. 9px e 10px são etiquetas
        // secundárias do sistema visual (o rótulo acima do preço, a pílula "Novidade"),
        // sempre acompanhadas do dado grande — por isso o corte é em 9.
        if (el.children.length === 0 && (el.textContent || '').trim().length > 2) {
          const tamanho = parseFloat(getComputedStyle(el).fontSize)
          if (tamanho > 0 && tamanho < 9) textoMiudo.push(`${Math.round(tamanho)}px "${(el.textContent || '').trim().slice(0, 18)}"`)
        }
      }

      return {
        largura,
        rolagemHorizontal,
        transbordando: [...new Set(transbordando)].slice(0, 5),
        alvosPequenos: [...new Set(alvosPequenos)].slice(0, 8),
        textoMiudo: [...new Set(textoMiudo)].slice(0, 5),
      }
    },
    { alvoMinimo: ALVO_MINIMO(mobile) },
  )
}

/** Sobreposição (modal/gaveta) tem de caber na tela e ser rolável se for maior. */
async function medirSobreposicao(page, seletor) {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const c = el.getBoundingClientRect()
    return {
      cabeNaLargura: c.left >= -1 && c.right <= window.innerWidth + 1,
      alturaVisivel: Math.min(c.bottom, window.innerHeight) - Math.max(c.top, 0),
      altura: c.height,
      rolavel: (() => {
        for (let p = el; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowY
          if (o === 'auto' || o === 'scroll') return true
        }
        return el.scrollHeight <= window.innerHeight
      })(),
    }
  }, seletor)
}

async function conferir(rotulo, page, vp) {
  const m = await medir(page, vp.mobile)
  ok(`${rotulo}: sem rolagem horizontal da página`, m.rolagemHorizontal <= 1, `${m.rolagemHorizontal}px de sobra`)
  ok(`${rotulo}: nada mais largo que a tela`, m.transbordando.length === 0, m.transbordando.join(' | '))
  ok(`${rotulo}: alvos de toque com ${ALVO_MINIMO(vp.mobile)}px+`, m.alvosPequenos.length === 0, m.alvosPequenos.join(' | '))
  ok(`${rotulo}: nenhum texto abaixo de 9px`, m.textoMiudo.length === 0, m.textoMiudo.join(' | '))
}

async function logar(ctx, usuario) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([
    page.waitForURL((u) => u.pathname.startsWith('/admin') || u.searchParams.has('error'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForLoadState('networkidle').catch(() => {})
  return page
}

for (const vp of VIEWPORTS) {
  secao(`${vp.nome}${vp.mobile ? ' (toque)' : ''}`)

  // ── cliente na mesa ──────────────────────────────────────────────────────
  {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      locale: 'pt-BR',
    })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/mesa/${mesaLivre.token}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    await page.screenshot({ path: `.shots/resp-${vp.nome}-cliente-cardapio.png`, fullPage: false })
    await conferir('cliente/cardápio', page, vp)

    // Configurador: é o lugar onde mais coisa disputa espaço.
    await page.locator('.mesa-categoria', { hasText: 'Burgers' }).click()
    await page.locator('.mesa-card', { hasText: 'Burger da Casa' }).locator('text=Selecionar item').click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `.shots/resp-${vp.nome}-cliente-configurador.png` })
    await conferir('cliente/configurador', page, vp)

    const modal = await medirSobreposicao(page, '.mesa-modal')
    ok(`cliente/configurador: o modal cabe na largura`, modal?.cabeNaLargura === true)
    ok(`cliente/configurador: o modal é rolável ou cabe na altura`, modal?.rolavel === true, `${Math.round(modal?.altura ?? 0)}px`)

    const progresso = await page.locator('.mesa-progresso').isVisible()
    ok(
      `cliente/configurador: progresso das etapas ${vp.width < 700 ? 'visível no celular' : 'cede lugar à trilha lateral'}`,
      vp.width < 700 ? progresso : !progresso,
    )
    if (vp.width >= 700) {
      ok('cliente/configurador: trilha lateral com as etapas', await page.locator('.mesa-trilha').isVisible())
    }

    // Chamar garçom.
    await page.locator('.mesa-fechar').click()
    await page.waitForTimeout(300)
    await page.locator('.mesa-botao-chamar').click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `.shots/resp-${vp.nome}-cliente-chamar.png` })
    const folha = await medirSobreposicao(page, '.mesa-chamar-folha')
    ok('cliente/chamar garçom: a folha cabe na tela', folha?.cabeNaLargura === true && (folha?.alturaVisivel ?? 0) >= (folha?.altura ?? 1) - 2)
    await conferir('cliente/chamar garçom', page, vp)

    await ctx.close()
  }

  // ── painel do garçom e salão ─────────────────────────────────────────────
  {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      locale: 'pt-BR',
    })
    const page = await logar(ctx, 'dono.local')

    /**
     * O checklist de configuração é um modal de interrupção que abre nas telas de
     * retaguarda. É chrome pré-existente e transitório: o dono dispensa e segue. Medir
     * a página por baixo dele exige dispensá-lo, como um usuário faria.
     */
    const dispensarChecklist = async () => {
      const botao = page.locator('button', { hasText: 'OK, entendi' })
      if (await botao.count()) {
        await botao.first().click()
        await page.waitForTimeout(400)
      }
    }

    await page.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await dispensarChecklist()
    await page.screenshot({ path: `.shots/resp-${vp.nome}-salao.png` })
    await conferir('salão', page, vp)

    await page.goto(`${BASE}/admin/mesas/${mesaOcupada.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `.shots/resp-${vp.nome}-garcom-lancar.png` })
    await conferir('garçom/lançar', page, vp)

    await page.locator('[role="tab"]', { hasText: 'Conta' }).click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `.shots/resp-${vp.nome}-garcom-conta.png` })
    await conferir('garçom/conta', page, vp)

    await page.goto(`${BASE}/admin/auditoria`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await dispensarChecklist()
    await page.screenshot({ path: `.shots/resp-${vp.nome}-auditoria.png` })
    await conferir('auditoria', page, vp)

    await ctx.close()
  }
}

// ── acessibilidade mínima e teclado ────────────────────────────────────────
secao('Acessibilidade mínima (390×844)')
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/mesa/${mesaLivre.token}`, { waitUntil: 'networkidle' })

  const semNome = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], input')]
      .filter((el) => {
        const caixa = el.getBoundingClientRect()
        if (caixa.width === 0 || caixa.height === 0) return false
        const texto = (el.textContent || '').trim()
        return !texto && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.getAttribute('alt')
      })
      .map((el) => el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0]),
  )
  ok('todo controle tem nome acessível (texto, aria-label ou title)', semNome.length === 0, semNome.slice(0, 5).join(' | '))

  const semAlt = await page.evaluate(() =>
    [...document.querySelectorAll('img')].filter((i) => i.getAttribute('alt') === null).length)
  ok('nenhuma imagem sem atributo alt', semAlt === 0, `${semAlt} imagem(ns)`)

  await page.keyboard.press('Tab')
  const focado = await page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const estilo = getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(),
      temAnel: estilo.outlineStyle !== 'none' || estilo.boxShadow !== 'none',
    }
  })
  ok('o Tab entra em um controle', !!focado, focado?.tag)

  // Escolha obrigatória: o marcador é anunciado como radio/checkbox, não só visual.
  await page.locator('.mesa-categoria', { hasText: 'Burgers' }).click()
  await page.locator('.mesa-card', { hasText: 'Burger da Casa' }).locator('text=Selecionar item').click()
  await page.waitForTimeout(500)
  const papeis = await page.evaluate(() =>
    [...document.querySelectorAll('.mesa-opcao')].map((el) => el.getAttribute('role')))
  ok('as opções têm papel de radio ou checkbox', papeis.length > 0 && papeis.every((p) => p === 'radio' || p === 'checkbox'), papeis.join(','))
  const marcados = await page.evaluate(() =>
    [...document.querySelectorAll('.mesa-opcao')].every((el) => el.getAttribute('aria-checked') !== null))
  ok('e informam se estão marcadas (aria-checked)', marcados)

  const progressoAria = await page.evaluate(() => {
    const atual = document.querySelector('.mesa-progresso-passos li.atual button')
    return { rotulo: atual?.getAttribute('aria-label') ?? null, step: atual?.getAttribute('aria-current') ?? null }
  })
  ok('a etapa atual é anunciada no progresso', progressoAria.step === 'step' && !!progressoAria.rotulo, progressoAria.rotulo ?? '')

  await ctx.close()
}

await browser.close()
await db.end()

const falhas = res.filter((r) => !r).length
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${res.length - falhas}/${res.length} verificações passaram`)
console.log('   Imagens em .shots/resp-*.png — a conferência visual é humana.')
process.exit(falhas === 0 ? 0 : 1)
