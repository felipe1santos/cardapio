import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEntregadorPorToken, registrarPresencaEntregador } from '@/lib/queries/pedidos'

/** Heartbeat do portal do motoboy: marca presença online e atualiza localização — sem login, validado pelo token. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()

  try {
    const entregador = await buscarEntregadorPorToken(admin, token)
    if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const lat = typeof body.lat === 'number' ? body.lat : null
    const lng = typeof body.lng === 'number' ? body.lng : null

    await registrarPresencaEntregador(admin, entregador.id, lat, lng)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar presença' }, { status: 400 })
  }
}
