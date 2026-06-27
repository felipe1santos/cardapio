import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken } from '@/lib/queries/estacoes'
import { atribuirEntregadorEmLoteSeguro } from '@/lib/queries/pedidos'

/** Despacha (atribui entregador) pedidos prontos a partir da cozinha completa — token da estação. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()

  const body = await request.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : []
  const entregadorId = typeof body.entregadorId === 'string' ? body.entregadorId : ''
  if (ids.length === 0 || !entregadorId) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })

  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })

    await atribuirEntregadorEmLoteSeguro(admin, estacao.restauranteId, ids, entregadorId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível despachar os pedidos'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
