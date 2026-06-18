import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { marcarPedidoImpresso, resolverRestauranteIdPorToken } from '@/lib/queries/impressao'

/** Chamado pelo agente desktop depois de imprimir o recibo, pra não imprimir o mesmo pedido de novo. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { token?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  if (!body.token) return NextResponse.json({ error: 'Token ausente' }, { status: 400 })

  const admin = getAdminSupabase()
  const restauranteId = await resolverRestauranteIdPorToken(admin, body.token)
  if (!restauranteId) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  await marcarPedidoImpresso(admin, id)
  return NextResponse.json({ ok: true })
}
