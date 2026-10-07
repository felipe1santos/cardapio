/**
 * Ajustes repaginado (2026-10-06): os campos do Perfil da loja — inclusive a Aparência, que saiu do
 * submenu e entrou no Perfil — continuam salvando num clique só. Loja local dash54-loja; tudo volta ao
 * que era no fim.  node scripts/revisao-ajustes/e2e-ajustes-salvar.mjs
 */
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais(); exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const CAMPOS = 'nome, telefone, instagram_url, avaliacao_nota, avaliacao_qtd, banner_promo_texto, aviso_cor_texto, aviso_cor_fundo, aviso_pulsar, layout_cardapio, vitrine_imagem_tamanho, vitrine_fonte, cor_tema, horario_funcionamento, vitrine_nova'
const loja = (await db.query(`select id, ${CAMPOS} from restaurantes where slug='dash54-loja'`)).rows[0]
let falhas = 0
const ok = (m, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${m}${c ? "" : " — " + d}`); if (!c) falhas++ }

const browser = await chromium.launch()
try {
  await db.query(`update restaurantes set vitrine_nova=true where id=$1`, [loja.id])
  const p = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.dash54'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login')), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 1500 }).catch(() => {})

  const nav = p.locator('nav[aria-label="Seções dos ajustes"]')
  const itens = (await nav.locator('button').allInnerTexts()).map((t) => t.trim())
  ok('submenu sem "Aparência" e com ícones', !itens.includes('Aparência') && (await nav.locator('button svg').count()) === itens.length, JSON.stringify(itens))
  const ordem = await p.locator('[data-testid^="secao-"]:visible').evaluateAll((els) => els.map((e) => e.dataset.testid))
  ok('ordem do Perfil: dados, logo, capa, promo, endereço, horário, aparência, prova', ordem.join(',') === 'secao-dados,secao-logo,secao-capa,secao-promo,secao-endereco,secao-horario,secao-aparencia,secao-prova', ordem.join(','))

  await p.getByLabel('Telefone / WhatsApp').fill('27911112222').catch(async () => { await p.locator('[data-testid="secao-dados"] input').nth(1).fill('27911112222') })
  await p.getByTestId('loja-instagram').fill('@lojateste')
  await p.locator('[data-testid="secao-prova"] input').nth(0).fill('4.7')
  await p.locator('[data-testid="secao-prova"] input').nth(1).fill('321')
  await p.getByTestId('aviso-texto').fill('Aviso de teste')
  await p.getByTestId('aviso-cor-texto-hex').fill('#0369A1')
  await p.getByTestId('aviso-cor-fundo-hex').fill('#E0F2FE')
  await p.getByTestId('formato-lista').click()
  await p.getByTestId('imagem-tamanho-90').click()
  await p.getByTestId('fonte-ifood').click()
  await p.getByTestId('paleta-laranja').click()
  // domingo: liga o dia (um turno padrão)
  const domingo = p.locator('[data-testid="secao-horario"] label', { hasText: 'Domingo' }).locator('input[type="checkbox"]')
  const domingoAntes = await domingo.isChecked()
  await domingo.setChecked(!domingoAntes)
  await p.getByRole('button', { name: /salvar altera/i }).first().click()
  await p.waitForTimeout(2000)
  const r = (await db.query(`select ${CAMPOS} from restaurantes where id=$1`, [loja.id])).rows[0]
  ok('telefone e Instagram salvos', r.telefone === '27911112222' && /lojateste/.test(r.instagram_url ?? ''), `${r.telefone} ${r.instagram_url}`)
  ok('prova social salva', Number(r.avaliacao_nota) === 4.7 && r.avaliacao_qtd === 321)
  ok('aviso e cores salvos', r.banner_promo_texto === 'Aviso de teste' && r.aviso_cor_texto === '#0369A1' && r.aviso_cor_fundo === '#E0F2FE', JSON.stringify([r.banner_promo_texto, r.aviso_cor_texto, r.aviso_cor_fundo]))
  ok('formato, tamanho e fonte salvos', r.layout_cardapio === 'lista' && r.vitrine_imagem_tamanho === 90 && r.vitrine_fonte === 'ifood')
  ok('cor da loja (antiga aba Aparência) salva junto', r.cor_tema === 'laranja', r.cor_tema)
  ok('horário salvo', (r.horario_funcionamento?.['0'] ? true : false) === !domingoAntes, JSON.stringify(r.horario_funcionamento?.['0']))

  // "Usar a cor da loja" volta as cores do aviso a nulo
  await p.getByTestId('aviso-padrao').click()
  await p.getByRole('button', { name: /salvar altera/i }).first().click(); await p.waitForTimeout(2000)
  const r2 = (await db.query(`select aviso_cor_texto, aviso_cor_fundo from restaurantes where id=$1`, [loja.id])).rows[0]
  ok('"Usar a cor da loja" zera as cores do aviso', r2.aviso_cor_texto === null && r2.aviso_cor_fundo === null)

  // link antigo da Aparência abre o Perfil
  await p.goto(`${BASE}/admin/ajustes?aba=aparencia`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  ok('?aba=aparencia abre o Perfil com a Aparência à vista', await p.getByTestId('secao-aparencia').isVisible())
  // celular: submenu no topo, sem rolagem lateral da página
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500)
  ok('celular: sem rolagem lateral', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
} finally {
  const cols = CAMPOS.split(', ')
  await db.query(`update restaurantes set ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} where id=$1`, [loja.id, ...cols.map((c) => (c === 'horario_funcionamento' && loja[c] ? JSON.stringify(loja[c]) : loja[c]))])
  await browser.close(); await db.end()
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
  process.exitCode = falhas ? 1 : 0
}
