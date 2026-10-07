/**
 * Converte as ilustrações do dono (PNG em Downloads) para WebP leve e com FUNDO TRANSPARENTE (item 57):
 * o branco que encosta nas bordas da imagem (o fundo) vira transparente, por preenchimento a partir dos
 * cantos; o branco de dentro da mancha (nuvens) fica. Borda suavizada para não serrilhar.
 *   node scripts/vitrine/ilustracoes-webp.mjs
 */
import sharp from 'sharp'
const ORIGEM = 'C:/Users/felipe/Downloads/'
const MAPA = [['call_ncpdelGS9magcAgTef0Yc29d', 'pedidos-vazio'], ['onboarding-pedido-saiu-entrega-motoboy', 'saiu-para-entrega'], ['onboarding-nenhum-cupom-disponivel', 'cupons-vazio']]
const LADO = 640, CLARO = 246
for (const [arq, nome] of MAPA) {
  const { data, info } = await sharp(`${ORIGEM}${arq}.png`).resize(LADO, LADO, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const lum = (i) => Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
  const fundo = new Uint8Array(w * h)
  const fila = []
  for (let x = 0; x < w; x++) fila.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) fila.push(y * w, y * w + w - 1)
  while (fila.length) {
    const i = fila.pop()
    if (fundo[i] || lum(i) < CLARO) continue
    fundo[i] = 1
    const x = i % w, y = (i / w) | 0
    if (x > 0) fila.push(i - 1); if (x < w - 1) fila.push(i + 1); if (y > 0) fila.push(i - w); if (y < h - 1) fila.push(i + w)
  }
  for (let i = 0; i < w * h; i++) {
    if (fundo[i]) { data[i * 4 + 3] = 0; continue }
    // vizinho do fundo: alfa pela claridade (borda suave)
    const x = i % w, y = (i / w) | 0
    const viz = (x > 0 && fundo[i - 1]) || (x < w - 1 && fundo[i + 1]) || (y > 0 && fundo[i - w]) || (y < h - 1 && fundo[i + w])
    if (viz) { const l = lum(i); if (l > 225) data[i * 4 + 3] = Math.round(255 * (255 - l) / 30) }
  }
  const out = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(`public/vitrine/ilustracoes/${nome}.webp`)
  console.log(nome, `${Math.round(out.size / 1024)} KB`)
}
