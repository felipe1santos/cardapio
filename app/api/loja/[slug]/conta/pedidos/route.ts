import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarClientePorToken, buscarRestauranteIdPorSlug } from '@/lib/queries/clientes'
import { listarPedidosDoCliente } from '@/lib/queries/pedidos'

/** Histórico + acompanhamento dos pedidos do cliente logado (telefone + token salvos no navegador). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(request.url)
    const telefone = searchParams.get('telefone')
    const token = searchParams.get('token')
    if (!telefone || !token) return NextResponse.json({ error: 'Sessão inválida' }, { status: 400 })

    const admin = getAdminSupabase()
    const restauranteId = await buscarRestauranteIdPorSlug(admin, slug)
    if (!restauranteId) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

    const cliente = await buscarClientePorToken(admin, restauranteId, telefone, token)
    if (!cliente) return NextResponse.json({ error: 'Sessão inválida' }, { status: 401 })

    const pedidos = await listarPedidosDoCliente(admin, restauranteId, cliente.telefone)
    return NextResponse.json(pedidos)
  } catch (err) {
    console.error('[conta/pedidos] GET erro inesperado:', err)
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}
