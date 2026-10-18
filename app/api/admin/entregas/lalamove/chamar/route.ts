import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { chamarLalamove, erroEntrega } from '@/lib/entregas/lalamove-servidor'
import type { RespostaCotacao } from '@/lib/entregas/lalamove-regras'

/**
 * Confirma a cotação mostrada e cria a corrida na Lalamove (a única chamada que gera cobrança para a loja). Exige a
 * cotação que o lojista viu (quotationId + stopIds); a Lalamove honra o preço por 5 minutos.
 *   POST { pedidoId, cotacao: { quotationId, preco, moeda, distanciaM, expiraEm, paradas } } → corrida
 */
export async function POST(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Você não tem permissão para despachar pedidos.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { pedidoId?: unknown; cotacao?: Partial<RespostaCotacao> } | null
  const pedidoId = typeof corpo?.pedidoId === 'string' ? corpo.pedidoId : ''
  const c = corpo?.cotacao
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId) || !c || typeof c.quotationId !== 'string' || typeof c.preco !== 'number' || !Array.isArray(c.paradas)) {
    return NextResponse.json({ error: 'Cotação inválida. Cote de novo.' }, { status: 400 })
  }
  const cotacao: RespostaCotacao = {
    quotationId: c.quotationId, preco: c.preco, moeda: typeof c.moeda === 'string' ? c.moeda : 'BRL', distanciaM: typeof c.distanciaM === 'number' ? c.distanciaM : null,
    expiraEm: typeof c.expiraEm === 'string' ? c.expiraEm : null, paradas: c.paradas.filter((p): p is string => typeof p === 'string'),
  }
  try {
    const corrida = await chamarLalamove(getAdminSupabase(), sessao.restauranteId, pedidoId, cotacao, { id: sessao.userId, nome: sessao.nome })
    return NextResponse.json({ ok: true, corrida })
  } catch (e) {
    const { mensagem, status } = erroEntrega(e)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
