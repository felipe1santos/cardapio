import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { criarPedido, type NovoPedidoInput } from '@/lib/queries/pedidos'
import { abrirOuObterComanda } from '@/lib/queries/comandas'
import { getCurrentSession } from '@/lib/auth/session'

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
      const { comanda } = await abrirOuObterComanda(admin, restauranteId, mesaId)
      comandaId = comanda.id
    }

    // Força no servidor tudo o que é decisão do servidor. O `...rest` vem do corpo, então
    // cada campo sensível é sobrescrito DEPOIS do espalhamento: origem, tipo, comanda,
    // canal (derivado de origem + comanda por `canalDoPedido`) e quem lançou (da sessão).
    const sessao = await getCurrentSession(session)
    const input: NovoPedidoInput = {
      ...rest,
      origem: 'pdv',
      tipo: 'retirada',
      comandaId,
      canal: undefined,
      criadoPor: sessao?.userId,
      criadoPorNome: sessao?.nome,
    }

    const pedido = await criarPedido(admin, restauranteId, input)
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
