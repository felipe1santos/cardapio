import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { marcarPedidoImpresso } from '@/lib/queries/impressao'
import { lerAgenteToken } from '@/lib/agente-token'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { ehUuid } from '@/lib/pdv-v2'

/** Chamado pelo agente desktop depois de imprimir o recibo, pra não imprimir o mesmo pedido de novo. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ehUuid(id)) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })

  // Token pode vir no header (Authorization: Bearer) ou no corpo (agentes antigos).
  let requisicao = request
  if (!lerAgenteToken(request)) {
    let token: string | null = null
    try {
      const body = (await request.json()) as { token?: string }
      token = body.token ?? null
    } catch {
      /* sem corpo — segue com token nulo */
    }
    if (!token) return NextResponse.json({ error: 'Token ausente' }, { status: 400 })
    requisicao = new Request(request.url, { headers: { Authorization: `Bearer ${token}` } })
  }

  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, requisicao)
  if (!quem) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  await marcarPedidoImpresso(admin, id, quem.restauranteId)
  return NextResponse.json({ ok: true })
}
