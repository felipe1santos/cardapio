import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { erroEntrega } from '@/lib/entregas/lalamove-servidor'
import { cotarProvedor, ehProvedorNovo } from '@/lib/entregas/provedores'

/**
 * Cotação de UM pedido no entregador do iFood ou na Foody (Etapa 3). Só o clique em "Chamar" chega aqui — nunca em
 * render, lista ou intervalo (API paga: lib/custo). Não cria nada no provedor.
 *   POST { pedidoId } → { quotationId, preco, distanciaM, expiraEm, paradas, pedidoNumero, pagamentoNaEntrega, trocoPara, ambiente, prazoMin, provedor }
 */
export async function POST(request: Request, { params }: { params: Promise<{ provedor: string }> }) {
  const { provedor } = await params
  if (!ehProvedorNovo(provedor)) return NextResponse.json({ error: 'Provedor inválido.' }, { status: 404 })
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Você não tem permissão para despachar pedidos.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { pedidoId?: unknown } | null
  const pedidoId = typeof corpo?.pedidoId === 'string' ? corpo.pedidoId : ''
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return NextResponse.json({ error: 'pedidoId inválido.' }, { status: 400 })
  try {
    return NextResponse.json(await cotarProvedor(getAdminSupabase(), sessao.restauranteId, provedor, pedidoId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const { mensagem, status } = erroEntrega(e)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
