/**
 * Logo de impressão gerada NO NAVEGADOR do dono/gerente (a página Impressão chama sozinha).
 *
 * O navegador decodifica a logo da loja com transparência (WebP/PNG) e a desenha sobre
 * fundo branco, num PNG de até 640×320 — nunca ampliada. O Windows do Assistente não
 * precisa entender WebP com transparência (o decodificador dele deixa o fundo preto).
 * O servidor valida o PNG e grava no caminho fixo da loja (/api/admin/impressao/logo).
 */
export const LOGO_IMPRESSAO_LARGURA = 640
export const LOGO_IMPRESSAO_ALTURA = 320

export async function gerarLogoImpressao(logoUrl: string): Promise<Blob | null> {
  const res = await fetch(logoUrl, { cache: 'no-store' })
  if (!res.ok) return null
  const img = await createImageBitmap(await res.blob())
  const esc = Math.min(1, LOGO_IMPRESSAO_LARGURA / img.width, LOGO_IMPRESSAO_ALTURA / img.height)
  const w = Math.max(8, Math.round(img.width * esc))
  const h = Math.max(8, Math.round(img.height * esc))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  img.close()
  return new Promise((ok) => canvas.toBlob((b) => ok(b), 'image/png'))
}

/** Garante a logo de impressão da logo ATUAL (gera só se ainda não existir). */
export async function garantirLogoImpressao(logoUrl: string): Promise<'pronta' | 'gerada' | 'sem_logo' | 'falhou'> {
  try {
    const s = await fetch('/api/admin/impressao/logo', { cache: 'no-store' })
    if (!s.ok) return 'falhou'
    const { temLogo, pronta } = (await s.json()) as { temLogo: boolean; pronta: boolean }
    if (!temLogo) return 'sem_logo'
    if (pronta) return 'pronta'
    const png = await gerarLogoImpressao(logoUrl)
    if (!png) return 'falhou'
    const r = await fetch('/api/admin/impressao/logo', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })
    return r.ok ? 'gerada' : 'falhou'
  } catch {
    return 'falhou'
  }
}
