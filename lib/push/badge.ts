import sharp from 'sharp'

/**
 * "Badge" da notificação (o ícone pequeno da barra de status do Android): o Android usa só o
 * canal alfa, então tem que ser SILHUETA branca em fundo transparente — a logo colorida vira um
 * quadrado branco. Gerado da logo da loja: separa o "desenho" do fundo (cor dos cantos) e pinta
 * de branco. Logo que não dá silhueta boa (foto, fundo cheio, quase vazia) → talher neutro.
 */
export const BADGE_LADO = 96

const TALHER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
<g fill="#fff">
<path d="M30 10h4v24h4V10h4v24h4V10h4v28c0 6-4 10-9 11v37h-6V49c-5-1-9-5-9-11V10z"/>
<path d="M62 10c7 0 12 9 12 22 0 10-4 16-9 17v37h-6V10h3z"/>
</g></svg>`

export async function badgeNeutro(): Promise<Buffer> {
  return sharp(Buffer.from(TALHER_SVG)).resize(BADGE_LADO, BADGE_LADO).png().toBuffer()
}

/** Silhueta da logo; `null` quando a logo não rende uma silhueta reconhecível. */
export async function silhuetaDaLogo(logo: Buffer): Promise<Buffer | null> {
  const margem = 8
  const interno = BADGE_LADO - margem * 2
  const { data, info } = await sharp(logo)
    .rotate()
    .resize(interno, interno, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const px = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const
  }
  // Fundo = média dos cantos opacos (logo em fundo branco/colorido); cantos transparentes = sem fundo.
  const cantos = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)].filter((c) => c[3] > 200)
  const fundo = cantos.length >= 3
    ? [0, 1, 2].map((k) => cantos.reduce((s, c) => s + c[k], 0) / cantos.length)
    : null
  const saida = Buffer.alloc(w * h * 4)
  let tinta = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y)
      let e = false
      if (a > 100) {
        e = fundo ? Math.hypot(r - fundo[0], g - fundo[1], b - fundo[2]) > 70 : true
      }
      if (e) tinta++
      const o = (y * w + x) * 4
      saida[o] = 255; saida[o + 1] = 255; saida[o + 2] = 255; saida[o + 3] = e ? 255 : 0
    }
  }
  const cobertura = tinta / (w * h)
  // Quase vazia (desenho apagado) ou quase cheia (foto/quadrado) não vira silhueta legível.
  if (cobertura < 0.04 || cobertura > 0.7) return null
  return sharp(saida, { raw: { width: w, height: h, channels: 4 } })
    .extend({ top: margem, bottom: margem, left: margem, right: margem, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

export async function gerarBadgePng(logo: Buffer | null): Promise<{ png: Buffer; origem: 'logo' | 'neutro' }> {
  if (logo) {
    try {
      const s = await silhuetaDaLogo(logo)
      if (s) return { png: s, origem: 'logo' }
    } catch {
      /* logo ilegível */
    }
  }
  return { png: await badgeNeutro(), origem: 'neutro' }
}
