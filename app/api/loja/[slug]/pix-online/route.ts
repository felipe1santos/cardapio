import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { pixOnlineDaLoja } from '@/lib/pagamentos/pix-online'

export const dynamic = 'force-dynamic'

/**
 * A vitrine pergunta, ao abrir o checkout, se esta loja oferece o Pix online AGORA (flag + conta do
 * Mercado Pago conectada + servidor configurado). Loja sem a flag: `{ ativo: false }` e nada muda.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const admin = getAdminSupabase()
  const { data: loja } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (!loja) return NextResponse.json({ ativo: false })
  const r = await pixOnlineDaLoja(admin, loja.id).catch(() => ({ ativo: false, validadeMin: 15 }))
  return NextResponse.json({ ativo: r.ativo, validadeMin: r.validadeMin }, { headers: { 'Cache-Control': 'no-store' } })
}
