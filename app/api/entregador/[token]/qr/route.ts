import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEntregadorPorToken } from '@/lib/queries/pedidos'
import { lerQrDaEntrega } from '@/lib/motoboy/servico'

/** Portal do motoboy (token): leu o QR da comanda (item 59). Regras em lib/motoboy/servico. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()
  const entregador = await buscarEntregadorPorToken(admin, token).catch(() => null)
  if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const r = await lerQrDaEntrega(admin, entregador, corpo?.texto)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...(r.dados ?? {}) })
}
