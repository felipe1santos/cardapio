import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode, podeNotificarCanal } from '@/lib/auth/permissoes'
import { aplicarSolicitacao, buscarSolicitacao, concluirSolicitacao, recusarSolicitacao } from '@/lib/pedidos/solicitacoes'

/**
 * Solicitação do cliente (robô/IA) sobre um pedido (Fase 2, 18/10) — decidida pela loja no card:
 *   POST { acao: 'aplicar', solicitacaoId }            → edita (proposta) ou cancela pela mesma regra do painel
 *   POST { acao: 'recusar', solicitacaoId, motivo? }   → avisa o cliente
 *   POST { acao: 'concluir', solicitacaoId }           → a loja fez à mão pelo lápis; só fecha
 * Quem decide: quem despacha (dono, gerente, atendente, logística). Cancelar exige a permissão de cancelar.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { acao?: string; solicitacaoId?: string; motivo?: string } | null
  if (!corpo || typeof corpo.solicitacaoId !== 'string') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const s = await buscarSolicitacao(admin, corpo.solicitacaoId)
  if (!s || s.restauranteId !== sessao.restauranteId || s.pedidoId !== id) return NextResponse.json({ error: 'Solicitação não encontrada.' }, { status: 404 })
  const por = { id: sessao.userId, nome: sessao.nome }
  if (corpo.acao === 'aplicar') {
    if (s.tipo === 'cancelar' && !pode(sessao.papel, 'pedidos.delivery.cancelar')) return NextResponse.json({ error: 'Sem permissão para cancelar.' }, { status: 403 })
    const r = await aplicarSolicitacao(admin, s, por)
    if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
    return NextResponse.json({ ok: true, mudancas: r.mudancas })
  }
  if (corpo.acao === 'recusar') { await recusarSolicitacao(admin, s, por, typeof corpo.motivo === 'string' && corpo.motivo.trim() ? corpo.motivo.trim() : null); return NextResponse.json({ ok: true }) }
  if (corpo.acao === 'concluir') { await concluirSolicitacao(admin, s, por); return NextResponse.json({ ok: true }) }
  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
}
