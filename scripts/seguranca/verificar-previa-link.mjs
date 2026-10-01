/**
 * Confere a prévia do link da vitrine como o WhatsApp busca (User-Agent do WhatsApp):
 * meta tags og:* completas e a og:image (JPEG, 1200×630, < 300 KB, URL absoluta https).
 * Só leitura.
 *
 *   node scripts/seguranca/verificar-previa-link.mjs [base] [slug...]
 *   node scripts/seguranca/verificar-previa-link.mjs https://app.menuzia.com.br menuzia villa-lanches
 */
import sharp from 'sharp'

const BASE = process.argv[2] ?? 'https://app.menuzia.com.br'
const SLUGS = process.argv.slice(3).length ? process.argv.slice(3) : ['menuzia']
const UA = 'WhatsApp/2.24.8.78 A'
let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
for (const slug of SLUGS) {
  console.log(`\n── ${slug} ──`)
  const html = await (await fetch(`${BASE}/loja/${slug}`, { headers: { 'User-Agent': UA } })).text()
  const meta = (p) => html.match(new RegExp(`<meta (?:property|name)="${p}" content="([^"]*)"`))?.[1]?.replace(/&amp;/g, '&')
  for (const t of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:image:type']) ok(`${t} presente`, !!meta(t), meta(t) ?? '')
  const img = meta('og:image') ?? ''
  ok('og:image é URL absoluta https', /^https:\/\//.test(img) || BASE.startsWith('http://127.0.0.1'))
  const alvo = BASE.startsWith('http://127.0.0.1') ? img.replace(/^https:\/\/[^/]+/, BASE) : img
  const r = await fetch(alvo, { headers: { 'User-Agent': UA } })
  const buf = Buffer.from(await r.arrayBuffer())
  const m = await sharp(buf).metadata().catch(() => ({}))
  ok('imagem pública (200) e JPEG', r.status === 200 && m.format === 'jpeg', `${r.status} ${r.headers.get('content-type')}`)
  ok('1200×630', m.width === 1200 && m.height === 630, `${m.width}×${m.height}`)
  ok('abaixo de 300 KB', buf.length <= 300 * 1024, `${Math.round(buf.length / 1024)} KB`)
}
console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ tudo certo')
process.exit(falhas ? 1 : 0)
