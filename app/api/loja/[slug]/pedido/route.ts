import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { criarPedido, type NovoPedidoInput } from '@/lib/queries/pedidos'

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let body: NovoPedidoInput
  try {
    body = (await request.json()) as NovoPedidoInput
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const admin = getAdminSupabase()

  const { data: loja, error: lojaError } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (lojaError) return NextResponse.json({ error: 'Erro ao localizar a loja' }, { status: 500 })
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  try {
    const pedido = await criarPedido(admin, loja.id, body)
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
