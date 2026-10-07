/**
 * Organização de menus + novo painel de Integrações (2026-10-06).
 *   A. Campanhas só com Visão geral, Campanhas e Agendamentos; endereços antigos redirecionam para Ajustes.
 *   B. Ajustes: abaixo de "Conta", com ícone: Mensagens automáticas, Modelos de mensagem, Notificações do app,
 *      Robô de atendimento — cada um carregando a tela de sempre; o robô sem números nem lista de aguardando.
 *   C. Integrações no modelo: faixa "Sentiu falta…", cards (logo, nome, ">"), Ativas no topo com selo,
 *      Disponíveis por tipo, sem aviso vermelho/amarelo, sem nada do robô; WhatsApp: QR lido → sobe para
 *      Ativas; desconectar → volta. Pixel salva → Ativas; remove → volta. Mercado Pago em Pagamentos.
 *      "Sugerir integração" abre o WhatsApp do suporte com a frase.
 *   D. Submenus (Ajustes, Campanhas, Fidelidade, Financeiro): Nunito carregada, ícone preenchido em todos os
 *      itens, ativo com fundo cinza-claro; nenhum texto com fonte quebrada.
 *   E. Celular (390) 1 coluna, tablet (820) 2 colunas, desktop 3; sem rolagem lateral.
 * Banco e servidor LOCAIS (dash54-loja / dono.dash54; fin6 para o Financeiro). Tudo volta ao que era.
 * Prints lado a lado com os modelos em C:\Users\felipe\Downloads\revisao-integracoes.
 *   node scripts/integracoes/e2e-menus-integracoes.mjs
 */
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import pg from 'pg'
import sharp from 'sharp'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais(); exigirLoopback(DB_URL, BASE)
const PRINTS = join(homedir(), 'Downloads', 'revisao-integracoes'); mkdirSync(PRINTS, { recursive: true })
const MODELO_INT = join(homedir(), 'Downloads', 'integracoes-modelo.png')
const MODELO_SUB = join(homedir(), 'Downloads', 'submenu-modelo.png')
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (q, a) => (await db.query(q, a)).rows[0]
let falhas = 0, total = 0
const ok = (m, c, d = '') => { total++; console.log(`${c ? '✓' : '✗'} ${m}${c ? '' : ' — ' + d}`); if (!c) falhas++ }
const secao = (t) => console.log(`\n── ${t}`)

const loja = await um(`select id, evolution_instance ev, facebook_pixel_id fb, pix_online_ativo pix from restaurantes where slug='dash54-loja'`)
const browser = await chromium.launch()
async function logar(login, viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), p.click('button[type="submit"]')])
  return { ctx, p }
}
const fechaAvisos = async (p) => { for (const t of ['OK, entendi', 'Agora não', 'Depois']) await p.getByRole('button', { name: t }).first().click({ timeout: 500 }).catch(() => {}) }
const ir = async (p, url) => { await p.goto(`${BASE}${url}`, { waitUntil: 'load' }); await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await fechaAvisos(p); await p.waitForTimeout(900) }
const itensSubmenu = (p) => p.locator('nav[data-submenu] [data-submenu-item]').evaluateAll((els) => els.map((e) => ({ id: e.dataset.submenuItem, texto: e.innerText.trim(), svg: !!e.querySelector('svg'), ativo: e.getAttribute('aria-current') === 'page', fundo: getComputedStyle(e).backgroundColor })))
const fonteSubmenu = (p) => p.evaluate(async () => { await document.fonts.ready; const n = document.querySelector('nav[data-submenu] [data-submenu-item]'); return { familia: n ? getComputedStyle(n).fontFamily : null, carregada: document.fonts.check('500 15px Nunito') } })
const semLateral = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
async function ladoALado(modelo, nosso, nome) {
  if (!existsSync(modelo)) return
  const h = 760
  const a = await sharp(modelo).resize({ height: h, fit: 'inside' }).png().toBuffer()
  const b = await sharp(nosso).resize({ height: h, fit: 'inside' }).png().toBuffer()
  const ma = await sharp(a).metadata(), mb = await sharp(b).metadata()
  await sharp({ create: { width: ma.width + mb.width + 30, height: h, channels: 3, background: '#ffffff' } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: ma.width + 30, top: 0 }]).png().toFile(join(PRINTS, nome))
}

try {
  secao('A. Campanhas: só disparo')
  {
    const { ctx, p } = await logar('dono.dash54')
    await ir(p, '/admin/campanhas')
    const it = await itensSubmenu(p)
    ok('submenu com Visão geral, Campanhas e Agendamentos (com ícone)', JSON.stringify(it.map((i) => i.texto)) === JSON.stringify(['Visão geral', 'Campanhas', 'Agendamentos']) && it.every((i) => i.svg), JSON.stringify(it))
    ok('botão "Disparar mensagem" continua', await p.getByTestId('disparar-mensagem').isVisible())
    await p.getByTestId('disparar-mensagem').click(); await p.waitForTimeout(600)
    ok('disparo abre o formulário de campanha', (await p.locator('textarea').count()) > 0)
    await p.keyboard.press('Escape')
    for (const [antiga, nova] of [['automaticas', 'mensagens'], ['notificacoes', 'notificacoes'], ['modelos', 'modelos']]) {
      await p.goto(`${BASE}/admin/campanhas?aba=${antiga}`); await p.waitForURL((u) => u.pathname === '/admin/ajustes', { timeout: 15000 }).catch(() => {})
      ok(`?aba=${antiga} redireciona para Ajustes › ${nova}`, p.url().includes(`/admin/ajustes?aba=${nova}`), p.url())
    }
    await ir(p, '/admin/campanhas'); await p.screenshot({ path: join(PRINTS, 'campanhas-submenu-1366.png') })
    await ctx.close()
  }

  secao('B. Ajustes: WhatsApp e notificações')
  {
    const { ctx, p } = await logar('dono.dash54')
    await ir(p, '/admin/ajustes')
    const it = await itensSubmenu(p)
    const ids = it.map((i) => i.id)
    ok('itens novos logo abaixo de "Conta", com ícone', JSON.stringify(ids) === JSON.stringify(['loja', 'entrega', 'mesas', 'qrcode', 'conta', 'mensagens', 'modelos', 'notificacoes', 'robo']) && it.every((i) => i.svg), JSON.stringify(ids))
    await p.locator('[data-submenu-item="mensagens"]').click(); await p.waitForTimeout(1200)
    ok('Mensagens automáticas: a tela de sempre (status do pedido, texto editável e prévia)', await p.getByTestId('mensagens-automaticas').isVisible() && (await p.getByTestId('texto-etapa').count()) > 0)
    ok('URL guarda a seção (?aba=mensagens)', p.url().includes('aba=mensagens'))
    await p.screenshot({ path: join(PRINTS, 'ajustes-mensagens-1366.png') })
    // salva um texto e devolve ao padrão
    const editor = p.getByTestId('editor-texto').first()
    if (await editor.count()) {
      await p.getByTestId('texto-etapa').first().click().catch(() => {}); await p.waitForTimeout(400)
    }
    await p.locator('[data-submenu-item="modelos"]').click(); await p.waitForTimeout(1000)
    ok('Modelos de mensagem: a tela de sempre', await p.getByTestId('modelos').isVisible())
    await p.locator('[data-submenu-item="notificacoes"]').click(); await p.waitForTimeout(1000)
    ok('Notificações do app: a tela de sempre', await p.getByTestId('ajustes-notificacoes').isVisible() && /notifica/i.test(await p.getByTestId('ajustes-notificacoes').innerText()))
    await p.screenshot({ path: join(PRINTS, 'ajustes-notificacoes-1366.png') })
    await p.locator('[data-submenu-item="robo"]').click(); await p.waitForTimeout(1500)
    ok('Robô de atendimento: liga/desliga e o que responde', await p.getByTestId('robo-alternar').isVisible() && await p.getByTestId('robo-o-que-responde').isVisible())
    ok('Robô em Ajustes: sem números de 24h nem lista de aguardando', (await p.getByTestId('robo-24h').count()) === 0 && (await p.getByTestId('robo-sem-silenciadas').count()) === 0 && (await p.getByTestId('robo-silenciadas').count()) === 0)
    await p.screenshot({ path: join(PRINTS, 'ajustes-robo-1366.png') })
    await p.locator('[data-submenu-item="conta"]').click(); await p.waitForTimeout(500)
    const nav = p.locator('nav[data-submenu]')
    await nav.screenshot({ path: join(PRINTS, 'ajustes-submenu-1366.png') })
    const f = await fonteSubmenu(p)
    ok('submenu em Nunito (guardada no projeto, carregada)', /Nunito/.test(f.familia ?? '') && f.carregada, JSON.stringify(f))
    const at = (await itensSubmenu(p)).find((i) => i.ativo)
    ok('item ativo com fundo cinza-claro', at && at.fundo === 'rgb(238, 240, 243)', JSON.stringify(at))
    await ctx.close()
  }

  secao('C. Integrações no modelo')
  await db.query(`update restaurantes set evolution_instance=null, facebook_pixel_id=null, pix_online_ativo=true where id=$1`, [loja.id])
  {
    const { ctx, p } = await logar('dono.dash54')
    await ir(p, '/admin/integracoes'); await p.waitForTimeout(800)
    ok('faixa "Sentiu falta de alguma integração?" com "+ Sugerir integração"', await p.getByTestId('faixa-sugerir').isVisible() && /Sentiu falta de alguma integração\?/.test(await p.getByTestId('faixa-sugerir').innerText()))
    const href = await p.getByTestId('sugerir-integracao').getAttribute('href')
    ok('"Sugerir integração" abre o WhatsApp do suporte com a frase', href?.startsWith('https://wa.me/5527992534407?text=') && decodeURIComponent(href.split('text=')[1]) === 'Gostaria de sugerir a integração: ', href)
    const cards = await p.locator('[data-testid^="integracao-"][data-ativa]').evaluateAll((els) => els.map((e) => ({ id: e.dataset.testid.replace('integracao-', ''), ativa: e.dataset.ativa, img: !!e.querySelector('img'), seta: !!e.querySelector('svg') })))
    ok('só integrações reais, cada uma com logo e seta', cards.length >= 5 && cards.every((c) => c.img && c.seta) && cards.every((c) => ['whatsapp', 'mercadopago', 'facebook', 'capi', 'google', 'nexta'].includes(c.id)), JSON.stringify(cards))
    ok('WhatsApp desconectado está em Disponíveis', cards.find((c) => c.id === 'whatsapp')?.ativa === 'nao')
    ok('Mercado Pago (Pix liberado) em "Pagamentos"', await p.locator('section', { has: p.getByRole('heading', { name: 'Pagamentos' }) }).getByTestId('integracao-mercadopago').isVisible())
    const texto = await p.getByTestId('pagina-integracoes').innerText()
    ok('nada do robô na tela de Integrações', !/robô|Mensagens recebidas|Ninguém aguardando|O que o robô/i.test(texto))
    const vermelhos = await p.getByTestId('pagina-integracoes').evaluate((r) => [...r.querySelectorAll('*')].filter((e) => { const c = getComputedStyle(e).color; return /rgb\((185, 28, 28|220, 38, 38|146, 64, 14|180, 83, 9)\)/.test(c) }).length)
    ok('"Disponível" sem aviso vermelho/amarelo', vermelhos === 0, String(vermelhos))
    const colunas = await p.locator('[data-testid="secao-disponiveis"] .grid').first().evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)
    ok('desktop: 3 colunas', colunas === 3, String(colunas))
    await p.screenshot({ path: join(PRINTS, 'integracoes-1366-antes-de-conectar.png') })

    // WhatsApp: conectar (QR) → leu → sobe para Ativas
    await p.route('**/api/admin/whatsapp/conectar', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }) }))
    await p.getByTestId('integracao-whatsapp').click(); await p.waitForTimeout(600)
    ok('card abre a janela do WhatsApp por cima', await p.getByTestId('janela-integracao').isVisible())
    await p.getByTestId('whatsapp-conectar').click(); await p.waitForTimeout(800)
    ok('Conectar mostra o QR code', await p.getByTestId('whatsapp-qr').isVisible())
    ok('janela do WhatsApp sem nada do robô', !/robô/i.test(await p.getByTestId('janela-integracao').innerText()))
    await p.screenshot({ path: join(PRINTS, 'integracoes-whatsapp-qr-1366.png') })
    await db.query(`update restaurantes set evolution_instance='menuzia-e2e-integracoes' where id=$1`, [loja.id]) // "leu o QR"
    let conectou = false; try { await p.getByTestId('whatsapp-conectado').waitFor({ timeout: 9000 }); conectou = true } catch { /* */ }
    ok('leu o QR: janela mostra "Conectado" e "Desconectar"', conectou && await p.getByTestId('whatsapp-desconectar').isVisible())
    await p.screenshot({ path: join(PRINTS, 'integracoes-whatsapp-conectado-1366.png') })
    await p.getByTestId('janela-integracao-fechar').click(); await p.waitForTimeout(1200)
    ok('WhatsApp subiu sozinho para "Integrações ativas" com o selo', await p.locator('[data-testid="secao-ativas"] [data-testid="integracao-whatsapp"]').isVisible() && await p.getByTestId('integracao-whatsapp-ativa').isVisible())
    await p.screenshot({ path: join(PRINTS, 'integracoes-1366-whatsapp-ativo.png') })
    // desconectar → volta para Disponíveis
    await p.route('**/api/admin/whatsapp/desconectar', async (r) => { await db.query(`update restaurantes set evolution_instance=null where id=$1`, [loja.id]); await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) })
    await p.getByTestId('integracao-whatsapp').click(); await p.waitForTimeout(600)
    await p.getByTestId('whatsapp-desconectar').click(); await p.getByTestId('whatsapp-desconectar-confirmar').click(); await p.waitForTimeout(1500)
    ok('desconectou: janela volta a "Conectar WhatsApp"', await p.getByTestId('whatsapp-conectar').isVisible())
    await p.getByTestId('janela-integracao-fechar').click(); await p.waitForTimeout(1200)
    ok('WhatsApp voltou para "Disponíveis"', (await p.locator('[data-testid="secao-ativas"] [data-testid="integracao-whatsapp"]').count()) === 0 && await p.locator('[data-testid="secao-disponiveis"] [data-testid="integracao-whatsapp"]').isVisible())

    // Pixel: salvar → Ativas; remover → Disponíveis
    await p.getByTestId('integracao-facebook').click(); await p.waitForTimeout(500)
    await p.getByTestId('pixel-facebook-adicionar').click(); await p.getByTestId('pixel-facebook-campo').fill('1234567890123456'); await p.getByTestId('pixel-facebook-salvar').click(); await p.waitForTimeout(1200)
    await p.getByTestId('janela-integracao-fechar').click(); await p.waitForTimeout(1200)
    ok('Facebook Pixel salvo: sobe para Ativas', await p.locator('[data-testid="secao-ativas"] [data-testid="integracao-facebook"]').isVisible())
    const salvo = await um(`select facebook_pixel_id from restaurantes where id=$1`, [loja.id])
    ok('Pixel gravado no banco como antes', salvo.facebook_pixel_id === '1234567890123456', JSON.stringify(salvo))
    await p.getByTestId('integracao-facebook').click(); await p.waitForTimeout(500)
    await p.getByTestId('pixel-facebook-editar').click(); await p.getByTestId('pixel-facebook-remover').click(); await p.getByTestId('pixel-facebook-remover-confirmar').click(); await p.waitForTimeout(1200)
    await p.getByTestId('janela-integracao-fechar').click(); await p.waitForTimeout(1200)
    ok('Pixel removido: volta para Disponíveis', (await p.locator('[data-testid="secao-ativas"] [data-testid="integracao-facebook"]').count()) === 0)
    await ladoALado(MODELO_INT, join(PRINTS, 'integracoes-1366-antes-de-conectar.png'), 'lado-a-lado-integracoes-desktop.png')
    await ctx.close()
  }

  secao('D. Submenus em todas as telas')
  {
    const { ctx, p } = await logar('dono.dash54')
    for (const url of ['/admin/ajustes', '/admin/campanhas', '/admin/fidelidade']) {
      await ir(p, url)
      const it = await itensSubmenu(p); const f = await fonteSubmenu(p)
      ok(`${url}: ícone em todos os itens, Nunito carregada`, it.length > 0 && it.every((i) => i.svg) && /Nunito/.test(f.familia ?? '') && f.carregada, JSON.stringify({ it: it.length, f }))
    }
    await ir(p, '/admin/fidelidade'); await p.locator('nav[data-submenu]').screenshot({ path: join(PRINTS, 'fidelidade-submenu-1366.png') })
    await ctx.close()
    const fin = await logar('dono.fin6')
    await ir(fin.p, '/admin/financeiro')
    const it = await itensSubmenu(fin.p); const f = await fonteSubmenu(fin.p)
    ok('/admin/financeiro: ícone em todos os itens, Nunito carregada', it.length > 3 && it.every((i) => i.svg) && /Nunito/.test(f.familia ?? '') && f.carregada, JSON.stringify({ it: it.length, f }))
    await fin.p.locator('nav[data-submenu]').screenshot({ path: join(PRINTS, 'financeiro-submenu-1366.png') })
    await fin.ctx.close()
    await ladoALado(MODELO_SUB, join(PRINTS, 'ajustes-submenu-1366.png'), 'lado-a-lado-submenu-desktop.png')
  }

  secao('E. Celular e tablet')
  for (const [w, cols, nome] of [[390, 1, 'celular'], [820, 2, 'tablet']]) {
    const { ctx, p } = await logar('dono.dash54', { width: w, height: 844 })
    await ir(p, '/admin/integracoes'); await p.waitForTimeout(800)
    const c = await p.locator('[data-testid="secao-disponiveis"] .grid').first().evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)
    ok(`${nome} (${w}px): ${cols} coluna(s) e sem rolagem lateral`, c === cols && await semLateral(p), String(c))
    await p.screenshot({ path: join(PRINTS, `integracoes-${nome}-${w}.png`), fullPage: true })
    if (w === 390) {
      await ladoALado(MODELO_INT, join(PRINTS, `integracoes-${nome}-${w}.png`), 'lado-a-lado-integracoes-celular.png')
      await ir(p, '/admin/ajustes')
      ok('celular: submenu de Ajustes em trilho no topo, sem rolagem lateral', await semLateral(p) && await p.locator('nav[data-submenu]').isVisible())
      await p.screenshot({ path: join(PRINTS, 'ajustes-submenu-celular-390.png') })
      await ladoALado(MODELO_SUB, join(PRINTS, 'ajustes-submenu-celular-390.png'), 'lado-a-lado-submenu-celular.png')
    }
    await ctx.close()
  }
} finally {
  await db.query(`update restaurantes set evolution_instance=$2, facebook_pixel_id=$3, pix_online_ativo=$4 where id=$1`, [loja.id, loja.ev, loja.fb, loja.pix])
  await browser.close(); await db.end()
  console.log(`\n${total - falhas}/${total} verificações passaram`)
  process.exitCode = falhas ? 1 : 0
}
