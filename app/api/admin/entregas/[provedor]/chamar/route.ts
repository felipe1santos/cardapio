import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { erroEntrega } from '@/lib/entregas/lalamove-servidor'
import { chamarProvedor, ehProvedorNovo } from '@/lib/entregas/provedores'
import type { RespostaCotacao } from '@/lib/entregas/lalamove-regras'

/**
 * Confirma a cotação e chama o entregador (iFood Sob Demanda ou Foody). O pedido continua "pronto" até o entregador
 * coletar (evento PICKED_UP → em rota), igual à Lalamove.
 *   POST { pedidoId, cotacao: { quotationId, preco, moeda, distanciaM, expiraEm, paradas } } → { corrida }
 */
export async function POST(request: Request, { params }: { params: Promise<{ provedor: string }> }) {
  const { provedor } = await params
  if (!ehProvedorNovo(provedor)) return NextResponse.json({ error: 'Provedor inválido.' }, { status: 404 })
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Você não tem permissão para despachar pedidos.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { pedidoId?: unknown; cotacao?: Partial<RespostaCotacao> } | null
  const pedidoId = typeof corpo?.pedidoId === 'string' ? corpo.pedidoId : ''
  const c = corpo?.cotacao
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId) || !c || typeof c.quotationId !== 'string' || typeof c.preco !== 'number' || !Array.isArray(c.paradas)) return NextResponse.json({ error: 'Cotação inválida. Cote de novo.' }, { status: 400 })
  if (c.expiraEm && Date.parse(c.expiraEm) < Date.now()) return NextResponse.json({ error: 'A cotação venceu. Cote de novo.' }, { status: 409 })
  const cotacao: RespostaCotacao = { quotationId: c.quotationId, preco: c.preco, moeda: c.moeda ?? 'BRL', distanciaM: typeof c.distanciaM === 'number' ? c.distanciaM : null, expiraEm: c.expiraEm ?? new Date().toISOString(), paradas: c.paradas as RespostaCotacao['paradas'] }
  try {
    const corrida = await chamarProvedor(getAdminSupabase(), sessao.restauranteId, provedor, pedidoId, cotacao, { id: sessao.userId, nome: sessao.nome })
    return NextResponse.json({ ok: true, corrida })
  } catch (e) {
    const { mensagem, status } = erroEntrega(e)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
