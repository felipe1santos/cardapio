// E2E do "Dúvidas?" do painel: modal "Como podemos ajudar?" e a URL do WhatsApp gerada.
// NENHUMA mensagem é enviada: window.open é trocado por um espião (a aba nunca abre) e
// qualquer requisição para wa.me/whatsapp é abortada e contada. Só lê o banco LOCAL.
//   node scripts/seguranca/e2e-suporte.mjs [pasta-de-screenshots]
import { chromium } from 'playwright'
import pg from 'pg'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
exigirLoopback(BASE)
const SHOTS = process.argv[2] ?? null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? '✔' : '✘'} ${n}${d ? ` — ${d}` : ''}`) }
const foto = async (p, nome) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, `${nome}.png`) }) }

const NUMERO = '5527998534407'
const ROTULO = { dono: 'Dono', gerente: 'Gerente', atendente: 'Atendente', garcom: 'Garçom' }
const browser = await chromium.launch()
let tentativasWhatsapp = 0

async function abrirComo(usuario, { w = 1366, h = 768, bloquearAba = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', isMobile: w < 900, hasTouch: w < 900 })
  // Rede: nada sai para o WhatsApp.
  await ctx.route(/wa\.me|whatsapp\.com/, (r) => { tentativasWhatsapp++; return r.abort() })
  // window.open vira espião: registra a URL e não abre nada.
  await ctx.addInitScript((bloquear) => {
    window.__aberturas = []
    window.open = (url) => { window.__aberturas.push(String(url)); return bloquear ? null : { opener: 'x', closed: false } }
  }, bloquearAba)
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', usuario)
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }), p.click('button[type="submit"]')])
  await p.waitForLoadState('networkidle')
  return p
}
const dispensar = (p) => p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
const aberturas = (p) => p.evaluate(() => window.__aberturas)
const botao = (p) => p.getByRole('button', { name: 'Dúvidas? Falar com o suporte' })
const dialogo = (p) => p.getByRole('dialog', { name: 'Como podemos ajudar?' })

let urlExemplo = null
try {
  for (const [usuario, papel, tela] of [['dono.local', 'dono', '/admin/pedidos'], ['gerente.local', 'gerente', '/admin/pedidos'], ['atendente.local', 'atendente', '/admin/pedidos'], ['garcom.local', 'garcom', '/admin/mesas']]) {
    console.log(`\n── ${usuario} (${papel}) ──`)
    const u = await um(`select u.nome, u.papel, r.nome loja from usuarios u join restaurantes r on r.id = u.restaurante_id where u.usuario = $1`, [usuario])
    const p = await abrirComo(usuario)
    // Query e fragmento com "segredo" e um id: nada disso pode ir na mensagem.
    await p.goto(`${BASE}${tela}?token=SEGREDO123&cliente=Joao#pedido-99`, { waitUntil: 'networkidle' }); await dispensar(p)

    await botao(p).click()
    ok('abre o modal (não abre o WhatsApp direto)', await dialogo(p).isVisible() && (await aberturas(p)).length === 0)
    await p.waitForTimeout(150)
    ok('foco no campo da dúvida', await p.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'suporte-duvida'))
    ok('diálogo acessível (aria-modal, título e descrição)', await p.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      return d?.getAttribute('aria-modal') === 'true' && !!document.getElementById(d.getAttribute('aria-labelledby') ?? '')?.textContent && !!d.getAttribute('aria-describedby')
    }))
    if (papel === 'dono') await foto(p, '01-modal-desktop')

    await p.keyboard.press('Escape')
    ok('Esc fecha', !(await dialogo(p).isVisible()))
    ok('foco volta ao botão "Dúvidas?"', await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Dúvidas? Falar com o suporte'))
    await botao(p).click(); await p.getByRole('button', { name: 'Fechar', exact: true }).click()
    ok('X fecha', !(await dialogo(p).isVisible()))
    await botao(p).click(); await p.getByRole('button', { name: 'Cancelar' }).click()
    ok('Cancelar fecha', !(await dialogo(p).isVisible()))

    await botao(p).click()
    await p.getByTestId('suporte-enviar').click()
    ok('vazio: não envia e avisa', (await aberturas(p)).length === 0 && /Descreva sua dúvida/.test(await p.getByTestId('suporte-erro').innerText()))
    if (papel === 'dono') await foto(p, '03-validacao-campo-vazio')
    await p.getByTestId('suporte-duvida').fill('   \n   ')
    await p.getByTestId('suporte-enviar').click()
    ok('só espaços: não envia', (await aberturas(p)).length === 0 && await p.getByTestId('suporte-erro').isVisible())

    const DUVIDA = `Como troco a taxa de entrega? (${papel})`
    await p.getByTestId('suporte-duvida').fill(DUVIDA)
    await p.getByTestId('suporte-enviar').dblclick()
    await p.waitForTimeout(300)
    const abriu = await aberturas(p)
    ok('clique duplo abre UMA vez', abriu.length === 1, `${abriu.length} abertura(s)`)
    ok('fecha o modal depois de abrir', !(await dialogo(p).isVisible()))
    const url = abriu[0] ?? ''
    ok(`número exato ${NUMERO}`, url.startsWith(`https://wa.me/${NUMERO}?text=`), url.slice(0, 40))
    const texto = decodeURIComponent(url.split('?text=')[1] ?? '')
    const esperado = ['Olá! Preciso de ajuda com o Menuzia.', '', `Loja: ${u.loja}`, `Usuário: ${u.nome}`, `Perfil: ${ROTULO[papel]}`, `Tela: ${tela}`, '', 'Dúvida:', DUVIDA].join('\n')
    ok('mensagem no formato combinado (loja, usuário, perfil, tela, dúvida)', texto === esperado, JSON.stringify(texto).slice(0, 160))
    ok('sem query, fragmento, token, e-mail ou id', !/SEGREDO|token|Joao|pedido-99|[?#]|@|[0-9a-f]{8}-[0-9a-f]{4}/i.test(texto.replace(DUVIDA, '').replace('Olá! Preciso de ajuda com o Menuzia.', '')))
    ok('URL sem espaço nem quebra de linha crua', !/[\s]/.test(url))
    if (papel === 'dono') urlExemplo = { url, texto }
    await p.context().close()
  }

  console.log('\n── nova aba bloqueada ──')
  {
    const p = await abrirComo('gerente.local', { bloquearAba: true })
    await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' }); await dispensar(p)
    await botao(p).click()
    await p.getByTestId('suporte-duvida').fill('Texto que não pode se perder')
    await p.getByTestId('suporte-enviar').click()
    ok('aviso com link direto para o WhatsApp', await p.getByTestId('suporte-bloqueado').isVisible()
      && (await p.getByTestId('suporte-bloqueado').locator('a').getAttribute('href'))?.startsWith(`https://wa.me/${NUMERO}?text=`))
    ok('o texto digitado é preservado', (await p.getByTestId('suporte-duvida').inputValue()) === 'Texto que não pode se perder')
    ok('o modal continua aberto', await dialogo(p).isVisible())
    await p.context().close()
  }

  console.log('\n── celular ──')
  for (const [w, h] of [[360, 800], [390, 844]]) {
    const p = await abrirComo('garcom.local', { w, h })
    await p.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' }); await dispensar(p)
    await botao(p).click()
    const m = await p.evaluate(() => {
      const d = document.querySelector('[role="dialog"]').getBoundingClientRect()
      const botoes = [...document.querySelectorAll('[role="dialog"] button')].map((b) => Math.round(b.getBoundingClientRect().height))
      return { dentro: d.left >= 0 && d.right <= window.innerWidth + 1 && d.top >= 0 && d.bottom <= window.innerHeight + 1, horizontal: document.documentElement.scrollWidth > window.innerWidth + 1, menorBotao: Math.min(...botoes) }
    })
    ok(`${w}px: modal inteiro na tela, sem rolagem lateral`, m.dentro && !m.horizontal)
    ok(`${w}px: botões com 40px+ de altura`, m.menorBotao >= 40, `${m.menorBotao}px`)
    if (w === 390) await foto(p, '02-modal-celular-390')
    await p.context().close()
  }

  ok('nenhuma requisição saiu para o WhatsApp', tentativasWhatsapp === 0, `${tentativasWhatsapp}`)

  if (SHOTS && urlExemplo) {
    // "Mensagem pronta": a URL e o texto que o WhatsApp receberia (nada foi aberto).
    const p = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage()
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    await p.setContent(`<body style="font:14px Inter,Arial;background:#EDEEF1;margin:16px"><h3 style="margin:0 0 8px">URL gerada (interceptada — nada foi enviado)</h3>
      <div style="background:#fff;border:1px solid #E5E7EB;padding:10px;word-break:break-all;font:12px monospace">${esc(urlExemplo.url)}</div>
      <h3 style="margin:14px 0 8px">Mensagem que o WhatsApp receberia</h3>
      <pre style="background:#DCFCE7;border:1px solid #16A34A33;padding:12px;font:14px Inter,Arial;white-space:pre-wrap;margin:0">${esc(urlExemplo.texto)}</pre></body>`)
    await p.screenshot({ path: join(SHOTS, '04-mensagem-pronta.png'), fullPage: true })
    writeFileSync(join(SHOTS, 'url-gerada.txt'), `${urlExemplo.url}\n\n${urlExemplo.texto}\n`)
    await p.context().close()
  }
} catch (e) {
  ok('execução', false, e.message.split('\n').slice(0, 8).join(' / '))
} finally {
  await browser.close(); await db.end()
}
const f = res.filter((x) => !x).length
console.log(`\n${res.length - f}/${res.length} passaram`)
process.exit(f ? 1 : 0)
