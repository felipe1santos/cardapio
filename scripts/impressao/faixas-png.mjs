/**
 * Faixas de tinta de um PNG (linha a linha): y inicial, altura, x mínimo e máximo.
 * Para medir os modelos e comparar com a saída.  node scripts/impressao/faixas-png.mjs <png> [limiar]
 */
import sharp from 'sharp'
const [arq, lim = '140'] = process.argv.slice(2)
const { data, info } = await sharp(arq).flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true })
const L = Number(lim)
const W = info.width, H = info.height
let dentro = false, y0 = 0, xmin = W, xmax = 0
const out = []
for (let y = 0; y < H; y++) {
  let tem = false
  for (let x = 0; x < W; x++) if (data[y * W + x] < L) { tem = true; if (x < xmin) xmin = x; if (x > xmax) xmax = x }
  if (tem && !dentro) { dentro = true; y0 = y }
  if (!tem && dentro) { dentro = false; out.push(`y=${y0} h=${y - y0} x=${xmin}..${xmax}`); xmin = W; xmax = 0 }
}
console.log(`${W}x${H}`)
console.log(out.join('\n'))
