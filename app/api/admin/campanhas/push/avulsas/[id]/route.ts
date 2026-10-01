import { NextResponse } from 'next/server'
import { lojaDoPainel } from '@/lib/push/painel'

/** Cancela uma avulsa que ainda não saiu (agendada). */
export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await lojaDoPainel()
  if ('erro' in c) return c.erro
  const { id } = await params
  const { data } = await c.admin.from('push_avulsas').update({ status: 'cancelada' }).eq('id', id).eq('restaurante_id', c.loja.id).eq('status', 'agendada').select('id')
  if (!data?.length) return NextResponse.json({ error: 'Só dá para cancelar notificação que ainda não saiu.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
