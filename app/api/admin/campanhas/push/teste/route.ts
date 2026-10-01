import { NextResponse } from 'next/server'
import { exigirPushLiberado, lojaDoPainel } from '@/lib/push/painel'
import { enviarTeste } from '@/lib/push/motor'

/** "Enviar notificação de teste para mim": só para os aparelhos do telefone de teste da loja. */
export async function POST(request: Request) {
  const c = await lojaDoPainel()
  if ('erro' in c) return c.erro
  const bloqueio = exigirPushLiberado(c.loja)
  if (bloqueio) return bloqueio
  const b = (await request.json().catch(() => ({}))) as { texto?: string }
  const r = await enviarTeste(c.admin, c.loja, typeof b.texto === 'string' ? b.texto.slice(0, 140) : undefined)
  if (!r.aparelhos) return NextResponse.json({ error: r.motivo }, { status: 409 })
  return NextResponse.json({ ok: true, aparelhos: r.aparelhos })
}
