import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEntregadorPorToken, marcarEntregaComProblema } from '@/lib/queries/pedidos'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { aplicarEfeitosStatusPedidoComTrava } from '@/lib/pedido-eventos'

/** Motoboy sinaliza que não conseguiu entregar um pedido da sua rota — sem login, validado pelo token. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const admin = getAdminSupabase()

  try {
    const entregador = await buscarEntregadorPorToken(admin, token)
    if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

    await marcarEntregaComProblema(admin, id, entregador.id, entregador.nome)
    reverterBeneficiosPedidoCancelado(admin, entregador.restauranteId, id).catch(console.error)
    // Aviso de cancelado ao cliente, como no "Não entregue" da Logística (o app do
    // entregador não tem sessão para chamar o aviso pelo navegador).
    await aplicarEfeitosStatusPedidoComTrava(admin, id, 'cancelado').catch(console.error)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível atualizar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
