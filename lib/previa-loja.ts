import sharp, { type OverlayOptions, type Sharp } from 'sharp'

/**
 * Imagem da prévia do link da vitrine (og:image) — o que o WhatsApp mostra quando alguém
 * manda https://app.menuzia.com.br/loja/<slug>.
 *
 * Antes a og:image era a capa original em WebP (às vezes vários MB): o WhatsApp não usa
 * WebP grande na prévia e mostrava uma miniatura borrada. Agora cada loja tem uma imagem
 * própria: JPEG 1200×630, abaixo de 300 KB, nítida — a capa recortada; sem capa, a logo e
 * o nome da loja sobre a cor da loja.
 */
export const PREVIA_LARGURA = 1200
export const PREVIA_ALTURA = 630
export const PREVIA_MAX_BYTES = 300 * 1024

export interface DadosPrevia {
  nome: string
  bannerUrl: string | null
  logoUrl: string | null
  cor: string
}

/** Versão curta que muda quando muda o que aparece na imagem (fura o cache do WhatsApp). */
export function versaoPrevia(d: DadosPrevia): string {
  const base = `${d.nome}|${d.bannerUrl ?? ''}|${d.logoUrl ?? ''}|${d.cor}`
  let h = 2166136261
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function escaparXml(t: string): string {
  return t.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string)
}

async function baixar(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    return Buffer.from(await r.arrayBuffer())
  } catch {
    return null
  }
}

/** JPEG no tamanho certo, baixando a qualidade até caber no limite. */
async function comoJpeg(img: Sharp): Promise<Buffer> {
  const bruto = await img.png().toBuffer()
  for (const q of [84, 78, 70, 62, 54]) {
    const out = await sharp(bruto).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer()
    if (out.length <= PREVIA_MAX_BYTES) return out
  }
  return sharp(bruto).jpeg({ quality: 45, mozjpeg: true }).toBuffer()
}

export async function gerarPreviaJpeg(d: DadosPrevia): Promise<Buffer> {
  const capa = d.bannerUrl ? await baixar(d.bannerUrl) : null
  if (capa) {
    try {
      return await comoJpeg(sharp(capa).rotate().resize(PREVIA_LARGURA, PREVIA_ALTURA, { fit: 'cover', position: 'attention' }).flatten({ background: '#ffffff' }))
    } catch {
      /* capa ilegível: cai na composição com a logo */
    }
  }
  const nome = escaparXml(d.nome.length > 34 ? `${d.nome.slice(0, 33)}…` : d.nome)
  const fundo = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIA_LARGURA}" height="${PREVIA_ALTURA}">
      <rect width="100%" height="100%" fill="${escaparXml(d.cor)}"/>
      <text x="600" y="${d.logoUrl ? 520 : 340}" font-family="Montserrat, Arial, Helvetica, sans-serif" font-size="64" font-weight="700" fill="#ffffff" text-anchor="middle">${nome}</text>
      <text x="600" y="${d.logoUrl ? 580 : 410}" font-family="Montserrat, Arial, Helvetica, sans-serif" font-size="30" fill="#ffffff" fill-opacity="0.85" text-anchor="middle">Peça online</text>
    </svg>`,
  )
  const camadas: OverlayOptions[] = []
  const logo = d.logoUrl ? await baixar(d.logoUrl) : null
  if (logo) {
    try {
      const lado = 300
      const mascara = Buffer.from(`<svg width="${lado}" height="${lado}"><circle cx="${lado / 2}" cy="${lado / 2}" r="${lado / 2}" fill="#fff"/></svg>`)
      const redonda = await sharp(logo).resize(lado, lado, { fit: 'cover' }).composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer()
      camadas.push({ input: redonda, top: 110, left: (PREVIA_LARGURA - lado) / 2 })
    } catch {
      /* logo ilegível: fica só o nome */
    }
  }
  return comoJpeg(sharp(fundo).composite(camadas))
}

/**
 * Ícone quadrado da loja para o app instalado (manifesto por loja, apple-touch-icon):
 * a logo ocupando o quadrado sobre branco; sem logo, a inicial do nome na cor da loja.
 */
export async function gerarIconePng(d: DadosPrevia, lado: number): Promise<Buffer> {
  const logo = d.logoUrl ? await baixar(d.logoUrl) : null
  if (logo) {
    try {
      return await sharp(logo).rotate().resize(lado, lado, { fit: 'cover' }).flatten({ background: '#ffffff' }).png().toBuffer()
    } catch {
      /* logo ilegível: cai na inicial */
    }
  }
  const inicial = escaparXml((d.nome.trim()[0] ?? 'M').toUpperCase())
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}">
      <rect width="100%" height="100%" fill="${escaparXml(d.cor)}"/>
      <text x="50%" y="50%" dy="0.35em" font-family="Montserrat, Arial, Helvetica, sans-serif" font-size="${Math.round(lado * 0.5)}" font-weight="700" fill="#ffffff" text-anchor="middle">${inicial}</text>
    </svg>`,
  )
  return sharp(svg).png().toBuffer()
}
