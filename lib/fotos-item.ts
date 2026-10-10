/**
 * Fotos do item (Bloco 1, 10/10/2026 — telas novas só com "Novidades em teste", 0178).
 *
 * Gravação SEM mudar o banco: a 1ª foto é a principal (`imagem_url` + `imagem_thumb_url`, usada na lista, nos
 * destaques e em "Mais pedidos"); as outras vão para `imagens_extras` (0130). Limite novo: 4 fotos no total.
 * Item antigo com principal + 4 extras (limite antigo) continua com as 5 — nada some; só não deixa adicionar mais.
 */
export interface Foto { url: string; thumb: string | null }

export const LIMITE_FOTOS = 4
/** Acima disto recusa antes de otimizar (a otimização reduz para 1200 px / WebP). */
export const TAMANHO_MAX_BYTES = 15 * 1024 * 1024

export function juntarFotos(item: { imagemUrl: string | null; imagemThumbUrl: string | null; imagensExtras?: Foto[] | null }): Foto[] {
  const lista: Foto[] = []
  if (item.imagemUrl) lista.push({ url: item.imagemUrl, thumb: item.imagemThumbUrl ?? null })
  for (const e of item.imagensExtras ?? []) if (e?.url) lista.push({ url: e.url, thumb: e.thumb ?? null })
  return lista
}

export function separarFotos(fotos: Foto[]): { imagemUrl: string | null; imagemThumbUrl: string | null; imagensExtras: Foto[] } {
  const [principal, ...extras] = fotos
  return { imagemUrl: principal?.url ?? null, imagemThumbUrl: principal?.thumb ?? null, imagensExtras: extras }
}

export function adicionarFoto(fotos: Foto[], nova: Foto): { ok: boolean; fotos: Foto[] } {
  if (fotos.length >= LIMITE_FOTOS) return { ok: false, fotos }
  return { ok: true, fotos: [...fotos, nova] }
}

export function moverFoto(fotos: Foto[], i: number, direcao: -1 | 1): Foto[] {
  const j = i + direcao
  if (i < 0 || i >= fotos.length || j < 0 || j >= fotos.length) return fotos
  const l = [...fotos]
  ;[l[i], l[j]] = [l[j], l[i]]
  return l
}

export function tornarPrincipal(fotos: Foto[], i: number): Foto[] {
  if (i <= 0 || i >= fotos.length) return fotos
  return [fotos[i], ...fotos.filter((_, k) => k !== i)]
}

export function removerFoto(fotos: Foto[], i: number): Foto[] {
  return fotos.filter((_, k) => k !== i)
}

/** URLs para o carrossel da vitrine: principal + extras, sem repetir. */
export function fotosDaVitrine(item: { imagemUrl: string | null; imagensExtras?: Foto[] | null }): string[] {
  const urls = [item.imagemUrl, ...(item.imagensExtras ?? []).map((e) => e?.url)].filter((u): u is string => typeof u === 'string' && !!u)
  return [...new Set(urls)]
}

/** null = arquivo aceito. */
export function validarArquivoFoto(arq: { type: string; size: number }): string | null {
  if (!/^image\//.test(arq.type)) return 'Envie uma imagem (JPG, PNG ou WebP).'
  if (arq.size > TAMANHO_MAX_BYTES) return 'Imagem muito grande (máximo 15 MB). Use uma foto menor.'
  return null
}
