/**
 * Lado a lado: modelo (docs/referencias/impressao/v2, papel recortado e na mesma largura)
 * x saída do Beta. node scripts/impressao/lado-a-lado-v2.mjs <modelo COMANDA|PRE-CONTA> <saida.png> <lado.png>
 */
import sharp from 'sharp'
const [modelo, saida, lado] = process.argv.slice(2)
const PAPEL = { COMANDA: { left: 157, top: 50, width: 710, height: 1422 }, 'PRE-CONTA': { left: 154, top: 76, width: 719, height: 1400 } }
const ref = await sharp(`docs/referencias/impressao/v2/${modelo}.png`).extract(PAPEL[modelo]).resize(576).png().toBuffer()
const mr = await sharp(ref).metadata()
const ms = await sharp(saida).metadata()
const gap = 24
const h = Math.max(mr.height, ms.height)
await sharp({ create: { width: 576 * 2 + gap, height: h, channels: 3, background: '#bbbbbb' } })
  .composite([{ input: ref, left: 0, top: 0 }, { input: saida, left: 576 + gap, top: 0 }])
  .png().toFile(lado)
console.log(`modelo 576x${mr.height} | saida ${ms.width}x${ms.height} -> ${lado}`)
