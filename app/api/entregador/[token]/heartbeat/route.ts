import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEntregadorPorToken } from '@/lib/queries/pedidos'
import { heartbeat } from '@/lib/motoboy/servico'

/** Heartbeat do portal do motoboy (token): presença online e localização. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()
  try {
    const entregador = await buscarEntregadorPorToken(admin, token)
    if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })
    await heartbeat(admin, entregador, (await request.json().catch(() => null)) as Record<string, unknown> | null)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar presença' }, { status: 400 })
  }
}
