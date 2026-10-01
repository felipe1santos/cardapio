/**
 * Mede as cores das tags nas referências (docs/referencias/vitrine-tags/), 2026-10-01.
 * Fundo = cor predominante do recorte. Texto/ícone = pixels mais distantes do fundo (os 12%
 * mais "puros"), para o anti-aliasing não puxar a média para o meio-termo.
 *
 *   node scripts/vitrine/medir-cores-tags.mjs
 */
import sharp from 'sharp'

const DIR = 'docs/referencias/vitrine-tags/'
const RECORTES = [
  ['Mais vendido', 'cardapio-tags-menuzia.png', 278, 537, 236, 48],
  ['Combo premium (REF-TAGS)', 'cardapio-tags-menuzia.png', 36, 343, 298, 48],
  ['Serve 4 pessoas', 'cardapio-tags-menuzia.png', 36, 685, 258, 48],
  ['Item promocional', 'cardapio-tags-menuzia.png', 318, 685, 275, 48],
  ['R$ 5 off (verde) Point', 'referencia-ifood-tags.jpeg', 336, 316, 78, 23],
  ['R$ 5 off (verde) Thomazin', 'referencia-ifood-tags.jpeg', 150, 441, 81, 23],
  ['Até R$ 10 (roxo)', 'referencia-ifood-tags.jpeg', 148, 316, 92, 23],
  ['R$ 7 off (roxo)', 'referencia-ifood-tags.jpeg', 246, 316, 84, 23],
  ['Ícone Point do Açaí (roxo)', 'referencia-ifood-tags.jpeg', 274, 260, 22, 22],
]

const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

for (const [nome, arq, left, top, width, height] of RECORTES) {
  const { data, info } = await sharp(DIR + arq).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = []
  for (let i = 0; i < data.length; i += info.channels) px.push([data[i], data[i + 1], data[i + 2]])
  const freq = new Map()
  for (const p of px) { const k = p.map((v) => v >> 2).join(','); freq.set(k, (freq.get(k) ?? 0) + 1) }
  const [chave] = [...freq].sort((a, b) => b[1] - a[1])[0]
  const perto = px.filter((p) => p.map((v) => v >> 2).join(',') === chave)
  const fundo = [0, 1, 2].map((i) => perto.reduce((s, p) => s + p[i], 0) / perto.length)
  const longe = px.map((p) => [p, dist(p, fundo)]).filter(([, d]) => d > 40).sort((a, b) => b[1] - a[1])
  const top12 = longe.slice(0, Math.max(5, Math.round(longe.length * 0.12))).map(([p]) => p)
  const frente = top12.length ? [0, 1, 2].map((i) => top12.reduce((s, p) => s + p[i], 0) / top12.length) : null
  // Mais saturados (o que o olho lê como a cor da tag); branco/preto caem no critério de distância.
  const sat = (p) => { const mx = Math.max(...p), mn = Math.min(...p); return mx === 0 ? 0 : (mx - mn) / mx }
  const sats = longe.map(([p]) => p).filter((p) => sat(p) > 0.25).sort((a, b) => sat(b) * Math.max(...b) - sat(a) * Math.max(...a))
  const topSat = sats.slice(0, Math.max(3, Math.round(sats.length * 0.12)))
  const vivo = topSat.length >= 3 ? [0, 1, 2].map((i) => topSat.reduce((s, p) => s + p[i], 0) / topSat.length) : null
  console.log(`${nome.padEnd(30)} fundo ${hex(fundo)}   texto/ícone (distância) ${frente ? hex(frente) : '—'}   (mais saturados) ${vivo ? hex(vivo) : '—'}`)
}
