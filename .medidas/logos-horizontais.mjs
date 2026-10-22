// Logos horizontais do 99Food e da Keeta para o card do Kanban (22/10/2026, pedido do dono): recortes das MESMAS imagens
// oficiais de public/origens (99food.png e keeta.png), só reorganizados na horizontal — sem redesenhar nem recolorir.
import sharp from 'sharp'
const cor = async (f, x, y) => { const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); const i = (y * info.width + x) * 3; return { r: data[i], g: data[i + 1], b: data[i + 2] } }
const cantos = (w, h, r) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}"/></svg>`)

// 99Food: "99" (linha de cima) e "Food" (linha de baixo) lado a lado, na mesma altura, sobre o amarelo da marca.
{
  const f = 'public/origens/99food.png'
  const fundo = await cor(f, 5, 5)
  const H = 62, PAD = 14, PADV = 22
  const nove = await sharp(f).extract({ left: 30, top: 56, width: 101, height: 66 }).resize({ height: H }).toBuffer()
  const food = await sharp(f).extract({ left: 28, top: 137, width: 200, height: 62 }).toBuffer()
  const wNove = (await sharp(nove).metadata()).width
  const W = PAD + wNove + 12 + 200 + PAD, AL = H + 2 * PADV
  await sharp({ create: { width: W, height: AL, channels: 4, background: { ...fundo, alpha: 1 } } })
    .composite([{ input: nove, left: PAD, top: PADV }, { input: food, left: PAD + wNove + 12, top: PADV }, { input: cantos(W, AL, 12), blend: 'dest-in' }])
    .png().toFile('public/origens/99food-horizontal.png')
  console.log('99food-horizontal.png', W, 'x', AL)
}
// Keeta: a faixa amarela com a palavra "keeta" (sem o verde de baixo), alargada no mesmo amarelo.
{
  const f = 'public/origens/keeta.png'
  const fundo = await cor(f, 72, 8)
  const marca = await sharp(f).extract({ left: 10, top: 30, width: 124, height: 72 }).toBuffer()
  const W = 168, AL = 72
  await sharp({ create: { width: W, height: AL, channels: 4, background: { ...fundo, alpha: 1 } } })
    .composite([{ input: marca, left: Math.round((W - 124) / 2), top: 0 }, { input: cantos(W, AL, 12), blend: 'dest-in' }])
    .png().toFile('public/origens/keeta-horizontal.png')
  console.log('keeta-horizontal.png', W, 'x', AL)
}
