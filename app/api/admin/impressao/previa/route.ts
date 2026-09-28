import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import { qrDaCozinha } from '@/lib/impressao/cozinha-beta'

/**
 * Pré-visualização do Assistente Beta: nome da loja e o QR do rodapé (Instagram da loja
 * ou cardápio) — o mesmo QR que o servidor manda para o Beta. Só leitura.
 */
export async function GET() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const { data } = await ctx.admin.from('restaurantes').select('nome, slug, instagram_url').eq('id', ctx.op.restauranteId).maybeSingle()
  const loja = data as { nome: string; slug: string; instagram_url: string | null } | null
  let qr: ReturnType<typeof qrDaCozinha> | null = null
  if (loja?.slug) {
    try { qr = qrDaCozinha({ slug: loja.slug, instagramUrl: loja.instagram_url ?? null }) } catch { qr = null }
  }
  return NextResponse.json({ loja: loja?.nome ?? '', qr }, { headers: semCache })
}
