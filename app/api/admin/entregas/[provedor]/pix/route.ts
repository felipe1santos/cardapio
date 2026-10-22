import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { erroEntrega } from '@/lib/entregas/lalamove-servidor'
import { confirmarParceiroPix, iniciarPixParceiro, usarMotoboyProprio } from '@/lib/entregas/parceiro-pix-servidor'
import { NAO_RECEBE_NA_ENTREGA } from '@/lib/entregas/parceiro-pix'

export const dynamic = 'force-dynamic'

/**
 * Card do Kanban, parceiro que não recebe na entrega (21/10/2026):
 *   POST { acao: 'cobrar', pedidoId, preco }  → Pix do total pelo WhatsApp; pago, o parceiro é chamado sozinho
 *   POST { acao: 'motoboy', pedidoId }        → cancela o Pix e libera o pedido para o motoboy próprio
 *   POST { acao: 'confirmar', pedidoId }      → Pix pago e preço mudou (ou deu erro): cota e chama de novo
 */
export async function POST(request: Request, { params }: { params: Promise<{ provedor: string }> }) {
  const { provedor } = await params
  if (!NAO_RECEBE_NA_ENTREGA.has(provedor)) return NextResponse.json({ error: 'Provedor inválido.' }, { status: 404 })
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Você não tem permissão para despachar pedidos.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { acao?: unknown; pedidoId?: unknown; preco?: unknown } | null
  const pedidoId = typeof corpo?.pedidoId === 'string' ? corpo.pedidoId : ''
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
  const por = { id: sessao.userId, nome: sessao.nome }
  const admin = getAdminSupabase()
  try {
    if (corpo?.acao === 'cobrar') {
      const preco = Number(corpo.preco)
      if (!(preco > 0)) return NextResponse.json({ error: 'Cote antes de cobrar.' }, { status: 400 })
      await iniciarPixParceiro(admin, sessao.restauranteId, provedor, pedidoId, preco, por)
      return NextResponse.json({ ok: true, mensagem: 'Pix enviado ao cliente pelo WhatsApp. Assim que ele pagar, o entregador é chamado sozinho.' })
    }
    if (corpo?.acao === 'motoboy') { await usarMotoboyProprio(admin, sessao.restauranteId, pedidoId, por); return NextResponse.json({ ok: true, mensagem: 'Pix cancelado. Despache com o motoboy próprio.' }) }
    if (corpo?.acao === 'confirmar') { await confirmarParceiroPix(admin, sessao.restauranteId, pedidoId, por); return NextResponse.json({ ok: true, mensagem: 'Entregador chamado.' }) }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  } catch (e) {
    const { mensagem, status } = erroEntrega(e)
    return NextResponse.json({ error: mensagem }, { status: status === 207 ? 200 : status })
  }
}
