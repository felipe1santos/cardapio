/**
 * Monta as comparações referência × resultado (2026-10-01) em docs/vitrine-tags/prints/:
 *   lado-a-lado-tags-*.png  (REF-TAGS × produto na vitrine)
 *   lado-a-lado-cores.png   (REF-CORES iFood × desconto + tags)
 * Rode depois de scripts/vitrine/e2e-vitrine-tags.mjs (que gera os recortes).
 */
import sharp from 'sharp'

const REF = 'docs/referencias/vitrine-tags/'
const OUT = 'docs/vitrine-tags/prints/'
const L = 1170

async function rotulo(texto) {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="64"><rect width="100%" height="100%" fill="#111827"/><text x="24" y="42" font-family="Arial" font-size="30" font-weight="700" fill="#fff">${texto}</text></svg>`)).png().toBuffer()
}

async function empilhar(saida, partes) {
  const bufs = []
  for (const [titulo, img] of partes) {
    bufs.push(await rotulo(titulo))
    bufs.push(await img.resize(L).png().toBuffer())
  }
  const metas = await Promise.all(bufs.map((b) => sharp(b).metadata()))
  let y = 0
  const comp = bufs.map((input, i) => { const c = { input, left: 0, top: y }; y += metas[i].height; return c })
  await sharp({ create: { width: L, height: y, channels: 3, background: '#ffffff' } }).composite(comp).png().toFile(OUT + saida)
  console.log('ok', saida)
}

const refTags = REF + 'cardapio-tags-menuzia.png'
await empilhar('lado-a-lado-tags-mais-vendido.png', [
  ['REF-TAGS: X-BURGUER (Mais vendido + Serve + Item promocional)', sharp(refTags).extract({ left: 0, top: 510, width: 934, height: 335 })],
  ['Resultado na vitrine (390 px)', sharp(OUT + 'recorte-xburger.png')],
])
await empilhar('lado-a-lado-tags-combo.png', [
  ['REF-TAGS: HAMBURGUER (Combo premium)', sharp(refTags).extract({ left: 0, top: 170, width: 934, height: 335 })],
  ['Resultado: Combo especial (no topo, junto do nome — regra)', sharp(OUT + 'recorte-combo.png')],
])
await empilhar('lado-a-lado-cores.png', [
  ['REF-CORES (iFood): R$ 5 off verde e roxos', sharp(REF + 'referencia-ifood-tags.jpeg').extract({ left: 0, top: 240, width: 592, height: 235 })],
  ['Resultado: desconto + Combo especial + utilitárias', sharp(OUT + 'recorte-desconto-tags.png')],
])
