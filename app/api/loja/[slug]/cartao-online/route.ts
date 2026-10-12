import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { cartaoOnlineDaLoja } from '@/lib/pagamentos/cartao-online'

export const dynamic = 'force-dynamic'

/**
 * A vitrine pergunta, ao abrir o checkout, se esta loja oferece cartão online AGORA (flag + conta do Mercado Pago
 * conectada com chave pública). Loja sem a flag: `{ ativo: false }` e nada muda. A chave pública vem só junto do pedido.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const admin = getAdminSupabase()
  const { data: loja } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (!loja) return NextResponse.json({ ativo: false })
  const r = await cartaoOnlineDaLoja(admin, loja.id).catch(() => ({ ativo: false, parcelasMax: 1 }))
  return NextResponse.json({ ativo: r.ativo, parcelasMax: r.parcelasMax }, { headers: { 'Cache-Control': 'no-store' } })
}
