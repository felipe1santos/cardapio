import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { criarPedido, type NovoPedidoInput } from '@/lib/queries/pedidos'

export async function POST(request: Request) {
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  let body: NovoPedidoInput
  try {
    body = (await request.json()) as NovoPedidoInput
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  // Força a origem PDV no servidor (o cliente não decide isso).
  const input: NovoPedidoInput = { ...body, origem: 'pdv', tipo: 'retirada' }

  const admin = getAdminSupabase()
  try {
    const pedido = await criarPedido(admin, restauranteId, input)
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
