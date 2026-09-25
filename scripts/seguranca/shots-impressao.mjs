/**
 * Página Impressão e janelas (ajuda, calibração, troca de modo) nas larguras de
 * celular, tablet e computador: sem rolagem horizontal e com tudo visível. Loja de
 * demonstração local, com um computador Beta simulado por HTTP. Nada imprime.
 *
 *   SHOTS=<pasta> node scripts/seguranca/shots-impressao.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'menuzia-shots-impressao')
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
mkdirSync(SHOTS, { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) {
  await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
}
await db.query(`update restaurantes set impressao_beta_liberado=true, impressao_beta_modo='caixa', impressao_cozinha_por_funcao=false where id=$1`, [loja])

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', 'dono.local')
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  const api = (url, metodo = 'GET', corpo) => page.evaluate(async ({ url, metodo, corpo }) => {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) }
  }, { url: `${BASE}${url}`, metodo, corpo })

  // Um computador Beta com duas impressoras e diagnóstico.
  const codigo = (await api('/api/admin/impressao/pareamento', 'POST')).json.codigo
  const par = await fetch(`${BASE}/api/agente/parear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo, nome: 'PC Caixa', versao: '0.2.0-beta.1' }) }).then((r) => r.json())
  await fetch(`${BASE}/api/agente/impressoras`, {
    method: 'POST', headers: { Authorization: `Bearer ${par.credencial}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ impressoras: ['POS-8370', 'Cozinha Térmica 80mm Com Nome Bem Comprido'], diagnosticos: { 'POS-8370': { driver: 'POS-80C', porta: 'USB001', dpiX: 203, dpiY: 203, papelLarguraMm: 80, areaImprimivelLarguraMm: 64, margemEsquerdaMm: 0, margemDireitaMm: 16, pontosImprimiveis: 512 } } }),
  })
  const painel = (await api('/api/admin/impressao/painel')).json
  const pos = painel.dispositivos.find((d) => d.nomeSistema === 'POS-8370')
  await api('/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: pos.id })
  await api(`/api/admin/impressao/dispositivos/${pos.id}`, 'PATCH', { larguraPontos: 512 })

  // Rolagem da página E nenhum elemento visível passando da borda (contêiner interno corta sem rolar).
  const semRolagem = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 &&
    [...document.querySelectorAll('[data-testid=painel-impressao] *')].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || r.right <= window.innerWidth + 1 }))
  for (const [w, h] of [[360, 780], [390, 844], [412, 915], [768, 1024], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 3000 }).catch(() => {})
    await page.getByTestId('modo-beta').waitFor({ timeout: 15000 })
    const fora = await page.evaluate(() => [...document.querySelectorAll('[data-testid=painel-impressao] *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 }).slice(0, 3).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)} [${(e.textContent ?? '').slice(0, 30)}] right=${Math.round(e.getBoundingClientRect().right)}`).join(' | '))
    ok(`${w}px: página sem rolagem horizontal`, await semRolagem(), fora)
    await page.screenshot({ path: join(SHOTS, `impressao-${w}.png`), fullPage: true })
    await page.getByTestId('ajuda-impressao').click()
    const modal = page.getByTestId('modal-ajuda-impressao')
    const caixa = await modal.boundingBox()
    ok(`${w}px: ajuda cabe na tela`, !!caixa && caixa.x >= 0 && caixa.x + caixa.width <= w + 1 && (await semRolagem()))
    await page.screenshot({ path: join(SHOTS, `ajuda-${w}.png`) })
    await page.keyboard.press('Escape')
    await page.getByTestId('calibrar-POS-8370').click()
    const cal = await page.getByTestId('calibracao').locator('> div').boundingBox()
    ok(`${w}px: calibração cabe na tela`, !!cal && cal.x >= 0 && cal.x + cal.width <= w + 1)
    await page.screenshot({ path: join(SHOTS, `calibracao-${w}.png`) })
    await page.getByRole('button', { name: 'Fechar' }).last().click()
    await page.getByTestId('modo-cozinha_caixa').click()
    ok(`${w}px: troca para "Cozinha e Caixa" pede confirmação explícita`, await page.getByTestId('confirmar-modo-ok').isDisabled())
    await page.screenshot({ path: join(SHOTS, `modo-${w}.png`) })
    await page.getByRole('button', { name: 'Cancelar' }).click()
  }
  ok('texto antigo removido ("roteamento por função", "nunca há troca automática")', !/roteamento por função|Nunca há troca automática/i.test(await page.content()))
  ok('Recibo/Extrato na tela, com a explicação', (await page.content()).includes('Documento não fiscal usado para o cliente conferir a conta antes ou depois do pagamento.'))
  await page.goto(`${BASE}/admin/ajustes?aba=impressao`)
  await page.waitForURL((u) => u.pathname === '/admin/impressao', { timeout: 15000 }).catch(() => {})
  ok('link antigo Ajustes › Impressão leva para /admin/impressao', new URL(page.url()).pathname === '/admin/impressao')
  await page.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  ok('Ajustes não tem mais a seção Impressão', !(await page.getByRole('button', { name: 'Impressão', exact: true }).count()) || (await page.locator('nav[aria-label="Seções dos ajustes"] >> text=Impressão').count()) === 0)
} finally {
  for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes']) await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
  await db.query(`update restaurantes set impressao_beta_liberado=false, impressao_beta_modo='teste', impressao_cozinha_por_funcao=false where id=$1`, [loja])
  await browser.close()
  await db.end()
}
const falhas = res.filter((r) => !r).length
console.log(`\nCapturas: ${SHOTS}\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
