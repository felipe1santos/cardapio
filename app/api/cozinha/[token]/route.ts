import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken, registrarHeartbeatEstacao } from '@/lib/queries/estacoes'
import { listarPedidosPorStatus } from '@/lib/queries/pedidos'
import { statusVisiveis } from '@/lib/cozinha/modo'

/** Portal da cozinha: pedidos visíveis para a estação, por token público (sem login). */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()

  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })

    await registrarHeartbeatEstacao(admin, estacao.id).catch(() => {})
    const pedidos = await listarPedidosPorStatus(admin, estacao.restauranteId, statusVisiveis(estacao.modo))

    return NextResponse.json({
      estacao: { nome: estacao.nome, modo: estacao.modo, restauranteNome: estacao.restauranteNome },
      pedidos,
    })
  } catch {
    return NextResponse.json({ error: 'Erro ao carregar a estação' }, { status: 500 })
  }
}
