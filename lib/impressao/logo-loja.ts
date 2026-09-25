import { createHash } from 'node:crypto'

/**
 * Logo da loja para o Recibo/Extrato do Assistente Beta.
 *
 * O Assistente nunca baixa uma URL qualquer: pede a logo ao servidor, que lê pelo próprio
 * Storage (API, sem buscar endereço) e só dentro da pasta da PRÓPRIA loja no bucket
 * `cardapio`. Duas origens, nesta ordem:
 *   1. a "logo de impressão": PNG sobre fundo branco, gerada pelo navegador do dono/gerente
 *      a partir da logo atual (o decodificador WebP do Windows perde a transparência e o
 *      fundo sairia preto) — caminho fixo `<loja>/impressao/logo-<chave>.png`, onde a chave
 *      vem da URL da logo atual: trocou a logo, a versão antiga deixa de valer;
 *   2. a própria logo, se for PNG/JPEG/GIF/BMP ou WebP SEM transparência.
 * Sem nenhuma das duas: o Recibo/Extrato sai com o nome da loja.
 */

export const LOGO_MAX_BYTES = 1_500_000
export const LOGO_IMPRESSAO_MAX_BYTES = 800_000
export const LOGO_IMPRESSAO_MAX_LADO = 1200
export const BUCKET = 'cardapio'
const PREFIXO_PUBLICO = `/storage/v1/object/public/${BUCKET}/`

/** Caminho da logo DENTRO do bucket, se a URL for do Storage desta loja; senão null. */
export function caminhoLogoDaLoja(logoUrl: string | null | undefined, supabaseUrl: string | undefined, restauranteId: string): string | null {
  if (!logoUrl || !supabaseUrl || !/^[0-9a-f-]{36}$/i.test(restauranteId)) return null
  let u: URL
  let base: URL
  try {
    u = new URL(logoUrl)
    base = new URL(supabaseUrl)
  } catch {
    return null
  }
  if (u.origin !== base.origin || u.username || u.password) return null
  let caminho: string
  try {
    caminho = decodeURIComponent(u.pathname)
  } catch {
    return null
  }
  if (!caminho.startsWith(PREFIXO_PUBLICO) || caminho.includes('..') || caminho.includes('\\')) return null
  const noBucket = caminho.slice(PREFIXO_PUBLICO.length)
  if (!noBucket.toLowerCase().startsWith(`${restauranteId.toLowerCase()}/`)) return null
  return noBucket
}

/** Chave da logo de impressão: muda quando a logo da loja muda. */
export function chaveLogo(logoUrl: string): string {
  return createHash('sha256').update(logoUrl).digest('hex').slice(0, 16)
}

export function caminhoLogoImpressao(restauranteId: string, chave: string): string {
  return `${restauranteId.toLowerCase()}/impressao/logo-${chave}.png`
}

export function tipoImagem(b: Uint8Array): 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp'
  return null
}

/** WebP com canal de transparência (VP8X com o bit de alfa, ou VP8L com alfa). */
export function webpComTransparencia(b: Uint8Array): boolean {
  if (tipoImagem(b) !== 'webp' || b.length < 30) return false
  const chunk = String.fromCharCode(...b.slice(12, 16))
  if (chunk === 'VP8X') return (b[20] & 0x10) !== 0
  if (chunk === 'VP8L') return ((b[24] >> 4) & 1) === 1
  return false
}

/** Largura e altura de um PNG (cabeçalho IHDR). */
export function dimensoesPng(b: Uint8Array): { largura: number; altura: number } | null {
  if (tipoImagem(b) !== 'png' || b.length < 24) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return { largura: dv.getUint32(16), altura: dv.getUint32(20) }
}
