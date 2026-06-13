// Gera os ícones do PWA do portal do motoboy (public/icons/) a partir de um
// ícone Material "two_wheeler" sobre fundo ciano da marca Menuzia.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const ICON_PATH =
  'M19.44,9.03L15.41,5H11v2h3.59l2,2H5c-2.8,0-5,2.2-5,5s2.2,5,5,5c2.46,0,4.45-1.69,4.9-4h1.65l2.77-2.77c-0.21,0.54-0.32,1.14-0.32,1.77c0,2.21,1.79,4,4,4s4-1.79,4-4C22,11.69,21,10.16,19.44,9.03z M5,15c-1.66,0-3-1.34-3-3s1.34-3,3-3 s3,1.34,3,3S6.66,15,5,15z M9.81,11c-0.45-1.92-1.97-3.46-3.91-3.9L7,6h4.17l1.93,1.93L9.81,11z M19,15c-1.1,0-2-0.9-2-2c0-1.1,0.9-2,2-2s2,0.9,2,2C21,14.1,20.1,15,19,15z'

function svg(size, scale) {
  const inner = size * scale
  const offset = (size - inner) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#06B6D4"/>
    <g transform="translate(${offset} ${offset}) scale(${inner / 24})">
      <path fill="#ffffff" d="${ICON_PATH}"/>
    </g>
  </svg>`
}

const outDir = path.join(process.cwd(), 'public', 'icons')
await mkdir(outDir, { recursive: true })

const targets = [
  { file: 'motoboy-192.png', size: 192, scale: 0.6 },
  { file: 'motoboy-512.png', size: 512, scale: 0.6 },
  { file: 'motoboy-192-maskable.png', size: 192, scale: 0.5 },
  { file: 'motoboy-512-maskable.png', size: 512, scale: 0.5 },
  { file: 'motoboy-apple-180.png', size: 180, scale: 0.6 },
]

for (const { file, size, scale } of targets) {
  await sharp(Buffer.from(svg(size, scale))).png().toFile(path.join(outDir, file))
  console.log('gerado', file)
}
