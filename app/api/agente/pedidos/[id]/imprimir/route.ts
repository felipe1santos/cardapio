import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { marcarPedidoImpresso, resolverRestauranteIdPorToken } from '@/lib/queries/impressao'
import { lerAgenteToken } from '@/lib/agente-token'

/** Chamado pelo agente desktop depois de imprimir o recibo, pra não imprimir o mesmo pedido de novo. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Token pode vir no header (Authorization: Bearer) ou no corpo (agentes antigos).
  let token = lerAgenteToken(request)
  if (!token) {
    try {
      const body = (await request.json()) as { token?: string }
      token = body.token ?? null
    } catch {
      /* sem corpo — segue com token nulo */
    }
  }
  if (!token) return NextResponse.json({ error: 'Token ausente' }, { status: 400 })

  const admin = getAdminSupabase()
  const restauranteId = await resolverRestauranteIdPorToken(admin, token)
  if (!restauranteId) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  await marcarPedidoImpresso(admin, id, restauranteId)
  return NextResponse.json({ ok: true })
}
