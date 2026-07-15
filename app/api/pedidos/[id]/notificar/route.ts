import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { notificarPedido } from '@/lib/whatsapp'
import { marcarPreparandoNotificado } from '@/lib/queries/pedidos'
import type { StatusPedido } from '@/lib/queries/pedidos'
import { processarFidelidadePedidoEntregue } from '@/lib/fidelidade'

const STATUS_NOTIFICAVEIS: StatusPedido[] = ['recebido', 'preparando', 'pronto', 'em_rota', 'entregue']

/** Envia a notificação de WhatsApp correspondente à nova etapa do pedido. Fogo-e-esquece: chamado pelo painel após avançar o status. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: { status?: StatusPedido }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  if (!body.status || !STATUS_NOTIFICAVEIS.includes(body.status)) {
    return NextResponse.json({ error: 'Status não notificável' }, { status: 400 })
  }

  const admin = getAdminSupabase()
  try {
    // "Em preparo" só sai uma vez por pedido (idempotente entre Kanban e cozinha).
    if (body.status === 'preparando' && !(await marcarPreparandoNotificado(admin, id))) {
      return NextResponse.json({ ok: true, jaNotificado: true })
    }
    await notificarPedido(admin, id, body.status)

    // Esta rota não tem autenticação (qualquer pedidoId pode ser enviado no body). O motor de
    // fidelidade só é inerte a abuso porque ele mesmo checa `status='entregue'` no banco antes
    // de fazer qualquer coisa (ver marcarPedidoFidelidadeProcessado) — aqui só evitamos a query
    // extra de restaurante_id quando nem o status pedido bate com 'entregue'.
    if (body.status === 'entregue') {
      const { data: pedidoRow } = await admin.from('pedidos').select('restaurante_id').eq('id', id).maybeSingle()
      if (pedidoRow) {
        processarFidelidadePedidoEntregue(admin, pedidoRow.restaurante_id, id).catch((err) => console.error('[fidelidade]', err))
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp] erro ao notificar pedido', err)
    return NextResponse.json({ error: 'Erro ao notificar' }, { status: 500 })
  }
}
