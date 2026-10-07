/**
 * E2E — mapa do "Despacho de rotas" abria em Fortaleza (item 5, noite 3). Stack LOCAL.
 *
 * O Google Maps NÃO é chamado: o script maps.googleapis.com é interceptado e trocado por uma API
 * falsa que registra centro, zoom, enquadramento e cada geocodificação (com o viés pedido).
 * Assim o teste confere o FUNCIONAMENTO sem rede e sem gastar cota.
 *   1. loja com coordenadas, sem pedido pronto: o mapa abre na loja (não em Fortaleza);
 *   2. com pedidos prontos: enquadra loja + pedidos; geocodificação puxada para perto da loja;
 *   3. loja sem coordenadas: usa a cidade da loja; sem nada, o Brasil (nunca Fortaleza).
 *   4. app do motoboy (RouteMap, item 2 de 07/10): abre na loja, endereço único com viés perto
 *      dela e, se a rota não sair, volta para a loja (nunca Fortaleza).
 * O design da tela não muda (regra 4): o teste só lê o estado do mapa.
 *
 *   node scripts/mapa-rotas/e2e-mapa-rotas.mjs [prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? 'docs/mapa-rotas'
mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (q, a = []) => (await db.query(q, a)).rows[0]
const loja = await um(`select id, usa_logistica, entrega_sem_entregador, latitude, longitude, endereco_cidade, endereco_estado from restaurantes where slug=$1`, [SLUG])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const VITORIA = { lat: -20.3155, lng: -40.3128 }
const FORTALEZA = { lat: -3.73, lng: -38.53 }
const perto = (a, b, tol = 0.6) => a && b && Math.abs(a.lat - b.lat) <= tol && Math.abs(a.lng - b.lng) <= tol

// API falsa do Google Maps: o bastante para o RotaMap/RouteMap, registrando tudo em window.__mapa.
const FALSO = `
(() => {
  const reg = window.__mapa = { centros: [], zooms: [], fits: [], geocodes: [] }
  class LatLng { constructor(a, b) { if (typeof a === 'object') { this._a = a.lat; this._b = a.lng } else { this._a = a; this._b = b } } lat() { return this._a } lng() { return this._b } toUrlValue() { return this._a.toFixed(6) + ',' + this._b.toFixed(6) } toJSON() { return { lat: this._a, lng: this._b } } }
  const ll = (p) => p instanceof LatLng ? p : new LatLng(p)
  class LatLngBounds { constructor(sw, ne) { this.pts = []; if (sw) this.extend(sw); if (ne) this.extend(ne) } extend(p) { this.pts.push(ll(p)); return this } isEmpty() { return this.pts.length === 0 }
    getCenter() { const la = this.pts.map((p) => p.lat()), ln = this.pts.map((p) => p.lng()); return new LatLng((Math.min(...la) + Math.max(...la)) / 2, (Math.min(...ln) + Math.max(...ln)) / 2) }
    toJSON() { return this.pts.map((p) => p.toJSON()) } }
  class Map { constructor(el, o) { this.el = el; this.setCenter(o.center); this.setZoom(o.zoom) } setCenter(c) { this.c = ll(c); reg.centros.push(this.c.toJSON()); reg.centro = this.c.toJSON() } setZoom(z) { reg.zooms.push(z); reg.zoom = z } getZoom() { return reg.zoom } fitBounds(b) { reg.fits.push(b.toJSON()); reg.centro = b.getCenter().toJSON(); reg.enquadrado = b.toJSON() } panTo(c) { this.setCenter(c) } addListener() { return { remove() {} } } }
  class Marker { constructor(o) { this.o = o || {} } setMap() {} setPosition() {} setIcon() {} addListener() { return { remove() {} } } }
  class Size { constructor(w, h) { this.width = w; this.height = h } }
  class Point { constructor(x, y) { this.x = x; this.y = y } }
  // Geocodificação de mentira: endereços com "Vitória" ou com viés perto de Vitória caem em Vitória;
  // sem viés, "Rua Teste" cai em Fortaleza (simula a rua homônima de outro estado).
  class Geocoder { geocode(req, cb) {
    const b = req.bounds ? req.bounds.toJSON() : null
    reg.geocodes.push({ address: req.address, bounds: b })
    const ehCidade = /vit[oó]ria/i.test(req.address) && !/rua/i.test(req.address)
    let alvo
    if (ehCidade) alvo = { lat: -20.3155, lng: -40.3128 }
    else if (b) { const c = { lat: (b[0].lat + b[1].lat) / 2, lng: (b[0].lng + b[1].lng) / 2 }; const n = reg.geocodes.length; alvo = { lat: c.lat + 0.01 * n, lng: c.lng + 0.01 * n } }
    else alvo = { lat: -3.73 + 0.01 * reg.geocodes.length, lng: -38.53 }
    setTimeout(() => cb([{ geometry: { location: new LatLng(alvo.lat, alvo.lng) } }], 'OK'), 10)
  } }
  class DirectionsRenderer { setMap() {} setDirections() {} }
  class DirectionsService { route(_r, cb) { cb && cb(null, 'ZERO_RESULTS'); return Promise.reject(new Error('sem rota')) } }
  window.google = { maps: { Map, Marker, LatLng, LatLngBounds, Size, Point, Geocoder, GeocoderStatus: { OK: 'OK' }, DirectionsRenderer, DirectionsService, TravelMode: { DRIVING: 'DRIVING' }, DirectionsStatus: { OK: 'OK' }, event: { clearInstanceListeners() {} }, MapTypeStyle: {} } }
  const cb = new URL(document.currentScript.src).searchParams.get('callback'); if (cb && window[cb]) window[cb]()
})()`

const criados = []
let entregadorTeste = null
async function pedido(rua, n) {
  const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem, observacao, endereco_rua, endereco_numero, endereco_bairro, criado_em, preparando_notificado)
    values ($1,'entrega','pronto',30,30,$2,'27999880101','dinheiro','delivery','cardapio','',$3,$4,'Centro', now(), true) returning id`, [loja.id, `Mapa P5 ${n}`, rua, String(n)])
  criados.push(p.id)
}

const browser = await chromium.launch()
async function abrirDespacho(nome) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR', serviceWorkers: 'block' })
  const p = await ctx.newPage()
  let chamouGoogle = false
  await p.route(/maps\.googleapis\.com\/maps\/api\/js/, (r) => { chamouGoogle = true; r.fulfill({ contentType: 'application/javascript', body: FALSO }) })
  await p.route(/maps\.(googleapis|gstatic)\.com\/(?!maps\/api\/js)/, (r) => r.abort())
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.ordemqr'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  const aviso = p.locator('[aria-labelledby="setup-alerta-titulo"]').first()
  if (await aviso.isVisible().catch(() => false)) await aviso.click({ position: { x: 5, y: 5 } }).catch(() => {})
  await p.getByTestId('kanban-despachar').click() // item 58: o capacete virou o Despachar
  await p.waitForTimeout(2500)
  const mapa = await p.evaluate(() => window.__mapa ?? null)
  await p.screenshot({ path: join(PRINTS, `${nome}.png`) })
  await ctx.close()
  return { mapa, chamouGoogle }
}

try {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_nome like 'Mapa P5%'`, [loja.id])
  // Os outros pedidos da loja local ficam como estão (status de pedido só anda para a frente).
  await db.query(`update restaurantes set usa_logistica=true, entrega_sem_entregador=false, latitude=$2, longitude=$3, endereco_cidade='Vitória', endereco_estado='ES' where id=$1`, [loja.id, VITORIA.lat, VITORIA.lng])

  secao('1. Loja com coordenadas, sem pedido pronto')
  {
    const { mapa, chamouGoogle } = await abrirDespacho('1-sem-pedidos')
    ok('o script do Google foi interceptado (nenhuma chamada real)', chamouGoogle && !!mapa)
    ok('abre na loja (Vitória), não em Fortaleza', perto(mapa?.centro, VITORIA, 0.05) && !perto(mapa?.centro, FORTALEZA, 1), JSON.stringify(mapa?.centro))
    ok('nunca centraliza em Fortaleza', !(mapa?.centros ?? []).some((c) => perto(c, FORTALEZA, 0.2)), JSON.stringify(mapa?.centros))
  }

  secao('2. Com pedidos prontos (endereços sem cidade)')
  await pedido('Rua Mapa P5', 10)
  await pedido('Rua Mapa P5', 20)
  {
    const { mapa } = await abrirDespacho('2-com-pedidos')
    const geos = mapa?.geocodes ?? []
    ok('geocodificou os 2 pedidos', geos.filter((g) => /Rua Mapa P5/.test(g.address)).length === 2, JSON.stringify(geos))
    ok('geocodificação puxada para perto da loja (viés em volta de Vitória)', geos.filter((g) => /Rua Mapa P5/.test(g.address)).every((g) => g.bounds && perto({ lat: (g.bounds[0].lat + g.bounds[1].lat) / 2, lng: (g.bounds[0].lng + g.bounds[1].lng) / 2 }, VITORIA, 0.01)))
    const ult = mapa?.fits?.at(-1) ?? []
    ok('enquadra loja + pedidos', ult.length >= 3 && ult.some((p) => perto(p, VITORIA, 0.001)), JSON.stringify(ult))
    ok('pedidos caem perto da loja (não em Fortaleza)', ult.every((p) => perto(p, VITORIA, 0.6)) && perto(mapa?.centro, VITORIA, 0.6), JSON.stringify(mapa?.centro))
  }

  secao('4. App do motoboy (portal pelo link)')
  {
    const ent = await um(`insert into entregadores (restaurante_id, nome, telefone, status) values ($1, 'Mapa P5 Moto', '27999880102', 'online') returning id, token`, [loja.id])
    entregadorTeste = ent.id
    const novoPedido = async (n) => {
      const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem, observacao, endereco_rua, endereco_numero, endereco_bairro, entregador_id, criado_em, preparando_notificado)
        values ($1,'entrega','em_rota',30,30,$2,'27999880103','dinheiro','delivery','cardapio','','Rua Mapa P5 Moto',$3,'Centro',$4, now(), true) returning id`, [loja.id, `Mapa P5 Moto ${n}`, String(n), ent.id])
      criados.push(p.id)
    }
    const abrirPortal = async (nome) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', serviceWorkers: 'block' })
      const p = await ctx.newPage()
      await p.route(/maps\.googleapis\.com\/maps\/api\/js/, (r) => r.fulfill({ contentType: 'application/javascript', body: FALSO }))
      await p.route(/maps\.(googleapis|gstatic)\.com\/(?!maps\/api\/js)/, (r) => r.abort())
      await p.goto(`${BASE}/entregador/${ent.token}`, { waitUntil: 'networkidle' })
      await p.getByTestId('motoboy-card-entregas').click({ timeout: 10000 }).catch(() => {}) // item 59: tela inicial com atalhos
      await p.waitForTimeout(3000)
      const mapa = await p.evaluate(() => window.__mapa ?? null)
      await p.screenshot({ path: join(PRINTS, `${nome}.png`) })
      await ctx.close()
      return mapa
    }
    await novoPedido(1)
    {
      const mapa = await abrirPortal('5-motoboy-uma-parada')
      const g = (mapa?.geocodes ?? []).find((x) => /Rua Mapa P5 Moto/.test(x.address))
      ok('motoboy: mapa da rota aparece', !!mapa, JSON.stringify(mapa))
      ok('motoboy: abre no Brasil/loja, nunca no centro de Fortaleza', !(mapa?.centros ?? []).some((c) => perto(c, FORTALEZA, 0.2)), JSON.stringify(mapa?.centros))
      ok('motoboy: endereço único geocodificado com viés em volta da loja', !!g?.bounds && perto({ lat: (g.bounds[0].lat + g.bounds[1].lat) / 2, lng: (g.bounds[0].lng + g.bounds[1].lng) / 2 }, VITORIA, 0.01), JSON.stringify(g))
      ok('motoboy: centraliza a parada perto da loja', perto(mapa?.centro, VITORIA, 0.6), JSON.stringify(mapa?.centro))
    }
    await novoPedido(2)
    {
      const mapa = await abrirPortal('6-motoboy-rota-falhou')
      ok('motoboy: rota que não sai volta para a loja (não Fortaleza)', perto(mapa?.centro, VITORIA, 0.05) && !(mapa?.centros ?? []).some((c) => perto(c, FORTALEZA, 0.2)), JSON.stringify(mapa?.centros))
    }
  }

  secao('3. Loja sem coordenadas')
  await db.query(`delete from pedidos where id = any($1)`, [criados.splice(0)])
  await db.query(`update restaurantes set latitude=null, longitude=null where id=$1`, [loja.id])
  {
    const { mapa } = await abrirDespacho('3-loja-so-cidade')
    ok('sem coordenadas: geocodifica a cidade da loja ("Vitória, ES")', (mapa?.geocodes ?? []).some((g) => /Vitória, ES/.test(g.address)), JSON.stringify(mapa?.geocodes))
    ok('…e abre nela', perto(mapa?.centro, VITORIA, 0.05), JSON.stringify(mapa?.centro))
  }
  await db.query(`update restaurantes set endereco_cidade=null, endereco_estado=null where id=$1`, [loja.id])
  {
    const { mapa } = await abrirDespacho('4-loja-sem-nada')
    // Centro INICIAL: o Brasil inteiro (antes: Fortaleza fixo). Depois o mapa enquadra os pedidos do
    // histórico da loja local — que a API falsa, sem viés, põe longe de propósito.
    ok('sem coordenadas nem cidade: abre no Brasil (zoom 4), não em Fortaleza', mapa?.zooms?.[0] === 4 && perto(mapa?.centros?.[0], { lat: -14.24, lng: -51.93 }, 0.01), JSON.stringify({ c: mapa?.centros?.[0], z: mapa?.zooms?.[0] }))
  }
} catch (e) {
  ok('execução sem exceção', false, String(e).slice(0, 300))
} finally {
  if (criados.length) await db.query(`delete from pedidos where id = any($1)`, [criados])
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_nome like 'Mapa P5%'`, [loja.id])
  if (entregadorTeste) await db.query('delete from entregadores where id=$1', [entregadorTeste]).catch(() => {})
  await db.query(`update restaurantes set usa_logistica=$2, entrega_sem_entregador=$3, latitude=$4, longitude=$5, endereco_cidade=$6, endereco_estado=$7 where id=$1`,
    [loja.id, loja.usa_logistica, loja.entrega_sem_entregador, loja.latitude, loja.longitude, loja.endereco_cidade, loja.endereco_estado])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
