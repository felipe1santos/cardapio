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
    // Despacho é só da cozinha completa (a tela das outras nem mostra).
    if (estacao.modo !== 'completa') return NextResponse.json({ error: 'Esta estação não despacha rotas' }, { status: 403 })

    const desde = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
    const [rotas, entregadores] = await Promise.all([
      listarPedidosRotas(admin, estacao.restauranteId, desde),
      listarEntregadores(admin, estacao.restauranteId),
    ])
    // Sem o token do entregador: com ele, quem tem o link da cozinha abria o app do
    // entregador (pegar pedido, marcar entregue, cancelar como "não entregue").
    return NextResponse.json({ rotas, entregadores: entregadores.map((e) => ({ ...e, token: undefined })) })
  } catch {
    return NextResponse.json({ error: 'Erro ao carregar o despacho' }, { status: 500 })
  }
}
