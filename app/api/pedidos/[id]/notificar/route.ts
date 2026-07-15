import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { aplicarEfeitosStatusPedidoComTrava } from '@/lib/pedido-eventos'
import type { StatusPedido } from '@/lib/queries/pedidos'

const STATUS_NOTIFICAVEIS: StatusPedido[] = ['recebido', 'preparando', 'pronto', 'em_rota', 'entregue', 'cancelado']

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
    // WhatsApp + motor de fidelidade moram em lib/pedido-eventos.ts: o webhook do Nexta
    // também move o status do pedido (coleta/entrega) e precisa dos mesmos efeitos.
    // Esta rota não tem autenticação, mas os motores de fidelidade checam o status real
    // no banco antes de agir, então não viram vetor de abuso.
    const notificou = await aplicarEfeitosStatusPedidoComTrava(admin, id, body.status)
    return NextResponse.json(notificou ? { ok: true } : { ok: true, jaNotificado: true })
  } catch (err) {
    console.error('[whatsapp] erro ao notificar pedido', err)
    return NextResponse.json({ error: 'Erro ao notificar' }, { status: 500 })
  }
}
