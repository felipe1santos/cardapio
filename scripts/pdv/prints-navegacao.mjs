/**
 * Prints das telas do PDV/Mesas (2026-10-01), para comparar antes × depois da navegação em
 * pilha. Stack local, cantina-e2e (PDV v2 ligado só durante o script), dono.e2e.
 *
 *   node scripts/pdv/prints-navegacao.mjs <antes|depois> [largura] [altura]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

/** Balcão (0135): forma de pagamento antes de lançar — "Dinheiro, sem troco", o que o sistema gravava antes. */
async function escolherPagamentoPdv(p) {
  await p.waitForTimeout(500)
  const bloco = p.getByTestId('pdv-pagamento')
  if (!(await bloco.isVisible().catch(() => false))) return
  await p.getByTestId('pdv-pag-dinheiro').click()
  await p.getByTestId('pdv-troco-nao').click()
}

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const FASE = process.argv[2] ?? 'antes'
const W = Number(process.argv[3] ?? 1280), H = Number(process.argv[4] ?? 800)
const DIR = join('docs/pdv-navegacao/prints', FASE)
mkdirSync(DIR, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const loja = (await db.query(`select id, pdv_v2 from restaurantes where slug='cantina-e2e'`)).rows[0]
await db.query(`update restaurantes set pdv_v2=true where id=$1`, [loja.id])
const browser = await chromium.launch()
const foto = (p, nome) => p.screenshot({ path: join(DIR, `${W}x${H}-${nome}.png`) })
const fechar = async (p) => {
  await p.keyboard.press('Escape').catch(() => {})
  await p.waitForTimeout(250)
  // Depois: o Esc volta UMA tela da pilha; clicar em Voltar de novo fecharia a conta.
  if (FASE === 'depois') return void (await p.waitForTimeout(300))
  const b = p.locator('[aria-label="Voltar"]:visible, [aria-label="Fechar"]:visible')
  if (await b.count()) await b.last().click().catch(() => {})
  await p.waitForTimeout(400)
}
try {
  // Celular: o lançamento do PDV no celular é outra tela; vai até a conta no desktop e
  // troca para o tamanho do celular a partir dela (as telas da pilha são responsivas).
  const celular = W < 640
  const ctx = await browser.newContext({ viewport: celular ? { width: 1280, height: 800 } : { width: W, height: H }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.e2e')
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin')), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: /ok, entendi/i }).click({ timeout: 2500 }).catch(() => {})
  await p.getByTestId('card-balcao').click()
  await p.getByTestId('balcao-novo').waitFor()
  if (!celular) await foto(p, '01-balcao-central')
  await p.getByTestId('balcao-novo').click()
  await p.getByTestId('balcao-modalidade-retirada').click()
  await p.getByTestId('balcao-nome').fill('TESTE Navegação')
  if (!celular) await foto(p, '02-balcao-novo-pedido')
  await p.getByTestId('balcao-abrir').click()
  await p.getByTestId('pdv-lancar').waitFor()
  await p.getByRole('button', { name: /Água com Gás/ }).first().click()
  if (!celular) await foto(p, '03-lancar-itens')
  await escolherPagamentoPdv(p); await p.getByTestId('pdv-lancar').click()
  await p.waitForTimeout(1500)
  await p.getByTestId('pdv-ver-conta').click()
  await p.getByTestId('conta-titulo').waitFor()
  if (celular) await p.setViewportSize({ width: W, height: H })
  await p.waitForTimeout(600)
  await foto(p, '04-conta')
  for (const [testid, nome] of [['conta-receber', '05-receber'], ['conta-pendencias', '06-pendencias'], ['conta-adicionar-taxa', '07-taxas'], ['conta-ajustar', '08-desconto'], ['conta-identificar', '09-cliente'], ['conta-historico', '10-historico']]) {
    const b = p.getByTestId(testid)
    if (!(await b.count())) continue
    await b.first().click()
    await p.waitForTimeout(700)
    await foto(p, nome)
    await fechar(p)
  }
  await p.getByTestId('conta-fechar').click()
  await p.getByTestId('fechar-modal').waitFor({ timeout: 15000 })
  await p.waitForTimeout(1200)
  await foto(p, '11-fechar-conta')
  await ctx.close()
} catch (e) {
  console.error(e)
} finally {
  const c = (await db.query(`select id from comandas where restaurante_id=$1 and cliente_nome='TESTE Navegação' and status='aberta'`, [loja.id])).rows
  for (const x of c) await db.query(`update comandas set status='cancelada', cancelada_em=now(), cancelamento_motivo='TESTE' where id=$1`, [x.id]).catch(() => {})
  await db.query(`update restaurantes set pdv_v2=$2 where id=$1`, [loja.id, loja.pdv_v2])
  await browser.close(); await db.end()
}
console.log('prints em', DIR)
