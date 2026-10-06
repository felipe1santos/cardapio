/**
 * E2E — Pixel do Meta / Google tag e API de Conversões na vitrine (2026-10-03).
 * Loja local `ordem-qr-e2e` (Coca Lata). Nada sai para o Meta/Google: os domínios são bloqueados
 * no navegador e o `fbq` é um gravador; a API de Conversões vai para um receptor falso local
 * (o servidor precisa de META_CAPI_BASE=http://127.0.0.1:4999).
 *
 * Perfis: Chrome Android, Safari iOS, navegador interno do Instagram (iOS) e do Facebook (Android),
 * todos vindo do anúncio (?fbclid=…&utm_source=ig). Cada evento padrão uma vez só, com BRL e valor;
 * Purchase com event_id = o do servidor; navegador gravado no rastreio; robô fora; pixel inválido
 * não é injetado.
 *
 *   node scripts/seguranca/e2e-pixel-conversao.mjs [pasta-de-prints]
 */
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const PIXEL = '1234567890123456'
const TAG = 'G-TESTE12345'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const loja = await um(`select id, aceita_entrega, aceita_retirada, facebook_pixel_id, google_tag_id from restaurantes where slug=$1`, [SLUG])
const TEL = '27999880033'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const texto = (v) => JSON.stringify(v)

// Receptor falso da API de Conversões.
const capi = []
const receptor = createServer((req, resp) => {
  let corpo = ''
  req.on('data', (c) => { corpo += c })
  req.on('end', () => { try { capi.push({ url: req.url, corpo: JSON.parse(corpo) }) } catch { capi.push({ url: req.url, corpo }) } resp.writeHead(200, { 'Content-Type': 'application/json' }); resp.end('{"events_received":1}') })
}).listen(4999, '127.0.0.1')

const UA_IG = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 341.0.0.36.98 (iPhone14,5; iOS 17_5; pt_BR; pt-BR; scale=3.00; 1170x2532; 615116212)'
const UA_FB = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/484.0.0.53.104;]'
const PERFIS = [
  { id: 'chrome-android', nome: 'Chrome Android', opcoes: { ...devices['Pixel 7'] }, nav: 'chrome' },
  { id: 'safari-ios', nome: 'Safari iOS', opcoes: { ...devices['iPhone 13'] }, nav: 'safari' },
  { id: 'instagram-ios', nome: 'Navegador do Instagram (iOS)', opcoes: { ...devices['iPhone 13'], userAgent: UA_IG }, nav: 'instagram' },
  { id: 'facebook-android', nome: 'Navegador do Facebook (Android)', opcoes: { ...devices['Pixel 7'], userAgent: UA_FB }, nav: 'facebook' },
]

const GRAVADOR = () => {
  window.__fb = []
  window.fbq = function () { window.__fb.push(JSON.parse(JSON.stringify([...arguments]))) }
}
const eventosFb = (p) => p.evaluate(() => window.__fb ?? [])
const eventosGa = (p) => p.evaluate(() => (window.dataLayer ?? []).map((a) => JSON.parse(JSON.stringify(Array.from(a ?? [])))).filter((a) => a[0] === 'event'))
const conta = (lista, nome) => lista.filter((e) => e[0] === 'track' && e[1] === nome)

const browser = await chromium.launch()
const criados = []
const inicio = new Date()
try {
  await db.query(`update restaurantes set aceita_entrega=true, aceita_retirada=true, facebook_pixel_id=$2, google_tag_id=$3 where id=$1`, [loja.id, PIXEL, TAG])
  await db.query(`insert into integracoes_segredos (restaurante_id, meta_capi_token, meta_test_event_code, atualizado_por_nome) values ($1, 'TESTEtokenCapiLocal0123456789', 'TEST123', 'e2e')
    on conflict (restaurante_id) do update set meta_capi_token=excluded.meta_capi_token, meta_test_event_code=excluded.meta_test_event_code`, [loja.id])
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])

  for (const perfil of PERFIS) {
    console.log(`\n── ${perfil.nome} ──`)
    const ctx = await browser.newContext({ ...perfil.opcoes, locale: 'pt-BR' })
    await ctx.route(/facebook\.net|facebook\.com|googletagmanager\.com|google-analytics\.com/, (r) => r.abort())
    await ctx.addInitScript(GRAVADOR)
    const p = await ctx.newPage()
    try {
      await p.goto(`${BASE}/loja/${SLUG}?fbclid=TESTEfbclid${perfil.id.replace(/-/g, '')}&utm_source=ig`, { waitUntil: 'networkidle' })
      await p.evaluate(() => localStorage.clear())
      await p.reload({ waitUntil: 'networkidle' })
      await p.waitForTimeout(800)
      let fb = await eventosFb(p)
      ok('PageView uma vez, com init do pixel da loja', conta(fb, 'PageView').length === 1 && fb.some((e) => e[0] === 'init' && e[1] === PIXEL), texto(fb.map((e) => e.slice(0, 2))))
      if (perfil.id === 'chrome-android') {
        // Voltar à aba depois de 30 s recarrega a loja: antes isso mandava outro PageView.
        await p.waitForTimeout(31_000)
        await p.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
        await p.waitForTimeout(2500)
        ok('voltar à aba não repete o PageView', conta(await eventosFb(p), 'PageView').length === 1)
      }
      await p.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().tap()
      await p.waitForTimeout(400)
      fb = await eventosFb(p)
      const vc = conta(fb, 'ViewContent')
      ok('ViewContent ao abrir o produto (BRL, valor, content_ids)', vc.length === 1 && vc[0][2].currency === 'BRL' && vc[0][2].value > 0 && vc[0][2].content_ids?.length === 1 && !!vc[0][3]?.eventID, texto(vc))
      await p.getByRole('button', { name: /Adicionar/ }).last().tap()
      await p.waitForTimeout(600)
      fb = await eventosFb(p)
      const atc = conta(fb, 'AddToCart')
      ok('AddToCart uma vez (quantidade e valor)', atc.length === 1 && atc[0][2].num_items === 1 && atc[0][2].value > 0 && atc[0][2].currency === 'BRL', texto(atc))
      await p.getByText('Ver sacola').first().tap()
      // Fluxo da pendência 9: sacola → Entrega (retirada) → Pagamento → "Revise o seu pedido".
      await p.locator('[data-testid="barra-sacola-continuar"] button').tap()
      const tel = p.locator('[data-testid="janela-conta"]').getByPlaceholder('(00) 00000-0000')
      await tel.waitFor({ timeout: 8000 })
      await tel.fill(TEL)
      await p.locator('[data-testid="janela-conta"] button').filter({ hasText: /^Continuar$/i }).tap()
      await p.waitForTimeout(1200)
      fb = await eventosFb(p)
      const ic = conta(fb, 'InitiateCheckout')
      ok('InitiateCheckout uma vez ao abrir o checkout', ic.length === 1 && ic[0][2].value > 0 && ic[0][2].currency === 'BRL', texto(ic))
      await p.getByTestId('opcao-retirada').tap().catch(() => {})
      await p.getByPlaceholder('Seu nome').fill('TESTE Pixel')
      await p.locator('[data-barra-checkout] button').filter({ hasText: /^Continuar$/ }).first().tap()
      await p.waitForTimeout(600)
      ok('AddPaymentInfo só quando sai do Pagamento (não na Entrega)', conta(await eventosFb(p), 'AddPaymentInfo').length === 0)
      await p.getByTestId('pagamento-pix').tap()
      await p.locator('[data-barra-checkout] button').filter({ hasText: /Revisar pedido/ }).first().tap()
      await p.waitForTimeout(600)
      fb = await eventosFb(p)
      ok('AddPaymentInfo ao sair da etapa Pagamento', conta(fb, 'AddPaymentInfo').length === 1, texto(conta(fb, 'AddPaymentInfo')))
      await p.waitForTimeout(200)
      if (PRINTS) await p.screenshot({ path: join(PRINTS, `${perfil.id}-revisao.png`) })
      await p.getByTestId('fazer-pedido').tap()
      await p.waitForTimeout(2500)
      const ped = await um(`select id, numero, total from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2 order by criado_em desc limit 1`, [loja.id, TEL])
      if (ped) criados.push(ped.id)
      ok('pedido feito de ponta a ponta', !!ped && !criados.slice(0, -1).includes(ped.id), texto(ped))
      fb = await eventosFb(p)
      const pu = conta(fb, 'Purchase')
      ok('Purchase uma vez, com valor do pedido, BRL e event_id do pedido',
        pu.length === 1 && Math.abs(pu[0][2].value - Number(ped?.total)) < 0.01 && pu[0][2].currency === 'BRL' && pu[0][3]?.eventID === `pedido-${ped?.id}` && pu[0][2].num_items === 1,
        texto(pu))
      const ga = await eventosGa(p)
      const nomes = ga.map((e) => e[1])
      ok('Google tag: view_item, add_to_cart, begin_checkout, add_payment_info, purchase (uma vez cada)',
        ['view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'].every((n) => nomes.filter((x) => x === n).length === 1) &&
        ga.find((e) => e[1] === 'purchase')?.[2]?.transaction_id === String(ped?.numero), texto(nomes))
      if (PRINTS) await p.screenshot({ path: join(PRINTS, `${perfil.id}-confirmacao.png`) })
      // API de Conversões (servidor): mesmo event_id, código de teste, telefone em hash, clique do anúncio.
      for (let i = 0; i < 20 && !capi.some((c) => c.corpo?.data?.[0]?.event_id === `pedido-${ped?.id}`); i++) await p.waitForTimeout(300)
      const ev = capi.filter((c) => c.corpo?.data?.[0]?.event_id === `pedido-${ped?.id}`)
      const d = ev[0]?.corpo?.data?.[0]
      ok('API de Conversões: 1 Purchase com o mesmo event_id, BRL, valor e test_event_code',
        ev.length === 1 && d?.event_name === 'Purchase' && d?.custom_data?.currency === 'BRL' && Math.abs(d?.custom_data?.value - Number(ped?.total)) < 0.01 && ev[0].corpo.test_event_code === 'TEST123' &&
        ev[0].url.includes(`/${PIXEL}/events`), texto(ev.map((e) => ({ url: e.url.replace(/access_token=[^&]+/, 'access_token=***'), id: e.corpo?.data?.[0]?.event_id }))))
      ok('API de Conversões: telefone só em SHA-256, fbc do clique do anúncio, IP e navegador',
        /^[a-f0-9]{64}$/.test(d?.user_data?.ph?.[0] ?? '') && !JSON.stringify(ev[0]?.corpo ?? {}).includes(TEL) && (d?.user_data?.fbc ?? '').includes(`TESTEfbclid${perfil.id.replace(/-/g, '')}`) && !!d?.user_data?.client_user_agent,
        texto(d?.user_data ? { ...d.user_data, ph: d.user_data.ph?.[0]?.slice(0, 8) } : null))
      const nav = await um(`select navegador, sistema, origem from vitrine_eventos where restaurante_id=$1 and tipo='visita' and criado_em > $2 order by id desc limit 1`, [loja.id, inicio])
      ok(`rastreio da vitrine grava o navegador (${perfil.nav}) e a origem do anúncio`, nav?.navegador === perfil.nav && nav?.origem === 'ig', texto(nav))
    } catch (e) {
      ok(`${perfil.nome}: fluxo completo`, false, String(e).slice(0, 200))
      if (PRINTS) await p.screenshot({ path: join(PRINTS, `${perfil.id}-ERRO.png`) }).catch(() => {})
    } finally {
      await ctx.close()
    }
  }

  console.log('\n── Segurança e robôs ──')
  const antes = Number((await um(`select count(*) n from vitrine_eventos where restaurante_id=$1`, [loja.id])).n)
  const vis = 'robo' + Date.now()
  for (const ua of ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'WhatsApp/2.23.20.0', 'Mozilla/5.0 (compatible; Googlebot/2.1)']) {
    await fetch(`${BASE}/api/loja/${SLUG}/eventos`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': ua }, body: JSON.stringify({ visitanteId: vis, sessaoId: vis, eventos: [{ tipo: 'visita', idadeMs: 0, origem: 'Direto' }] }) })
  }
  await new Promise((r) => setTimeout(r, 500))
  ok('pré-visualização de link e robôs não viram visita', Number((await um(`select count(*) n from vitrine_eventos where restaurante_id=$1`, [loja.id])).n) === antes)
  const gente = 'gente' + Date.now()
  await fetch(`${BASE}/api/loja/${SLUG}/eventos`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': UA_IG }, body: JSON.stringify({ visitanteId: gente, sessaoId: gente, eventos: [{ tipo: 'visita', idade: 0, origem: 'ig' }] }) })
  await new Promise((r) => setTimeout(r, 500))
  ok('controle: o mesmo envio vindo do navegador do Instagram grava (navegador=instagram)', (await um(`select navegador from vitrine_eventos where visitante_id=$1`, [gente]))?.navegador === 'instagram')
  await db.query(`update restaurantes set facebook_pixel_id=$2 where id=$1`, [loja.id, `123');alert(1);//`])
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR' })
  await ctx.route(/facebook\.net|facebook\.com|googletagmanager\.com|google-analytics\.com/, (r) => r.abort())
  await ctx.addInitScript(GRAVADOR)
  const p = await ctx.newPage()
  await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  const fbInj = await eventosFb(p)
  ok('pixel com código no campo NÃO é injetado (campo segue aceitando só o ID)', !fbInj.some((e) => e[0] === 'init') && (await p.locator('#fb-pixel').count()) === 0, texto(fbInj))
  await ctx.close()
} finally {
  if (criados.length) await db.query(`delete from pedidos where id = any($1)`, [criados])
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])
  await db.query(`delete from integracoes_segredos where restaurante_id=$1`, [loja.id])
  await db.query(`update restaurantes set aceita_entrega=$2, aceita_retirada=$3, facebook_pixel_id=$4, google_tag_id=$5 where id=$1`, [loja.id, loja.aceita_entrega, loja.aceita_retirada, loja.facebook_pixel_id, loja.google_tag_id])
  await browser.close(); await db.end(); receptor.close()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
