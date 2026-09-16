import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { criarPedido } from '@/lib/queries/pedidos'
import { montarPedidoPublico } from '@/lib/queries/pedido-publico'
import { notificarPedido } from '@/lib/whatsapp'

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let bruto: unknown
  try {
    bruto = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  // Nada de repassar o corpo inteiro: `origem`, `canal`, `comandaId` e companhia são
  // decisão do servidor. Ver lib/queries/pedido-publico.ts.
  const { ok, recusados, input } = montarPedidoPublico(bruto)
  if (!ok || !input) {
    if (recusados.length > 0) {
      // Registra a tentativa sem guardar o payload: só os nomes dos campos.
      console.warn('[seguranca] pedido público com campos internos recusado', { slug, campos: recusados })
      return NextResponse.json(
        { error: `Campos não aceitos neste endereço: ${recusados.join(', ')}` },
        { status: 422 },
      )
    }
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const admin = getAdminSupabase()

  const { data: loja, error: lojaError } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (lojaError) return NextResponse.json({ error: 'Erro ao localizar a loja' }, { status: 500 })
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  try {
    const pedido = await criarPedido(admin, loja.id, input)
    notificarPedido(admin, pedido.id, 'recebido').catch((err) => console.error('[whatsapp] erro ao notificar pedido recebido', err))
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
