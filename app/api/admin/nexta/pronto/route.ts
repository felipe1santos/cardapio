import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { avisarPronto, NextaError } from '@/lib/nexta'
import { carregarConfigNexta, erroNexta } from '@/lib/nexta-servidor'
import { buscarNextaEntregaAtivaDoPedido } from '@/lib/queries/nexta'

/**
 * Avisa o Nexta que o pedido já pode ser coletado (`readyForPickup`).
 *
 * Só faz sentido porque enviamos `notifyReadyForPickup: true` na criação da entrega.
 */
export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let pedidoId: string
  try {
    pedidoId = ((await request.json()) as { pedidoId?: string }).pedidoId ?? ''
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  if (!pedidoId) return NextResponse.json({ error: 'pedidoId é obrigatório' }, { status: 400 })

  const admin = getAdminSupabase()
  try {
    const cfg = await carregarConfigNexta(admin, restauranteId)
    const entrega = await buscarNextaEntregaAtivaDoPedido(admin, pedidoId)
    if (!entrega || entrega.restauranteId !== restauranteId) {
      throw new NextaError('Este pedido não tem uma entrega ativa no Nexta.', 404, null)
    }

    await avisarPronto(cfg, entrega.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const { mensagem, status } = erroNexta(err)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
