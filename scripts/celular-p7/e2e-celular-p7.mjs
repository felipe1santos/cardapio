/**
 * E2E — pendência 7: versão compacta no celular (Mesas e Comandas, tela da mesa, PDV). Stack LOCAL.
 *   · topo: só a tela cheia + ⋮ (ações no menu, por cima de tudo); garçom não vê ações de gestão;
 *   · tela cheia esconde o topo e o aviso de impressão, com botão para sair;
 *   · busca vira lupa (Mesas e tela da mesa);
 *   · cartão de mesa sem a fileira de botões (⋮ no canto);
 *   · cartão azul da mesa fino; barra de baixo colada no fundo; conta com fotos e ações no ⋮;
 *   · PDV: "Sair" no ⋮; Balcão com no máximo 2 selos;
 *   · 360/390/430 sem rolagem lateral; tablet e desktop sem mudança (fileira de botões e ações à vista).
 *
 *   E2E_LOJA=cantina-e2e E2E_VIZINHA=vizinha-e2e E2E_SUFIXO=e2e node scripts/celular-p7/e2e-celular-p7.mjs [prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'
import { E2E_LOJA, USU } from '../seguranca/e2e-ambiente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? 'docs/celular-p7/e2e'
mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (q, a = []) => (await db.query(q, a)).rows[0]
const loja = await um(`select id, pdv_v2 from restaurantes where slug=$1`, [E2E_LOJA])
const ocupada = await um(`select m.id from mesas m join comandas c on c.mesa_id=m.id and c.status='aberta' where m.restaurante_id=$1 limit 1`, [loja.id])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
await db.query(`update restaurantes set pdv_v2=true where id=$1`, [loja.id])
// Aviso de impressão: a barra existe só onde a flag manda (lib/avisos-painel); o teste confere se ela some quando existe.

const browser = await chromium.launch()
async function entrar(login, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1024, isMobile: w < 768, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}
const fecharAviso = async (p) => { const m = p.locator('[aria-labelledby="setup-alerta-titulo"]').first(); if (await m.isVisible().catch(() => false)) { await m.getByRole('button', { name: 'OK' }).first().click().catch(() => m.click({ position: { x: 5, y: 5 } }).catch(() => {})); await p.waitForTimeout(300) } }
const ir = async (p, url) => { await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500); await fecharAviso(p) }
const semRolagem = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('main *')].every((e) => e.closest('.overflow-x-auto, [class*="overflow-x-auto"]') || e.getBoundingClientRect().right <= window.innerWidth + 1))
const visivel = (loc) => loc.isVisible().catch(() => false)

try {
  secao('Mesas e Comandas (dono, 390)')
  {
    const { ctx, p } = await entrar(USU.dono, 390, 844)
    await ir(p, '/admin/mesas')
    const topo = p.getByTestId('topo')
    ok('topo: só tela cheia e ⋮ à vista (Nova mesa/Folha/Conta escondidos)', await visivel(topo.getByTestId('topo-celular').getByTestId('botao-tela-cheia')) && await visivel(p.getByTestId('mesas-menu-acoes')) && !(await visivel(topo.getByRole('button', { name: 'Nova mesa' }))) && !(await visivel(topo.getByRole('button', { name: 'Folha de QR' }))))
    const box = await topo.boundingBox()
    ok('topo numa linha só (≤ 64 px)', box && box.height <= 64, String(box?.height))
    await p.getByTestId('mesas-menu-acoes').tap()
    const menu = p.getByTestId('mesas-menu-acoes-menu')
    ok('⋮ abre as 3 ações, na camada máxima', await visivel(menu) && (await menu.getByRole('menuitem').count()) === 3 && Number(await menu.evaluate((e) => getComputedStyle(e).zIndex)) >= 9999)
    await p.screenshot({ path: join(PRINTS, 'mesas-menu-390.png') })
    await menu.getByRole('menuitem', { name: 'Nova mesa' }).tap()
    await p.waitForTimeout(500)
    ok('"Nova mesa" pelo menu abre o cadastro', await visivel(p.getByText('Nome ou número').first()))
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    await p.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200); await fecharAviso(p)
    // lupa
    ok('busca vira lupa', !(await visivel(p.getByTestId('mesas-busca'))) && await visivel(p.getByTestId('mesas-lupa')))
    await p.getByTestId('mesas-lupa').tap()
    await p.waitForTimeout(300)
    const focada = await p.getByTestId('mesas-busca').evaluate((e) => document.activeElement === e)
    ok('lupa abre o campo já com o cursor', await visivel(p.getByTestId('mesas-busca')) && focada)
    await p.getByTestId('mesas-busca').fill('Varanda')
    await p.waitForTimeout(400)
    const nomes = await p.locator('a[aria-label*="—"], div.flex.aspect-\\[4\\/3\\]').allInnerTexts()
    ok('filtra pelo texto', nomes.length > 0 && nomes.every((t) => /Varanda/i.test(t)), nomes.join(' | ').slice(0, 200))
    await p.getByTestId('mesas-busca').fill('')
    await p.locator('body').tap({ position: { x: 5, y: 400 } }).catch(() => {})
    await p.waitForTimeout(300)
    // cartões
    const fileiras = await p.locator('main .grid-cols-4').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).length)
    ok('cartões sem a fileira de botões', fileiras === 0, String(fileiras))
    const menuCard = p.locator('[data-testid^="mesa-menu-"]').filter({ hasNot: p.locator('[role="menu"]') }).first()
    ok('⋮ no canto de cada cartão', (await p.locator('button[data-testid^="mesa-menu-"]').count()) >= 3)
    await menuCard.tap()
    const mm = p.locator('[data-testid$="-menu"][role="dialog"]').last()
    ok('⋮ do cartão: QR, Editar, Bloquear, Desativar', (await mm.getByRole('menuitem').allInnerTexts()).join('|').match(/QR.*Editar.*(Bloquear|Desbloquear).*(Desativar|Reativar)/s) !== null)
    await p.keyboard.press('Escape')
    // tela cheia
    await p.getByTestId('topo-celular').getByTestId('botao-tela-cheia').tap()
    await p.waitForTimeout(500)
    ok('tela cheia: topo escondido e botão para sair', !(await visivel(p.getByTestId('topo'))) && await visivel(p.getByTestId('sair-tela-cheia')))
    ok('tela cheia: aviso de impressão escondido', !(await visivel(p.getByTestId('aviso-nova-impressao'))))
    await p.screenshot({ path: join(PRINTS, 'mesas-tela-cheia-390.png') })
    await p.getByTestId('sair-tela-cheia').tap()
    await p.waitForTimeout(400)
    ok('sair da tela cheia devolve o topo', await visivel(p.getByTestId('topo')) && !(await visivel(p.getByTestId('sair-tela-cheia'))))
    await p.screenshot({ path: join(PRINTS, 'mesas-390.png') })

    secao('Tela da mesa (dono, 390)')
    await ir(p, `/admin/mesas/${ocupada.id}`)
    const azul = await p.locator('[data-resumo-mesa]').boundingBox()
    ok('cartão azul fino (≤ 72 px, uma linha)', azul && azul.height <= 72, String(azul?.height))
    ok('topo: tela cheia + ⋮; "Trocar de mesa" no menu', await visivel(p.getByTestId('topo-celular').getByTestId('botao-tela-cheia')) && !(await visivel(p.getByTestId('topo').getByRole('button', { name: 'Trocar de mesa' }))))
    ok('busca do cardápio vira lupa', !(await visivel(p.getByTestId('mesa-busca'))) && await visivel(p.getByTestId('mesa-lupa')))
    const barra = await p.locator('[data-barra-lancamento]').boundingBox()
    ok('barra de baixo colada no fundo da tela', barra && Math.abs(barra.y + barra.height - 844) <= 2, JSON.stringify(barra))
    await p.mouse.wheel(0, 1500); await p.waitForTimeout(300)
    const barra2 = await p.locator('[data-barra-lancamento]').boundingBox()
    ok('…e continua lá depois de rolar', barra2 && Math.abs(barra2.y + barra2.height - 844) <= 2)
    await p.screenshot({ path: join(PRINTS, 'mesa-lancar-390.png') })
    await p.getByRole('tab', { name: /Conta/ }).tap()
    await p.waitForTimeout(1200)
    const fotos = await p.locator('[data-foto-item]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length)
    ok('conta com foto em cada item', fotos >= 1, String(fotos))
    ok('conta mais limpa: Reimprimir/Cancelar no ⋮ do lançamento', !(await visivel(p.getByRole('button', { name: /^Reimprimir$/ }).first())) && (await p.locator('button[data-testid^="conta-menu-"]').count()) >= 1)
    await p.screenshot({ path: join(PRINTS, 'mesa-conta-390.png'), fullPage: true })
    await ctx.close()
  }

  secao('Garçom (390)')
  {
    const { ctx, p } = await entrar(USU.garcom, 390, 844)
    await ir(p, '/admin/mesas')
    ok('garçom: sem ⋮ de gestão no topo e nos cartões', (await p.getByTestId('mesas-menu-acoes').count()) === 0 && (await p.locator('button[data-testid^="mesa-menu-"]').count()) === 0)
    ok('garçom: tela cheia à vista', await visivel(p.getByTestId('topo-celular').getByTestId('botao-tela-cheia')))
    await p.screenshot({ path: join(PRINTS, 'garcom-mesas-390.png') })
    await ctx.close()
  }

  secao('PDV (dono, 390)')
  // Uma comanda de balcão aberta para conferir os selos (apagada no fim).
  const balcao = await um(`insert into comandas (restaurante_id, tipo, cliente_nome) values ($1,'balcao','P7 Balcao Selos') returning id`, [loja.id]).catch((e) => { console.log('   (sem comanda de balcão:', e.message, ')'); return null })
  {
    const { ctx, p } = await entrar(USU.dono, 390, 844)
    await ir(p, '/admin/pdv')
    ok('PDV: tela cheia à vista; "Sair" no ⋮', await visivel(p.getByTestId('botao-tela-cheia').first()) && !(await visivel(p.getByRole('button', { name: 'Sair do PDV' }).first())) && await visivel(p.getByTestId('pdv-menu-acoes').first()))
    await p.getByTestId('pdv-menu-acoes').first().tap()
    ok('⋮ do PDV tem "Sair do PDV"', await visivel(p.getByRole('menuitem', { name: 'Sair do PDV' })))
    await p.keyboard.press('Escape')
    await p.screenshot({ path: join(PRINTS, 'pdv-390.png') })
    // Central de Balcão
    await p.getByText('Balcão', { exact: true }).first().tap().catch(() => {})
    await p.waitForTimeout(1500)
    const linhas = await p.locator('[data-tipo-icone]').count()
    if (linhas === 0) ok('Balcão: há comanda de balcão para conferir os selos', false, 'sem comanda de balcão na loja semeada')
    else {
      const maxSelos = await p.evaluate(() => Math.max(...[...document.querySelectorAll('[data-tipo-icone]')].map((ic) => {
        const linha = ic.closest('button') ?? ic.parentElement
        return [...linha.querySelectorAll('[data-testid^="selo-"], .badge, [class*="rounded"][class*="text-[10"]')].filter((e) => e.getBoundingClientRect().width > 0 && e.matches('[data-testid^="selo-"]')).length
      })))
      ok('Balcão: no máximo 2 selos por pedido', maxSelos <= 2, String(maxSelos))
      await p.screenshot({ path: join(PRINTS, 'pdv-balcao-390.png') })
    }
    await ctx.close()
  }

  secao('Larguras, tablet e desktop')
  for (const w of [360, 430]) {
    const { ctx, p } = await entrar(USU.dono, w, 860)
    let todas = true
    for (const url of ['/admin/mesas', `/admin/mesas/${ocupada.id}`, '/admin/pdv']) { await ir(p, url); todas = todas && await semRolagem(p) }
    ok(`${w}px: Mesas, mesa e PDV sem rolagem lateral`, todas)
    await ctx.close()
  }
  for (const [nome, w, h] of [['tablet', 820, 1180], ['desktop', 1366, 900]]) {
    const { ctx, p } = await entrar(USU.dono, w, h)
    await ir(p, '/admin/mesas')
    const fileira = await p.locator('main .grid-cols-4').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).length)
    ok(`${nome}: sem mudança — ações no topo, fileira de botões nos cartões, sem ⋮, busca aberta`, await visivel(p.getByTestId('topo').getByRole('button', { name: 'Nova mesa' })) && fileira >= 3 && !(await visivel(p.getByTestId('mesas-menu-acoes'))) && await visivel(p.getByTestId('mesas-busca')))
    await p.screenshot({ path: join(PRINTS, `mesas-${nome}.png`) })
    await ir(p, `/admin/mesas/${ocupada.id}`)
    const azul = await p.locator('[data-resumo-mesa]').boundingBox()
    ok(`${nome}: cartão azul como antes (ícone à vista)`, (await p.locator('[data-resumo-mesa] span.rounded-full').first().isVisible()) && azul.height >= 60)
    await ctx.close()
  }
} catch (e) {
  ok('execução sem exceção', false, String(e).slice(0, 300))
} finally {
  await db.query(`delete from comandas where restaurante_id=$1 and cliente_nome='P7 Balcao Selos'`, [loja.id]).catch(() => {})
  await db.query(`update restaurantes set pdv_v2=$2 where id=$1`, [loja.id, loja.pdv_v2])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
