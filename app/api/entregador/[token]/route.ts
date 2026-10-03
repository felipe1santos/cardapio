import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEntregadorPorToken } from '@/lib/queries/pedidos'
import { dadosDoPortal } from '@/lib/motoboy/servico'

/**
 * Portal do motoboy pelo link/QR (token). O mesmo serviço do app com login (lib/motoboy/servico).
 * Entregador desativado ou link trocado (0136): "Link inválido".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()
  try {
    const entregador = await buscarEntregadorPorToken(admin, token)
    if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })
    return NextResponse.json(await dadosDoPortal(admin, entregador), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Erro ao carregar a rota' }, { status: 500 })
  }
}
