import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEntregadorPorToken, contarEntregasConcluidasHoje, listarPedidosEmRotaDoEntregador } from '@/lib/queries/pedidos'

function inicioDoDiaISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}

/** Portal do motoboy: dados do entregador + rota atual, por token público. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()

  try {
    const entregador = await buscarEntregadorPorToken(admin, token)
    if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

    const [pedidos, concluidosHoje] = await Promise.all([
      listarPedidosEmRotaDoEntregador(admin, entregador.id),
      contarEntregasConcluidasHoje(admin, entregador.id, inicioDoDiaISO()),
    ])

    return NextResponse.json({
      entregador: { nome: entregador.nome, restauranteNome: entregador.restauranteNome },
      pedidos,
      concluidosHoje,
    })
  } catch {
    return NextResponse.json({ error: 'Erro ao carregar a rota' }, { status: 500 })
  }
}
