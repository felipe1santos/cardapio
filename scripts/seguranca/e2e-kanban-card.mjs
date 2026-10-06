/**
 * E2E — card mínimo (3 linhas) + painel lateral do pedido, sem bloquear a tela (2026-10-03).
 * Loja local ordem-qr-e2e com os pedidos de kanban-cards-semente.mjs (entrega, retirada, mesa,
 * PDV, vitrine; nome longo, valor alto; cada forma; observações; 4 min, 3 horas e 2 dias).
 *
 *   node scripts/seguranca/kanban-cards-semente.mjs criar
 *   node scripts/seguranca/e2e-kanban-card.mjs
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id from restaurantes where slug='ordem-qr-e2e'`)
// A semente é recriada aqui: outras suítes do Kanban limpam pedidos TESTE da mesma loja.
execSync('node scripts/seguranca/kanban-cards-semente.mjs criar', { stdio: 'inherit', env: process.env })
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const texto = (v) => JSON.stringify(v)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
async function ate(fn, ms = 12000) { const fim = Date.now() + ms; while (Date.now() < fim) { if (await fn()) return true; await esperar(400) } return false }
const numeroDe = async (nome) => (await um(`select numero, id from pedidos where restaurante_id=$1 and cliente_nome=$2 and status <> 'cancelado' order by criado_em desc limit 1`, [loja.id, nome]))

async function abrir(b, vp) {
  const ctx = await b.newContext({ viewport: vp, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: vp.width < 500, isMobile: vp.width < 500 })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.ordemqr'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
  await p.locator('[data-testid^="pedido-"]').first().waitFor({ timeout: 15000 })
  await p.waitForTimeout(1000)
  return { ctx, p }
}
const cartao = (p, n) => p.getByTestId(`pedido-${n}`)
const painelNumero = async (p) => ((await p.getByTestId('painel-pedido').locator('h2').innerText().catch(() => '')).match(/#(\d+)/) ?? [])[1]

const b = await chromium.launch()
try {
  for (const [nome, vp] of [['desktop', { width: 1600, height: 1000 }], ['tablet', { width: 1024, height: 900 }], ['celular', { width: 390, height: 900 }]]) {
    console.log(`\n── ${nome} (${vp.width}) ──`)
    const { ctx, p } = await abrir(b, vp)
    const m = await p.evaluate(() => {
      const transparente = (el) => { const c = getComputedStyle(el).backgroundColor; return c === 'rgba(0, 0, 0, 0)' || c === 'transparent' }
      const pronto = [...document.querySelectorAll('[data-testid="card-etapa"]')].find((x) => /pronto/i.test(x.getAttribute('aria-label') ?? x.textContent))
      const verde = pronto ? getComputedStyle(pronto).color : null
      return [...document.querySelectorAll('[data-testid^="pedido-"]')].map((card) => {
        const q = (s) => card.querySelector(s)
        const filhos = [...card.children].filter((c) => c.getBoundingClientRect().height > 0)
        const botao = q('[data-testid="card-etapa"], [data-testid="card-na-logistica"]')
        const rc = card.getBoundingClientRect(), rb = botao?.getBoundingClientRect()
        const preco = q('[data-testid="card-preco"]'), pag = q('[data-testid="card-pagamento"]')
        const linhas = [...new Set(filhos.map((f) => Math.round(f.getBoundingClientRect().top)))]
        return {
          nome: card.querySelector('span.font-semibold')?.textContent.trim().slice(0, 40),
          filhos: filhos.length, linhas: linhas.length,
          semItens: !q('ul') && !q('[data-testid="info-pagamento"]') && !q('[data-testid="card-detalhes"]'),
          pag: pag ? { title: pag.getAttribute('title'), icone: !!pag.querySelector('svg'), antesDoPreco: pag.getBoundingClientRect().right <= preco.getBoundingClientRect().left + 1 } : null,
          preco: preco ? { cor: getComputedStyle(preco).color, fundo: getComputedStyle(preco).backgroundColor, peso: Number(getComputedStyle(preco).fontWeight), semFundo: transparente(preco) } : null,
          verde,
          botao: botao ? { larguraTotal: rb.width >= rc.width - 28, direita: rc.right - rb.right <= 16 && (botao.dataset.testid === 'card-na-logistica' || rb.width < rc.width / 2), seta: botao.dataset.testid === 'card-na-logistica' || botao.lastElementChild?.tagName.toLowerCase() === 'svg', alturaPx: Math.round(rb.height) } : null,
          altura: Math.round(rc.height), cursor: getComputedStyle(card).cursor,
          vaza: [...card.querySelectorAll('span, div, button')].some((e) => e.getClientRects().length && e.getBoundingClientRect().right > rc.right + 1),
        }
      })
    })
    const larg = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vis: window.innerWidth }))
    ok('sem rolagem horizontal da página', larg.doc <= larg.vis + 1, texto(larg))
    ok(`${m.length} cards com SÓ 3 linhas (sem itens, sem linha de pagamento, sem "Ver")`, m.length >= 7 && m.every((c) => c.filhos === 3 && c.semItens), texto(m.filter((c) => c.filhos !== 3 || !c.semItens).map((c) => [c.nome, c.filhos])))
    ok('linha 2: ícone da forma antes do preço, com tooltip (forma · status · troco)', m.filter((c) => c.pag).length >= 6 && m.filter((c) => c.pag).every((c) => c.pag.icone && c.pag.antesDoPreco && / · /.test(c.pag.title)), texto(m.filter((c) => c.pag).map((c) => c.pag.title)))
    ok('troco no tooltip ("Troco p/ R$ 200,00")', m.some((c) => /Troco p\/ R\$\s?200,00/.test(c.pag?.title ?? '')))
    ok('mesa sem ícone de pagamento', !m.find((c) => c.nome?.startsWith('TESTE Card Mesa'))?.pag)
    // Item 56: valor em selo verde-claro, como no modelo.
    ok('preço em selo verde-claro do modelo (#E3FAED), texto verde negrito', m.every((c) => c.preco.fundo === 'rgb(227, 250, 237)' && c.preco.cor === 'rgb(22, 101, 52)' && c.preco.peso >= 700), `${m[0].preco.fundo} / ${m[0].preco.cor}`)
    // Item 56: só a seta, alinhada à direita, sem ocupar a largura toda.
    ok('linha 3: só o botão da seta, à direita (não ocupa a largura toda)', m.every((c) => c.botao?.direita && c.botao.seta), texto(m.filter((c) => !(c.botao?.direita && c.botao?.seta)).map((c) => c.nome)))
    ok('cursor de mão no card', m.every((c) => c.cursor === 'pointer'))
    ok('nome longo e valor alto não vazam', m.every((c) => !c.vaza), texto(m.filter((c) => c.vaza).map((c) => c.nome)))
    ok(`card compacto (altura ≤ ${nome === 'celular' ? 130 : 140} px)`, m.every((c) => c.altura <= (nome === 'celular' ? 130 : 140)), texto([...new Set(m.map((c) => c.altura))]))

    // Painel: abrir, trocar, fechar.
    const ent = await numeroDe('TESTE Card Entrega Dinheiro com Troco')
    const ret = await numeroDe('TESTE Card Retirada Pronta')
    await cartao(p, ent.numero).click({ position: { x: 40, y: 40 } })
    ok('clicar no card abre o painel do pedido', await ate(async () => (await painelNumero(p)) === String(ent.numero), 5000))
    ok('card selecionado destacado', (await cartao(p, ent.numero).getAttribute('data-selecionado')) === '1')
    if (nome !== 'celular') {
      const sobreposto = await p.evaluate(() => {
        const painel = document.querySelector('[data-testid="painel-pedido"]').getBoundingClientRect()
        const quadro = document.querySelector('[data-testid="kanban-quadro"]').getBoundingClientRect()
        return { quadroDireita: Math.round(quadro.right), painelEsquerda: Math.round(painel.left), overlay: [...document.querySelectorAll('div.fixed.inset-0')].some((d) => d.getBoundingClientRect().width > 0) }
      })
      ok('sem overlay: o painel fica ao lado, o quadro termina antes dele (nenhum card escondido)', !sobreposto.overlay && sobreposto.quadroDireita <= sobreposto.painelEsquerda + 1, texto(sobreposto))
      await cartao(p, ret.numero).click({ position: { x: 40, y: 40 } })
      ok('com o painel aberto, clicar em outro card troca na hora', await ate(async () => (await painelNumero(p)) === String(ret.numero), 3000))
      await cartao(p, ret.numero).click({ position: { x: 40, y: 40 } })
      ok('clicar de novo no card selecionado fecha', await ate(async () => (await p.getByTestId('painel-pedido').count()) === 0, 3000))
      await cartao(p, ent.numero).click({ position: { x: 40, y: 40 } })
      await p.keyboard.press('Escape')
      ok('Esc fecha', await ate(async () => (await p.getByTestId('painel-pedido').count()) === 0, 3000))
      await cartao(p, ent.numero).click({ position: { x: 40, y: 40 } })
      await p.getByTestId('painel-fechar').click()
      ok('X fecha', await ate(async () => (await p.getByTestId('painel-pedido').count()) === 0, 3000))
      await cartao(p, ent.numero).click({ position: { x: 40, y: 40 } })
    } else {
      const tela = await p.getByTestId('painel-pedido').boundingBox()
      ok('celular: painel em tela cheia com "← Voltar"', !!tela && tela.width >= vp.width - 1 && await p.getByTestId('painel-voltar').isVisible(), texto(tela))
    }
    const pn = await p.evaluate(() => {
      const el = (s) => document.querySelector(s)
      const st = (s) => (el(s) ? getComputedStyle(el(s)) : null)
      const etapas = [...document.querySelectorAll('[data-testid="painel-linha-do-tempo"] li')].map((li) => [li.dataset.testid, li.dataset.estado])
      const tl = el('[data-testid="painel-linha-do-tempo"]')
      return {
        etapas, horizontal: tl ? new Set([...tl.children].map((c) => Math.round(c.getBoundingClientRect().top))).size === 1 : false,
        obsItem: st('[data-testid="painel-obs-item"]') ? { fundo: st('[data-testid="painel-obs-item"]').backgroundColor, cor: st('[data-testid="painel-obs-item"]').color, icone: !!el('[data-testid="painel-obs-item"] svg') } : null,
        obsPedido: !!el('[data-testid="painel-obs-pedido"]'),
        total: st('[data-testid="painel-total"]') ? { cor: st('[data-testid="painel-total"]').color, px: parseFloat(st('[data-testid="painel-total"]').fontSize), peso: Number(st('[data-testid="painel-total"]').fontWeight) } : null,
        precosItens: [...document.querySelectorAll('[data-testid="painel-itens"] li span.tabular-nums')].map((s) => getComputedStyle(s).color),
        itensPx: parseFloat(getComputedStyle(el('[data-testid="painel-itens"] li > div') ?? document.body).fontSize),
        cancelar: st('[data-testid="painel-cancelar"]') ? { fundo: st('[data-testid="painel-cancelar"]').backgroundColor, cor: st('[data-testid="painel-cancelar"]').color } : null,
        telefone: el('[data-testid="painel-telefone"]')?.getAttribute('href'),
        endereco: el('[data-testid="painel-endereco"]')?.textContent.includes('Centro'),
        troco: el('[data-testid="painel-troco"]')?.textContent,
        reimprimir: !!el('[data-testid="painel-reimprimir"]'), alterar: !!el('[data-testid="detalhes-alterar-pagamento"]'),
        horario: el('[data-testid="painel-horario"]')?.textContent,
      }
    })
    ok('linha do tempo horizontal, numa linha: Recebido → Preparando → Pronto → Em rota → Entregue (entrega)', pn.horizontal && pn.etapas.map((e) => e[0]).join(',') === 'etapa-recebido,etapa-preparando,etapa-pronto,etapa-em_rota,etapa-entregue' && pn.etapas[0][1] === 'atual', texto(pn.etapas))
    ok('observações do item e do pedido em vermelho com fundo vermelho claro e ícone', pn.obsItem && pn.obsItem.fundo === 'rgb(254, 226, 226)' && pn.obsItem.cor === 'rgb(239, 68, 68)' && pn.obsItem.icone && pn.obsPedido, texto(pn.obsItem))
    ok('preços dos itens, subtotal e total no verde do Pronto; total maior e negrito', pn.total && pn.total.cor === m[0].verde && pn.total.px >= 18 && pn.total.peso >= 700 && pn.precosItens.length >= 2 && pn.precosItens.every((c) => c === m[0].verde), texto(pn.total))
    ok('letra dos itens maior (15 px)', pn.itensPx >= 15, String(pn.itensPx))
    ok('cliente/pagamento: telefone clicável, endereço com bairro, "Troco p/ … · levar …", horário e "há quanto tempo"', /^tel:\d+/.test(pn.telefone ?? '') && pn.endereco && /Troco p\/ R\$\s?200,00 · levar R\$/.test(pn.troco ?? '') && /Feito às \d\d:\d\d · há/.test(pn.horario ?? ''), texto({ tel: pn.telefone, troco: pn.troco, horario: pn.horario }))
    ok('rodapé: Reimprimir e Cancelar (vermelho escuro, texto branco); Alterar pagamento', pn.reimprimir && pn.alterar && pn.cancelar?.fundo === 'rgb(153, 27, 27)' && pn.cancelar?.cor === 'rgb(255, 255, 255)', texto(pn.cancelar))
    if (nome === 'celular') {
      await p.getByTestId('painel-voltar').tap()
      ok('celular: "← Voltar" fecha', await ate(async () => (await p.getByTestId('painel-pedido').count()) === 0, 3000))
    }
    if (nome === 'desktop') {
      // Tempo real (pedido "Valor Alto", em preparo): muda a etapa e cancela no banco; o painel acompanha.
      await p.keyboard.press('Escape')
      const alto = await numeroDe('TESTE Card Valor Alto')
      await cartao(p, alto.numero).click({ position: { x: 40, y: 40 } })
      await db.query(`update pedidos set status='pronto' where id=$1`, [alto.id])
      ok('tempo real: a etapa muda no painel (Pronto atual)', await ate(async () => (await p.locator('[data-testid="etapa-pronto"]').getAttribute('data-estado')) === 'atual', 15000))
      await db.query(`update pedidos set status='cancelado', cancelado_motivo='teste', cancelado_em=now() where id=$1`, [alto.id])
      ok('tempo real: cancelamento aparece no painel', await ate(async () => (await p.getByTestId('painel-cancelado').count()) === 1, 15000))
      await p.keyboard.press('Escape')
      // Linha do tempo de retirada e mesa sem "Em rota".
      await cartao(p, ret.numero).click({ position: { x: 40, y: 40 } })
      const etRet = await p.locator('[data-testid="painel-linha-do-tempo"] li').evaluateAll((l) => l.map((x) => x.dataset.testid))
      ok('retirada: só as etapas que existem (sem "Em rota")', !etRet.includes('etapa-em_rota') && etRet.length === 4, texto(etRet))
      await p.keyboard.press('Escape')
      // Botão de etapa avança sem abrir o painel.
      const vit = await numeroDe('TESTE Card Vitrine Pix')
      await cartao(p, vit.numero).getByTestId('card-etapa').click()
      ok('botão de etapa avança (Aceitar → Preparando) e NÃO abre o painel', await ate(async () => (await um(`select status::text s from pedidos where id=$1`, [vit.id])).s === 'preparando', 8000) && (await p.getByTestId('painel-pedido').count()) === 0)
      // Tela cheia com painel.
      await p.getByTestId('kanban-mais').click(); await p.getByTestId('kanban-mais-menu').getByText('Tela cheia').click()
      await p.waitForTimeout(700)
      await cartao(p, ret.numero).click({ position: { x: 40, y: 40 } })
      const cheia = await p.evaluate(() => ({ cards: document.querySelectorAll('[data-testid^="pedido-"]').length, painel: !!document.querySelector('[data-testid="painel-pedido"]'), horizontal: document.documentElement.scrollWidth > window.innerWidth + 1 }))
      ok('tela cheia: cards e painel, sem rolagem lateral', cheia.cards >= 6 && cheia.painel && !cheia.horizontal, texto(cheia))
    }
    await ctx.close()
  }
} finally {
  await b.close()
  await db.end()
}

console.log('\n── Despacho de rotas e Cozinha ──')
// Mapas, Cozinha, badge e botão: nenhuma alteração.
const diff = execSync('git diff --stat origin/main -- components/maps app/cozinha components/ui/badge.tsx components/ui/button.tsx', { encoding: 'utf8' }).trim()
ok('Cozinha, mapas, badge e botão sem nenhuma alteração', diff === '', diff)
// Despacho de rotas (regra 4): desde a noite 3 (item 5, mapa abrindo em Fortaleza) o FUNCIONAMENTO
// pode mudar; o design não — classes, estilo do mapa e ícones iguais aos do main.
const superficie = (bruto) => {
  const txt = bruto.replace(/\r\n/g, '\n')
  return [
    ...(txt.match(/className=("[^"]*"|\{`[^`]*`\}|\{\[[\s\S]*?\]\.join\(' '\)\})/g) ?? []),
    (txt.match(/const LIGHT_MAP_STYLE[\s\S]*?\n\]/) ?? [''])[0],
    (txt.match(/function pinIcon[\s\S]*?\n\}/) ?? [''])[0],
    (txt.match(/function motoIcon[\s\S]*?\n\}/) ?? [''])[0],
  ].join('\n')
}
const despachoMudou = ['components/pedidos/rota-panel.tsx', 'components/pedidos/rota-map.tsx'].filter((arq) =>
  superficie(execSync(`git show origin/main:${arq}`, { encoding: 'utf8' })) !== superficie(readFileSync(arq, 'utf8')))
ok('"Despacho de rotas" com o design intocado (classes, estilo do mapa e ícones iguais ao main)', despachoMudou.length === 0, despachoMudou.join(', '))

const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
