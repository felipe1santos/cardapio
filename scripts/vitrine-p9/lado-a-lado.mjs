/**
 * Lado a lado iFood (prints do dono em Downloads/ifood-design) × vitrine Menuzia (prints do
 * e2e-vitrine-p9 em docs/vitrine-p9/e2e). Saída: docs/vitrine-p9/lado-a-lado-*.png.
 *   node scripts/vitrine-p9/lado-a-lado.mjs
 */
import sharp from 'sharp'
import { existsSync } from 'node:fs'

const REF = process.env.REF ?? 'C:/Users/felipe/Downloads/ifood-design/'
const NOS = process.env.NOS ?? 'docs/vitrine-p9/e2e/'
const OUT = process.env.OUT ?? 'docs/vitrine-p9/'
const ALT = 1400
const PARES = process.env.PROD ? [
  ['ficha', 'WhatsApp Image 2026-10-04 at 17.13.19.jpeg', '2-ficha.png'],
  ['sacola', 'WhatsApp Image 2026-10-04 at 17.13.19 (2).jpeg', '3-sacola.png'],
  ['sacola-fim', 'WhatsApp Image 2026-10-04 at 17.13.19 (1).jpeg', '3b-sacola-inteira.png'],
  ['entrega', 'WhatsApp Image 2026-10-04 at 17.13.19 (3).jpeg', '5-entrega.png'],
  ['pagamento', 'WhatsApp Image 2026-10-04 at 17.13.20.jpeg', '6-pagamento.png'],
  ['revise', 'WhatsApp Image 2026-10-04 at 17.13.20 (1).jpeg', '7-revise-o-seu-pedido.png'],
] : [
  ['ficha', 'WhatsApp Image 2026-10-04 at 17.13.19.jpeg', 'ficha-390.png'],
  ['sacola', 'WhatsApp Image 2026-10-04 at 17.13.19 (2).jpeg', 'sacola-390.png'],
  ['sacola-fim', 'WhatsApp Image 2026-10-04 at 17.13.19 (1).jpeg', 'sacola-390-inteira.png'],
  ['entrega', 'WhatsApp Image 2026-10-04 at 17.13.19 (3).jpeg', 'entrega-390.png'],
  ['pagamento', 'WhatsApp Image 2026-10-04 at 17.13.20.jpeg', 'pagamento-390.png'],
  ['revise', 'WhatsApp Image 2026-10-04 at 17.13.20 (1).jpeg', 'revise-390.png'],
  ['lista', 'WhatsApp Image 2026-10-04 at 17.13.20 (2).jpeg', 'lista-90.png'],
]
const rotulo = (t, w) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="56"><rect width="100%" height="100%" fill="#111827"/><text x="20" y="38" font-family="Arial" font-size="26" font-weight="600" fill="#fff">${t}</text></svg>`)).png().toBuffer()
for (const [nome, ref, nos] of PARES) {
  if (!existsSync(REF + ref) || !existsSync(NOS + nos)) { console.log('pulei', nome); continue }
  const lado = async (arq, titulo, cortar) => {
    let img = sharp(arq)
    if (cortar) { const m = await img.metadata(); img = sharp(arq).extract({ left: 0, top: Math.max(0, m.height - Math.round(m.width * 2.17)), width: m.width, height: Math.min(m.height, Math.round(m.width * 2.17)) }) }
    const corpo = await img.resize({ height: ALT }).png().toBuffer()
    const { width } = await sharp(corpo).metadata()
    return { buf: await sharp({ create: { width, height: ALT + 56, channels: 3, background: '#fff' } }).composite([{ input: await rotulo(titulo, width), top: 0, left: 0 }, { input: corpo, top: 56, left: 0 }]).png().toBuffer(), width }
  }
  const a = await lado(REF + ref, 'iFood (referência)', false)
  const b = await lado(NOS + nos, process.env.PROD ? 'Menuzia (produção)' : 'Menuzia (depois)', nome === 'sacola-fim')
  await sharp({ create: { width: a.width + b.width + 24, height: ALT + 56, channels: 3, background: '#E5E7EB' } })
    .composite([{ input: a.buf, left: 0, top: 0 }, { input: b.buf, left: a.width + 24, top: 0 }]).png().toFile(`${OUT}lado-a-lado-${nome}.png`)
  console.log('•', nome)
}
