import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { cotarPedido, erroEntrega } from '@/lib/entregas/lalamove-servidor'

/**
 * Cotação da corrida de UM pedido (quem despacha: a mesma regra do Despachar). Só o clique em "Chamar Lalamove" chega
 * aqui — nunca em render, lista ou intervalo. Não cria nada na Lalamove.
 *   POST { pedidoId } → { quotationId, preco, moeda, distanciaM, expiraEm, paradas, pedidoNumero, pagamentoNaEntrega, trocoPara, ambiente }
 */
export async function POST(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Você não tem permissão para despachar pedidos.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { pedidoId?: unknown } | null
  const pedidoId = typeof corpo?.pedidoId === 'string' ? corpo.pedidoId : ''
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return NextResponse.json({ error: 'pedidoId inválido.' }, { status: 400 })
  try {
    return NextResponse.json(await cotarPedido(getAdminSupabase(), sessao.restauranteId, pedidoId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const { mensagem, status } = erroEntrega(e)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
