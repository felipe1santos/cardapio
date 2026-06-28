import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { criarPedido, type NovoPedidoInput } from '@/lib/queries/pedidos'
import { abrirOuObterComanda } from '@/lib/queries/comandas'

interface PdvPedidoBody extends NovoPedidoInput {
  /** Id da mesa (transporte) — usado p/ resolver a comanda; não vai pro pedido. */
  mesaId?: string
}

export async function POST(request: Request) {
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  let body: PdvPedidoBody
  try {
    body = (await request.json()) as PdvPedidoBody
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const { mesaId, ...rest } = body
  const admin = getAdminSupabase()

  try {
    // Mesa selecionada → agrupa numa comanda (find-or-create). Balcão fica avulso.
    let comandaId: string | undefined
    if (mesaId) {
      const comanda = await abrirOuObterComanda(admin, restauranteId, mesaId)
      comandaId = comanda.id
    }

    // Força a origem PDV no servidor (o cliente não decide isso).
    const input: NovoPedidoInput = { ...rest, origem: 'pdv', tipo: 'retirada', comandaId }

    const pedido = await criarPedido(admin, restauranteId, input)
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
