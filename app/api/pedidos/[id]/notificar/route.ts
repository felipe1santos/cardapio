import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { notificarPedido } from '@/lib/whatsapp'
import type { StatusPedido } from '@/lib/queries/pedidos'

const STATUS_NOTIFICAVEIS: StatusPedido[] = ['recebido', 'preparando', 'pronto', 'em_rota']

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
    await notificarPedido(admin, id, body.status)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[whatsapp] erro ao notificar pedido', err)
    return NextResponse.json({ error: 'Erro ao notificar' }, { status: 500 })
  }
}
