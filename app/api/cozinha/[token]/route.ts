import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken, registrarHeartbeatEstacao } from '@/lib/queries/estacoes'
import { listarPedidosPorStatus } from '@/lib/queries/pedidos'
import { statusVisiveis } from '@/lib/cozinha/modo'
import { buscarFluxoLoja, FLUXO_LOJA_PADRAO, usaDespachoDeRotas } from '@/lib/queries/ajustes'

/** Portal da cozinha: pedidos visíveis para a estação, por token público (sem login). */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()

  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })

    await registrarHeartbeatEstacao(admin, estacao.id).catch(() => {})
    const [pedidos, fluxo] = await Promise.all([
      listarPedidosPorStatus(admin, estacao.restauranteId, statusVisiveis(estacao.modo)),
      buscarFluxoLoja(admin, estacao.restauranteId).catch(() => FLUXO_LOJA_PADRAO),
    ])

    return NextResponse.json({
      estacao: { nome: estacao.nome, modo: estacao.modo, restauranteNome: estacao.restauranteNome },
      despachoRotas: usaDespachoDeRotas(fluxo),
      pedidos,
    })
  } catch {
    return NextResponse.json({ error: 'Erro ao carregar a estação' }, { status: 500 })
  }
}
