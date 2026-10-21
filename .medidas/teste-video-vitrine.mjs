// Teste do vídeo da vitrine (21/10/2026) — SÓ loja Menuzia. Servidor local (npm run dev) com o login de teste do
// .env.local: sobe o vídeo de celular pela rota de verdade (/api/midia/video, item e banner), grava no item e no banner
// da Menuzia e tira prints do formulário do item. Uso: node .medidas/teste-video-vitrine.mjs <video.mp4> [desfazer]
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2] }
const BASE = process.env.BASE ?? 'http://localhost:3000'
const [arquivo, desfazer] = process.argv.slice(2)
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: loja } = await admin.from('restaurantes').select('id, slug').eq('slug', 'menuzia').single()
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) process.exitCode = 1 }

if (desfazer) {
  await admin.from('itens_cardapio').update({ video: null }).eq('restaurante_id', loja.id).not('video', 'is', null)
  await admin.from('restaurantes').update({ banner_promo_video: null }).eq('id', loja.id)
  console.log('vídeos de teste retirados da Menuzia'); process.exit(0)
}

const { data: itens } = await admin.from('itens_cardapio').select('id, nome, imagem_url, imagens_extras').eq('restaurante_id', loja.id).eq('status', 'disponivel').not('imagem_url', 'is', null).limit(50)
const item = itens.find((i) => (i.imagens_extras ?? []).length >= 1) ?? itens[0]

const nav = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL ?? 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 1366, height: 820 }, locale: 'pt-BR' })).newPage()
await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
await p.fill('input[name="email"]', process.env.SEED_ADMIN_EMAIL)
await p.fill('input[name="password"]', process.env.SEED_ADMIN_PASSWORD)
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180_000 }), p.click('button[type="submit"]')])
ok(true, `login local (${new URL(p.url()).pathname})`)

const enviar = async (destino) => {
  const t = Date.now()
  const r = await p.request.post(`${BASE}/api/midia/video`, { multipart: { destino, arquivo: { name: 'celular.mp4', mimeType: 'video/mp4', buffer: readFileSync(arquivo) } }, timeout: 240_000 })
  const j = await r.json()
  ok(r.ok() && j.url?.endsWith('.mp4') && j.capa?.endsWith('.webp'), `upload ${destino}: ${r.status()} em ${Date.now() - t} ms, ${(j.bytes / 1e6).toFixed(2)} MB`)
  return j
}
const vi = await enviar('item')
const vb = await enviar('banner')
const cab = await fetch(vi.url, { method: 'HEAD' })
ok(cab.headers.get('content-type') === 'video/mp4', `bucket serve video/mp4 (${cab.headers.get('content-length')} bytes)`)

await admin.from('itens_cardapio').update({ video: { url: vi.url, capa: vi.capa, home: true, carrossel: true, posicao: 1 } }).eq('id', item.id)
await admin.from('restaurantes').update({ banner_promo_video: { url: vb.url, capa: vb.capa, posicao: 0 } }).eq('id', loja.id)
ok(true, `gravado no item "${item.nome}" (home + carrossel, 2ª posição) e no banner (1º slide)`)

await p.goto(`${BASE}/admin/cardapio`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(8000)
await p.screenshot({ path: '.medidas/video-admin-cardapio.png' })
await nav.close()
