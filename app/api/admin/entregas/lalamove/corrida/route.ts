import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { buscarConfig, buscarCorrida } from '@/lib/entregas/queries'
import { cancelarPeloMenuzia, erroEntrega, sincronizarCorrida } from '@/lib/entregas/lalamove-servidor'

/** O Kanban pergunta se o botão "Lalamove" deve aparecer (qualquer um que despacha; sem segredo na resposta). */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ ativo: false }, { headers: { 'Cache-Control': 'no-store' } })
  const cfg = await buscarConfig(getAdminSupabase(), sessao.restauranteId).catch(() => null)
  return NextResponse.json({ ativo: !!cfg?.ativo && !!cfg.chaves, ambiente: cfg?.ambiente ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Ações sobre uma corrida (quem despacha):
 *   POST { acao: 'cancelar', corridaId }  → cancela na Lalamove (só enquanto ela permite; senão 409 com a explicação)
 *   POST { acao: 'atualizar', corridaId } → consulta a corrida na API e aplica ao pedido (quando um webhook se perde).
 *                                           Botão manual, nunca em intervalo.
 */
export async function POST(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Você não tem permissão para despachar pedidos.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { acao?: unknown; corridaId?: unknown } | null
  const corridaId = typeof corpo?.corridaId === 'string' ? corpo.corridaId : ''
  if (!/^[0-9a-f-]{36}$/i.test(corridaId)) return NextResponse.json({ error: 'corridaId inválido.' }, { status: 400 })
  const admin = getAdminSupabase()
  try {
    const corrida = await buscarCorrida(admin, corridaId)
    if (!corrida || corrida.restauranteId !== sessao.restauranteId) return NextResponse.json({ error: 'Corrida não encontrada.' }, { status: 404 })
    if (corpo?.acao === 'cancelar') {
      await cancelarPeloMenuzia(admin, sessao.restauranteId, corrida, { id: sessao.userId, nome: sessao.nome })
      return NextResponse.json({ ok: true, status: 'CANCELED' })
    }
    if (corpo?.acao === 'atualizar') {
      const cfg = await buscarConfig(admin, sessao.restauranteId)
      if (!cfg?.chaves) return NextResponse.json({ error: 'Lalamove sem chaves nesta loja.' }, { status: 400 })
      return NextResponse.json({ ok: true, ...(await sincronizarCorrida(admin, cfg, corrida, 'painel')) })
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  } catch (e) {
    const { mensagem, status } = erroEntrega(e)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
