/**
 * E2E (2026-09-28): tela Integrações, fase 1 — interruptor do robô e pixels.
 * Loja ISOLADA local (E2E_LOJA), servidor local com provedor simulado:
 *   WHATSAPP_PROVEDOR=simulado WHATSAPP_SIMULADO_ARQUIVO=<arq> WHATSAPP_ROBO_LIBERADO=1
 * Nada chega a WhatsApp de verdade. Restaura pixels, instância e robô no fim.
 *
 *   E2E_LOJA=cantina-pdv2 E2E_VIZINHA=vizinha-pdv2 E2E_SUFIXO=pdv2 SHOTS=<pasta> \
 *     node scripts/seguranca/e2e-integracoes-fase1.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { E2E_LOJA, USU, exigirLojaIsolada } from './e2e-ambiente.mjs'

exigirLojaIsolada()
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('só servidor local')
const SHOTS = process.env.SHOTS ?? '.shots/integracoes-fase1'
mkdirSync(SHOTS, { recursive: true })
const SENHA = 'demo-local-123456'
const res = []
const ok = (nome, cond, info = '') => { res.push(!!cond); console.log(`   ${cond ? '✅' : '❌'} ${nome}${info ? ` — ${info}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const loja = await um('select id, facebook_pixel_id, google_tag_id, evolution_instance from restaurantes where slug=$1', [E2E_LOJA])
const L = loja.id
const roboAntes = await um('select robo_ativo from whatsapp_robo_config where restaurante_id=$1', [L])

const browser = await chromium.launch()
try {
  await db.query('update restaurantes set facebook_pixel_id=null, google_tag_id=null, evolution_instance=null where id=$1', [L])
  await db.query(`insert into whatsapp_robo_config (restaurante_id, robo_ativo) values ($1,false) on conflict (restaurante_id) do update set robo_ativo=false`, [L])

  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', USU.dono)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  const abrir = async () => {
    await p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
    await p.getByTestId('pixel-facebook').waitFor({ timeout: 15000 })
  }

  secao('1. Robô sem WhatsApp conectado')
  await abrir()
  await p.getByTestId('robo-dica').waitFor({ timeout: 15000 })
  ok('toggle desabilitado, "Conecte o WhatsApp para ativar" e atalho "Conectar"', await p.getByTestId('robo-alternar').isDisabled() && /Conecte o WhatsApp para ativar/.test(await p.getByTestId('robo-dica').innerText()) && await p.getByTestId('robo-ir-conectar').isVisible())
  ok('cartão do WhatsApp: "Desconectado" e "Nenhum número conectado"', /Desconectado/.test(await p.getByTestId('whatsapp-status').innerText()) && /Nenhum número/.test(await p.getByTestId('whatsapp-numero').innerText()))
  ok('lista "Conversas atendidas pelo robô hoje" e "Pausar robô" não existem mais', (await p.getByText('Conversas atendidas pelo robô').count()) === 0 && (await p.getByTestId('robo-pausar').count()) === 0)
  ok('indicadores 24h e "O que o robô responde" (fechado) continuam', await p.getByTestId('robo-24h').isVisible() && (await p.getByTestId('robo-o-que-responde').getAttribute('open')) === null)
  await p.screenshot({ path: join(SHOTS, 'fase1-sem-whatsapp.png'), fullPage: true })

  secao('2. Robô com WhatsApp conectado: otimista, aviso e volta atrás no erro')
  await db.query('update restaurantes set evolution_instance=$2 where id=$1', [L, `sim-${E2E_LOJA}`])
  await abrir()
  await p.getByTestId('whatsapp-status').filter({ hasText: 'Conectado' }).waitFor({ timeout: 15000 })
  ok('toggle habilitado com o WhatsApp conectado', !(await p.getByTestId('robo-alternar').isDisabled()))
  await p.getByTestId('robo-alternar').click()
  await p.getByTestId('toast').filter({ hasText: 'Robô ativado' }).waitFor({ timeout: 10000 })
  await espera(500)
  ok('ligar: "Robô ativado" e gravado no banco', (await um('select robo_ativo from whatsapp_robo_config where restaurante_id=$1', [L])).robo_ativo === true)
  await p.getByTestId('robo-alternar').click()
  await p.getByTestId('toast').filter({ hasText: 'Avisos de pedido continuam sendo enviados' }).waitFor({ timeout: 10000 })
  await espera(500)
  ok('desligar: "Robô desativado. Avisos de pedido continuam sendo enviados."', (await um('select robo_ativo from whatsapp_robo_config where restaurante_id=$1', [L])).robo_ativo === false)
  // Falha do servidor: o interruptor volta e aparece o erro.
  await p.route('**/api/admin/whatsapp/robo', (route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falha simulada.' }) }) : route.continue()))
  await p.getByTestId('robo-alternar').click()
  const otimista = await p.getByTestId('robo-estado').innerText()
  await p.getByTestId('toast').filter({ hasText: 'Falha simulada' }).waitFor({ timeout: 10000 })
  await espera(300)
  ok('erro: muda na hora e volta atrás com a mensagem de erro', (await p.getByTestId('robo-estado').innerText()) === 'Desativado' && (await um('select robo_ativo from whatsapp_robo_config where restaurante_id=$1', [L])).robo_ativo === false, `durante: ${otimista}`)
  await p.unroute('**/api/admin/whatsapp/robo')

  secao('3. Facebook Pixel')
  await abrir()
  const fb = p.getByTestId('pixel-facebook')
  ok('vazio: "Não configurado" e "Adicionar Pixel ID"', /Não configurado/.test(await p.getByTestId('pixel-facebook-status').innerText()) && await p.getByTestId('pixel-facebook-adicionar').isVisible())
  await p.getByTestId('pixel-facebook-adicionar').click()
  ok('editando: foco automático no campo', await p.getByTestId('pixel-facebook-campo').evaluate((e) => e === document.activeElement))
  await p.getByTestId('pixel-facebook-campo').fill('125265262')
  await p.getByTestId('pixel-facebook-salvar').click()
  ok('valida: "15 ou 16 dígitos" e não grava', /15 ou 16 dígitos/.test(await p.getByTestId('pixel-facebook-erro').innerText()) && (await um('select facebook_pixel_id v from restaurantes where id=$1', [L])).v === null)
  await p.getByTestId('pixel-facebook-campo').fill('1234 5678 9012 3456')
  await p.getByTestId('pixel-facebook-campo').press('Enter')
  await p.getByTestId('pixel-facebook-valor').waitFor({ timeout: 10000 })
  ok('Enter salva (sem espaços), toast e volta ao estado salvo', (await um('select facebook_pixel_id v from restaurantes where id=$1', [L])).v === '1234567890123456' && (await p.getByTestId('pixel-facebook-valor').innerText()) === '1234567890123456' && /Ativo/.test(await p.getByTestId('pixel-facebook-status').innerText()))
  await fb.screenshot({ path: join(SHOTS, 'fase1-pixel-salvo.png') })
  await p.getByTestId('pixel-facebook-editar').click()
  await p.getByTestId('pixel-facebook-campo').fill('999999999999999')
  await p.getByTestId('pixel-facebook-campo').press('Escape')
  ok('Esc cancela e mantém o valor', (await p.getByTestId('pixel-facebook-valor').innerText()) === '1234567890123456' && (await um('select facebook_pixel_id v from restaurantes where id=$1', [L])).v === '1234567890123456')
  await p.getByTestId('pixel-facebook-editar').click()
  await p.getByTestId('pixel-facebook-cancelar').click()
  ok('Cancelar também', (await p.getByTestId('pixel-facebook-valor').innerText()) === '1234567890123456')
  await p.reload({ waitUntil: 'networkidle' })
  await p.getByTestId('pixel-facebook-valor').waitFor({ timeout: 15000 })
  ok('recarregar a página mantém o valor', (await p.getByTestId('pixel-facebook-valor').innerText()) === '1234567890123456')
  // ID antigo inválido: não some; aparece o aviso para corrigir.
  await db.query(`update restaurantes set facebook_pixel_id='125265262' where id=$1`, [L])
  await abrir()
  await p.getByTestId('pixel-facebook-invalido').waitFor({ timeout: 15000 })
  ok('ID salvo inválido continua na tela com "ID parece inválido"', (await p.getByTestId('pixel-facebook-valor').innerText()) === '125265262')
  await p.getByTestId('pixel-facebook-editar').click()
  await p.getByTestId('pixel-facebook-remover').click()
  await p.getByTestId('pixel-facebook-remover-confirmar').click()
  await p.getByTestId('pixel-facebook-adicionar').waitFor({ timeout: 10000 })
  ok('Remover (com confirmação) desativa o pixel', (await um('select facebook_pixel_id v from restaurantes where id=$1', [L])).v === null)

  secao('4. Google Tag')
  await p.getByTestId('pixel-google-adicionar').click()
  await p.getByTestId('pixel-google-campo').fill('UA-12345-1')
  await p.getByTestId('pixel-google-salvar').click()
  ok('valida G-/GTM-', /G-XXXXXXXXXX/.test(await p.getByTestId('pixel-google-erro').innerText()))
  await p.getByTestId('pixel-google-campo').fill(' gtm-5k2xq7l ')
  await p.getByTestId('pixel-google-salvar').click()
  await p.getByTestId('pixel-google-valor').waitFor({ timeout: 10000 })
  ok('GTM em maiúsculas e sem espaços', (await um('select google_tag_id v from restaurantes where id=$1', [L])).v === 'GTM-5K2XQ7L')
  await p.getByTestId('pixel-google-editar').click()
  await p.getByTestId('pixel-google-campo').fill('g-abc123xyz9')
  await p.getByTestId('pixel-google-campo').press('Enter')
  await p.getByTestId('pixel-google-valor').filter({ hasText: 'G-ABC123XYZ9' }).waitFor({ timeout: 10000 })
  await p.reload({ waitUntil: 'networkidle' })
  await p.getByTestId('pixel-google-valor').waitFor({ timeout: 15000 })
  ok('editar GA4 e recarregar mantém', (await p.getByTestId('pixel-google-valor').innerText()) === 'G-ABC123XYZ9')
  await p.getByTestId('pixel-facebook-adicionar').click()
  await p.getByTestId('pixel-facebook-campo').fill('125265262125265')
  await p.getByTestId('pixel-facebook-campo').press('Enter')
  await p.getByTestId('pixel-facebook-valor').waitFor({ timeout: 10000 })
  await p.screenshot({ path: join(SHOTS, 'fase1-integracoes-1366.png'), fullPage: true })

  secao('5. Celular')
  await p.setViewportSize({ width: 390, height: 844 })
  await abrir()
  const semCorte = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('[data-testid=pagina-integracoes] *')].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || r.right <= window.innerWidth + 1 }))
  ok('390px: uma coluna, nada cortado nem rolagem horizontal', semCorte)
  await p.screenshot({ path: join(SHOTS, 'fase1-integracoes-390.png'), fullPage: true })
  await ctx.close()
} catch (e) {
  ok(`execução sem exceção: ${e.message}`, false)
} finally {
  await browser.close()
  await db.query('update restaurantes set facebook_pixel_id=$2, google_tag_id=$3, evolution_instance=$4 where id=$1', [L, loja.facebook_pixel_id, loja.google_tag_id, loja.evolution_instance])
  await db.query('update whatsapp_robo_config set robo_ativo=$2 where restaurante_id=$1', [L, roboAntes?.robo_ativo === true])
  await db.end()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram — capturas em ${SHOTS}`)
process.exit(passou === res.length ? 0 : 1)
