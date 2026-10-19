import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { buscarCorrida } from '@/lib/entregas/queries'
import { erroEntrega } from '@/lib/entregas/lalamove-servidor'
import { cancelarProvedor, ehProvedorNovo } from '@/lib/entregas/provedores'

/**
 * Ações sobre uma corrida do iFood/Foody (quem despacha):
 *   POST { acao: 'cancelar', corridaId }  → cancela no provedor (enquanto ele permite)
 *   POST { acao: 'atualizar', corridaId } → devolve o estado atual (o status vem por webhook/polling; sem consulta paga)
 */
export async function POST(request: Request, { params }: { params: Promise<{ provedor: string }> }) {
  const { provedor } = await params
  if (!ehProvedorNovo(provedor)) return NextResponse.json({ error: 'Provedor inválido.' }, { status: 404 })
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Você não tem permissão para despachar pedidos.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { acao?: unknown; corridaId?: unknown } | null
  const corridaId = typeof corpo?.corridaId === 'string' ? corpo.corridaId : ''
  if (!/^[0-9a-f-]{36}$/i.test(corridaId)) return NextResponse.json({ error: 'corridaId inválido.' }, { status: 400 })
  const admin = getAdminSupabase()
  try {
    const corrida = await buscarCorrida(admin, corridaId)
    if (!corrida || corrida.restauranteId !== sessao.restauranteId || corrida.provedor !== provedor) return NextResponse.json({ error: 'Corrida não encontrada.' }, { status: 404 })
    if (corpo?.acao === 'cancelar') {
      await cancelarProvedor(admin, sessao.restauranteId, corrida, { id: sessao.userId, nome: sessao.nome })
      return NextResponse.json({ ok: true, status: 'CANCELED' })
    }
    if (corpo?.acao === 'atualizar') return NextResponse.json({ ok: true, status: corrida.status, mudou: false })
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  } catch (e) {
    const { mensagem, status } = erroEntrega(e)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
