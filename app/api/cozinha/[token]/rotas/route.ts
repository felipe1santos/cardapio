import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken } from '@/lib/queries/estacoes'
import { listarEntregadores, listarPedidosRotas } from '@/lib/queries/pedidos'

/** Dados do despacho de rotas para a cozinha completa (autenticado pelo token da estação). */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()
  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })

    const desde = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
    const [rotas, entregadores] = await Promise.all([
      listarPedidosRotas(admin, estacao.restauranteId, desde),
      listarEntregadores(admin, estacao.restauranteId),
    ])
    return NextResponse.json({ rotas, entregadores })
  } catch {
    return NextResponse.json({ error: 'Erro ao carregar o despacho' }, { status: 500 })
  }
}
