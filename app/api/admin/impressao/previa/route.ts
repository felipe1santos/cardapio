import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import { COLUNAS_LOJA_IMPRESSAO, dadosLojaImpressao, qrDaCozinha } from '@/lib/impressao/cozinha-beta'
import { BUCKET, caminhoLogoDaLoja, caminhoLogoImpressao, chaveLogo } from '@/lib/impressao/logo-loja'

/**
 * Pré-visualização do Assistente Beta: nome/telefone/endereço da loja, o QR do rodapé
 * (Instagram da loja ou cardápio) e a logo — os mesmos que o servidor manda para o Beta.
 * Logo: a versão de impressão (PNG sobre branco) quando já existe; senão, a logo da loja.
 * Só leitura.
 */
export async function GET() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const { data } = await ctx.admin.from('restaurantes').select(`slug, instagram_url, logo_url, ${COLUNAS_LOJA_IMPRESSAO}`).eq('id', ctx.op.restauranteId).maybeSingle()
  const loja = data as (Record<string, unknown> & { slug: string; instagram_url: string | null; logo_url: string | null }) | null
  let qr: ReturnType<typeof qrDaCozinha> | null = null
  if (loja?.slug) {
    try { qr = qrDaCozinha({ slug: loja.slug, instagramUrl: loja.instagram_url ?? null }) } catch { qr = null }
  }
  let logoUrl: string | null = null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (loja?.logo_url && caminhoLogoDaLoja(loja.logo_url, base, ctx.op.restauranteId)) {
    logoUrl = loja.logo_url
    const caminho = caminhoLogoImpressao(ctx.op.restauranteId, chaveLogo(loja.logo_url))
    const pasta = caminho.slice(0, caminho.lastIndexOf('/'))
    const { data: arquivos } = await ctx.admin.storage.from(BUCKET).list(pasta, { limit: 20 })
    if ((arquivos ?? []).some((f) => `${pasta}/${f.name}` === caminho)) logoUrl = `${base}/storage/v1/object/public/${BUCKET}/${caminho}`
  }
  return NextResponse.json({ loja: dadosLojaImpressao(loja), qr, logoUrl }, { headers: semCache })
}
