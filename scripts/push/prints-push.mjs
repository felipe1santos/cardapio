/**
 * Prints das notificações push (2026-10-01): painel (Campanhas › Notificações do app), prévia,
 * convite depois do pedido (Android e iPhone sem app instalado) e Perfil › Notificações.
 * Stack local, loja ordem-qr-e2e. Liga a flag só durante o script e apaga o que cria.
 *
 *   node scripts/push/prints-push.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'
import { LOJA, SENHA, USUARIOS } from '../seguranca/semear-cardapio-ordem.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const DIR = 'docs/push/prints'
mkdirSync(DIR, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const loja = (await db.query(`select id, push_liberado from restaurantes where slug=$1`, [LOJA])).rows[0]
const TEL = '27999877099'
const limpar = async () => {
  for (const t of ['push_envios', 'push_avulsas', 'push_assinaturas', 'push_automacoes', 'push_config']) await db.query(`delete from ${t} where restaurante_id=$1`, [loja.id])
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])
}
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
try {
  await limpar()
  await db.query(`update restaurantes set push_liberado=true where id=$1`, [loja.id])
  for (const [plat, inst] of [['android', true], ['android', false], ['ios', true], ['desktop', false]]) {
    await db.query(`insert into push_assinaturas (restaurante_id, endpoint, p256dh, auth, plataforma, instalado) values ($1,$2,'p','a',$3,$4)`, [loja.id, `https://push.teste.local/print/${randomUUID()}`, plat, inst])
  }

  // ── painel ─────────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', USUARIOS.dono)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin')), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/campanhas?aba=notificacoes`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: /ok, entendi/i }).click({ timeout: 2000 }).catch(() => {})
  await p.locator('[data-push-painel]').waitFor()
  await p.screenshot({ path: join(DIR, 'painel-1-resumo-automacoes.png') })
  await p.locator('[data-push-editar="cupom_novo"]').click()
  await p.locator('[data-push-previa]').first().scrollIntoViewIfNeeded()
  await p.waitForTimeout(600)
  await p.screenshot({ path: join(DIR, 'painel-2-previa-cupom.png') })
  await p.locator('[data-avulsa-texto]').fill('Hoje tem pizza grande com 20% de desconto, {nome}!')
  await p.locator('[data-push-avulsa-form]').scrollIntoViewIfNeeded()
  await p.waitForTimeout(800)
  await p.screenshot({ path: join(DIR, 'painel-3-avulsa.png') })
  await p.locator('[data-push-limites]').scrollIntoViewIfNeeded()
  await p.screenshot({ path: join(DIR, 'painel-4-limites.png') })
  await p.setViewportSize({ width: 390, height: 844 })
  await p.goto(`${BASE}/admin/campanhas?aba=notificacoes`, { waitUntil: 'networkidle' })
  await p.locator('[data-push-painel]').waitFor()
  await p.screenshot({ path: join(DIR, 'painel-5-celular.png') })
  await ctx.close()

  // ── vitrine: pedido → convite (Android) ───────────────────────────────
  const pedir = async (contexto, nome) => {
    const v = await contexto.newPage()
    await v.goto(`${BASE}/loja/${LOJA}`, { waitUntil: 'networkidle' })
    await v.evaluate(() => localStorage.clear())
    await v.reload({ waitUntil: 'networkidle' })
    await v.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().click()
    await v.getByRole('button', { name: /Adicionar/ }).last().click()
    await v.waitForTimeout(500)
    await v.getByText('Ver sacola').first().click()
    await v.getByRole('button', { name: /^Retirada/ }).first().click().catch(() => {})
    await v.getByRole('button', { name: /Continuar para pagamento/ }).last().click()
    const tel = v.getByPlaceholder('(00) 00000-0000').first()
    await tel.waitFor({ timeout: 8000 })
    await tel.fill(TEL)
    await v.locator('div').filter({ has: v.getByText('Informe seu telefone') }).last().getByRole('button', { name: /^Continuar$/i }).click()
    await v.waitForTimeout(1200)
    await v.getByText('Pix', { exact: true }).first().click()
    await v.getByRole('button', { name: /Ir para endereço|Continuar/ }).last().click()
    await v.waitForTimeout(600)
    await v.getByPlaceholder('Seu nome').fill('TESTE Push')
    await v.getByRole('button', { name: /Revisar pedido/ }).click()
    await v.getByRole('button', { name: /Fazer pedido/ }).click()
    await v.locator('[data-push-convite]').waitFor({ timeout: 15000 })
    await v.waitForTimeout(500)
    await v.screenshot({ path: join(DIR, nome) })
    return v
  }
  const android = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' })
  const va = await pedir(android, 'vitrine-1-convite-pos-pedido-android.png')
  // Perfil › Notificações
  await va.locator('[data-push-agora-nao]').click()
  await va.keyboard.press('Escape')
  await va.mouse.click(10, 10)
  await va.getByRole('button', { name: /^Entrar$|^Perfil$/ }).last().click()
  await va.locator('[data-push-perfil]').waitFor()
  await va.locator('[data-push-perfil]').scrollIntoViewIfNeeded()
  await va.waitForTimeout(500)
  await va.screenshot({ path: join(DIR, 'vitrine-2-perfil-notificacoes.png') })
  await android.close()
  // iPhone sem o app instalado: convite ensina a instalar
  const iphone = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR' })
  await pedir(iphone, 'vitrine-3-convite-iphone-instalar.png')
  await iphone.close()
  console.log('prints em', DIR)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await limpar()
  await db.query(`update restaurantes set push_liberado=$2 where id=$1`, [loja.id, loja.push_liberado])
  await browser.close()
  await db.end()
}
