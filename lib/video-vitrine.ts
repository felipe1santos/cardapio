/**
 * Vídeo em loop na vitrine (21/10/2026): um vídeo curto por item (card da home e/ou carrossel da ficha, na posição
 * escolhida) e um no banner promocional (como slide). Só upload: o servidor converte (lib/video/converter.ts) para MP4
 * H.264 sem áudio, até 720p, ~1,5 Mbps, corta em 15 s e gera a capa (1º quadro). Aqui ficam as regras puras.
 */

export const VIDEO_DURACAO_MAX_S = 15
export const VIDEO_ENTRADA_MAX_BYTES = 50 * 1024 * 1024
/** Lado menor do vídeo convertido (720p em pé ou deitado). */
export const VIDEO_LADO_MENOR = 720
export const VIDEO_KBPS = 1500

export interface VideoArquivo { url: string; capa: string }
/** Vídeo do item: onde aparece e em que posição do carrossel da ficha (0 = antes da 1ª foto). */
export interface VideoItem extends VideoArquivo { home: boolean; carrossel: boolean; posicao: number }
/** Vídeo do banner promocional: posição entre as imagens (0 = primeiro slide). */
export interface VideoBanner extends VideoArquivo { posicao: number }

export type Midia = { tipo: 'foto'; url: string } | { tipo: 'video'; url: string; capa: string }

const ehUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v)
const posicaoValida = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

export function videoDoItem(raw: unknown): VideoItem | null {
  const v = raw as Partial<VideoItem> | null
  if (!v || !ehUrl(v.url) || !ehUrl(v.capa)) return null
  return { url: v.url, capa: v.capa, home: v.home === true, carrossel: v.carrossel !== false, posicao: posicaoValida(v.posicao) }
}

export function videoDoBanner(raw: unknown): VideoBanner | null {
  const v = raw as Partial<VideoBanner> | null
  if (!v || !ehUrl(v.url) || !ehUrl(v.capa)) return null
  return { url: v.url, capa: v.capa, posicao: posicaoValida(v.posicao) }
}

/** Fotos + vídeo na posição escolhida (posição além do fim = último). */
export function comVideo(fotos: string[], video: VideoArquivo & { posicao: number } | null): Midia[] {
  const lista: Midia[] = fotos.map((url) => ({ tipo: 'foto', url }))
  if (!video) return lista
  lista.splice(Math.min(video.posicao, lista.length), 0, { tipo: 'video', url: video.url, capa: video.capa })
  return lista
}

/** Carrossel da ficha do item: o vídeo só entra se a loja marcou "no carrossel". */
export function midiasDaFicha(fotos: string[], video: VideoItem | null): Midia[] {
  return comVideo(fotos, video?.carrossel ? video : null)
}

/** null = arquivo aceito para upload. */
export function validarArquivoVideo(arq: { type: string; size: number }): string | null {
  if (!/^video\//.test(arq.type)) return 'Envie um vídeo (MP4, MOV ou WebM).'
  if (arq.size > VIDEO_ENTRADA_MAX_BYTES) return 'Vídeo muito grande (máximo 50 MB). Grave um trecho mais curto.'
  return null
}

/**
 * Argumentos do ffmpeg: corta em 15 s, tira o áudio, reduz até o lado menor ter 720 px (nunca aumenta), H.264
 * compatível com qualquer celular (yuv420p, main) e com o índice no começo (faststart: começa a tocar antes de baixar).
 */
export function argsConversao(entrada: string, saida: string): string[] {
  const escala = `scale='if(gt(iw,ih),-2,min(${VIDEO_LADO_MENOR},iw))':'if(gt(iw,ih),min(${VIDEO_LADO_MENOR},ih),-2)'`
  return [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', entrada, '-t', String(VIDEO_DURACAO_MAX_S), '-an',
    '-vf', `${escala},fps=30`, '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-b:v', `${VIDEO_KBPS}k`, '-maxrate', `${Math.round(VIDEO_KBPS * 1.2)}k`, '-bufsize', `${VIDEO_KBPS * 2}k`,
    '-movflags', '+faststart', saida,
  ]
}

/** 1º quadro do vídeo JÁ convertido, como JPEG (o servidor passa para WebP). */
export function argsCapa(videoConvertido: string, saida: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoConvertido, '-frames:v', '1', '-q:v', '3', saida]
}
