/**
 * Lado a lado: modelo (docs/referencias/impressao/v3, na mesma largura do papel) x saída
 * do Beta.  node scripts/impressao/lado-a-lado-v3.mjs <COMANDA|PRE-CONTA> <saida.png> <lado.png>
 */
import sharp from 'sharp'
const [modelo, saida, lado] = process.argv.slice(2)
const ms = await sharp(saida).metadata()
const ref = await sharp(`docs/referencias/impressao/v3/${modelo}.png`).flatten({ background: '#fff' }).resize(ms.width).png().toBuffer()
const mr = await sharp(ref).metadata()
const gap = 24
const h = Math.max(mr.height, ms.height)
await sharp({ create: { width: ms.width * 2 + gap, height: h, channels: 3, background: '#bbbbbb' } })
  .composite([{ input: ref, left: 0, top: 0 }, { input: saida, left: ms.width + gap, top: 0 }])
  .png().toFile(lado)
console.log(`modelo ${ms.width}x${mr.height} | saida ${ms.width}x${ms.height} -> ${lado}`)
