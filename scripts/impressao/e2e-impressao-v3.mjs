/**
 * E2E LOCAL da impressão v3 (2026-10-05). Servidor e banco locais; nunca produção.
 *
 *   node scripts/impressao/e2e-impressao-v3.mjs
 *
 * Confere, como dono da cantina-demo:
 *   · /admin/impressao: prévia com as abas Comanda / Pré-conta / Via da cozinha, os tipos
 *     (entrega, retirada, mesa, balcão; pré-conta só mesa e balcão), canvas em 1 bit na
 *     largura da impressora, a opção "via da cozinha" (liga e desliga, grava no banco);
 *   · aviso "Novo sistema de impressão": aparece com o Assistente antigo / beta.8 e some
 *     com um computador no beta.9; não aparece para quem não imprime.
 * Prints em docs/impressao-final/comparacao/painel/.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { USU } from '../seguranca/e2e-ambiente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE) || !/@(127\.0\.0\.1|localhost):/.test(DB)) throw new Error('só servidor e banco locais')
const SHOTS = 'docs/impressao-final/comparacao/painel'
mkdirSync(SHOTS, { recursive: true })
const SENHA = 'demo-local-123456'
let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

const db = new pg.Client(DB)
await db.connect()
const { rows: [loja] } = await db.query("select id, impressao_ativar_assistente, impressao_via_cozinha from restaurantes where slug = 'cantina-demo'")
const AGENTE_TESTE = 'E2E v3 (beta.9)'
const limparAgente = () => db.query('delete from impressao_agentes where restaurante_id = $1 and nome = $2', [loja.id, AGENTE_TESTE])
await limparAgente()
const { rows: [atual] } = await db.query("select count(*)::int n from impressao_agentes where restaurante_id = $1 and revogado_em is null and versao >= '0.2.0-beta.9'", [loja.id])

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 3200 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', USU.dono)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])

  console.log('── Prévia na página Impressão ──')
  await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  const previa = p.getByTestId('cartao-previa')
  await previa.waitFor({ timeout: 20000 })
  for (const aba of ['cozinha', 'pre_conta', 'via_cozinha']) ok(`aba ${aba}`, (await p.getByTestId(`previa-${aba}`).count()) === 1)
  const canvasOk = async () => p.getByTestId('previa-canvas').evaluate((c) => {
    const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let cinza = 0, preto = 0
    for (let i = 0; i < x.length; i += 4) { if (x[i] !== 0 && x[i] !== 255) cinza++; if (x[i] === 0) preto++ }
    return { w: c.width, h: c.height, cinza, preto }
  })
  for (const tipo of ['entrega', 'retirada', 'mesa', 'balcao']) {
    await p.getByTestId('previa-cozinha').click()
    await p.getByTestId(`previa-tipo-${tipo}`).click()
    await p.waitForTimeout(400)
    const c = await canvasOk()
    ok(`comanda ${tipo}: canvas ${c.w}×${c.h} em 1 bit`, (c.w === 576 || c.w === 384 || c.w === 512) && c.h > 600 && c.cinza === 0 && c.preto > 1000)
    await previa.screenshot({ path: join(SHOTS, `previa-comanda-${tipo}.png`) })
  }
  await p.getByTestId('previa-pre_conta').click()
  ok('pré-conta: só mesa e balcão', (await p.getByTestId('previa-tipo-entrega').count()) === 0 && (await p.getByTestId('previa-tipo-mesa').count()) === 1 && (await p.getByTestId('previa-tipo-balcao').count()) === 1)
  for (const tipo of ['mesa', 'balcao']) {
    await p.getByTestId(`previa-tipo-${tipo}`).click()
    await p.waitForTimeout(400)
    const c = await canvasOk()
    ok(`pré-conta ${tipo}: canvas em 1 bit`, c.h > 600 && c.cinza === 0)
    await previa.screenshot({ path: join(SHOTS, `previa-pre-conta-${tipo}.png`) })
  }
  await p.getByTestId('previa-via_cozinha').click()
  await p.getByTestId('previa-tipo-entrega').click()
  await p.waitForTimeout(400)
  ok('via da cozinha: aviso de desligada por padrão', /Desligada/.test(await p.getByTestId('previa-via-cozinha-aviso').innerText()))
  await previa.screenshot({ path: join(SHOTS, 'previa-via-cozinha.png') })
  ok('"Mostrar preço dos complementos" fora da prévia do v3', (await p.getByTestId('opcao-mostrarPrecoComplementos').count()) === 0)
  const chave = p.getByTestId('opcao-viaCozinha')
  ok('opção da via da cozinha aparece', (await chave.count()) === 1)
  await chave.click()
  await p.waitForTimeout(1200)
  const ligado = (await db.query('select impressao_via_cozinha v from restaurantes where id = $1', [loja.id])).rows[0].v
  ok('ligar a via da cozinha grava no banco', ligado === true)
  ok('aviso passa a "Ligada"', /Ligada/.test(await p.getByTestId('previa-via-cozinha-aviso').innerText()))
  await chave.click()
  await p.waitForTimeout(1200)
  ok('desligar volta ao padrão', (await db.query('select impressao_via_cozinha v from restaurantes where id = $1', [loja.id])).rows[0].v === false)

  console.log('── Aviso "Novo sistema de impressão" por versão ──')
  const aviso = async () => { await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200); return (await p.getByTestId('aviso-nova-impressao').count()) === 1 }
  await db.query('update restaurantes set impressao_ativar_assistente = true where id = $1', [loja.id])
  if (atual.n === 0) {
    ok('loja que imprime sem o beta.9: aviso aparece', await aviso())
    await p.screenshot({ path: join(SHOTS, 'aviso-versao-antiga.png') })
    ok('aviso não aparece na própria Impressão', await (async () => { await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800); return (await p.getByTestId('aviso-nova-impressao').count()) === 0 })())
  } else ok('(a loja já tinha um computador no beta.9; caso "antigo" pulado)', true)
  await db.query("insert into impressao_agentes (restaurante_id, nome, versao, credencial_hash) values ($1, $2, '0.2.0-beta.9', encode(sha256(gen_random_uuid()::text::bytea), 'hex'))", [loja.id, AGENTE_TESTE])
  ok('com um computador no beta.9: aviso some', !(await aviso()))
  await limparAgente()
  await db.query('update restaurantes set impressao_ativar_assistente = false where id = $1', [loja.id])
  ok('loja que não imprime: sem aviso', !(await aviso()))
} finally {
  await limparAgente().catch(() => {})
  await db.query('update restaurantes set impressao_ativar_assistente = $2, impressao_via_cozinha = $3 where id = $1', [loja.id, loja.impressao_ativar_assistente, loja.impressao_via_cozinha]).catch(() => {})
  await db.end()
  await browser.close()
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
