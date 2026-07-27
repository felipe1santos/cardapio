import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { motivoValido, STATUS_NAO_CANCELAVEIS } from '@/lib/cancelamento'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const motivo = body?.motivo
  const observacao = typeof body?.observacao === 'string' ? body.observacao.trim() : ''

  if (!motivoValido(motivo)) {
    return NextResponse.json({ error: 'Motivo de cancelamento inválido.' }, { status: 400 })
  }
  if (motivo === 'outro' && !observacao) {
    return NextResponse.json({ error: 'Descreva o motivo do cancelamento.' }, { status: 400 })
  }

  const { data: auth } = await session.auth.getUser()
  const admin = getAdminSupabase()

  // A guarda de status vive aqui, não na UI: o botão some para pedido entregue, mas
  // dois operadores em telas diferentes podem colidir. `reimprimir = false` impede que
  // um pedido cancelado com reimpressão pendente ainda saia na impressora — a fila do
  // agente casa `reimprimir = true` em qualquer status.
  const { data, error } = await admin
    .from('pedidos')
    .update({
      status: 'cancelado',
      cancelado_motivo: motivo,
      cancelado_observacao: observacao || null,
      cancelado_por: auth?.user?.email ?? null,
      cancelado_em: new Date().toISOString(),
      reimprimir: false,
    })
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
    .not('status', 'in', `(${STATUS_NAO_CANCELAVEIS.join(',')})`)
    .select('id')

  if (error) {
    return NextResponse.json({ error: 'Erro ao cancelar pedido.' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Pedido já finalizado ou cancelado.' }, { status: 409 })
  }

  reverterBeneficiosPedidoCancelado(admin, restauranteId, id).catch(console.error)
  return NextResponse.json({ ok: true })
}
