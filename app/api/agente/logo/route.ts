import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { BUCKET, LOGO_MAX_BYTES, caminhoLogoDaLoja, caminhoLogoImpressao, chaveLogo, tipoImagem, webpComTransparencia } from '@/lib/impressao/logo-loja'

/**
 * Logo da loja para o Recibo/Extrato do Assistente Beta (computador pareado).
 * Lida pela API do Storage, só na pasta da própria loja (logo-loja.ts) — nenhuma URL é
 * buscada. 200 = bytes + X-Logo-Sha256; 304 = o Assistente já tem esta (?sha=);
 * 204 = sem logo utilizável (o Recibo/Extrato sai com o nome da loja).
 */
const TIPO_MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' } as const

export async function GET(request: Request) {
  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, request)
  if (!quem) return NextResponse.json({ error: 'Credencial inválida' }, { status: 401 })
  if (quem.tipo !== 'agente') return NextResponse.json({ error: 'Só para computador pareado.' }, { status: 403 })
  const { data: loja } = await admin.from('restaurantes').select('logo_url').eq('id', quem.restauranteId).maybeSingle()
  const logoUrl = (loja?.logo_url as string | null) ?? null
  const original = caminhoLogoDaLoja(logoUrl, process.env.NEXT_PUBLIC_SUPABASE_URL, quem.restauranteId)
  if (!logoUrl || !original) return new NextResponse(null, { status: 204 })

  const baixar = async (caminho: string) => {
    const { data, error } = await admin.storage.from(BUCKET).download(caminho)
    if (error || !data) return null
    const bytes = new Uint8Array(await data.arrayBuffer())
    return bytes.length > 0 && bytes.length <= LOGO_MAX_BYTES ? bytes : null
  }
  // 1) versão de impressão (PNG sobre branco) da logo ATUAL; 2) a própria logo, se o
  // Windows souber desenhá-la sem perder a transparência.
  let bytes = await baixar(caminhoLogoImpressao(quem.restauranteId, chaveLogo(logoUrl)))
  if (!bytes || tipoImagem(bytes) !== 'png') {
    bytes = await baixar(original)
    if (!bytes || !tipoImagem(bytes) || webpComTransparencia(bytes)) return new NextResponse(null, { status: 204 })
  }
  const sha = createHash('sha256').update(bytes).digest('hex')
  const cabecalhos = { 'X-Logo-Sha256': sha, 'Cache-Control': 'no-store' }
  if (new URL(request.url).searchParams.get('sha') === sha) return new NextResponse(null, { status: 304, headers: cabecalhos })
  return new NextResponse(bytes, { status: 200, headers: { ...cabecalhos, 'Content-Type': TIPO_MIME[tipoImagem(bytes)!] } })
}
