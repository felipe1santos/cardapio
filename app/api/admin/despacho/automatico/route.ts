import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { despachoAutomaticoLigado, despacharAutomaticamente } from '@/lib/motoboy/despacho-automatico'

/**
 * Despacho automático (item 61), da loja da sessão:
 *   GET                       → { ligado }
 *   POST { ligado: boolean }  → liga/desliga (auditado: loja.despacho_automatico); ligou → já despacha
 *   POST { acao: 'rodar' }    → despacha os prontos agora (o Kanban chama quando um pedido fica pronto)
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'logistica.operar')) return { erro: NextResponse.json({ error: 'Sem permissão.' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase() }
}

export async function GET() {
  const c = await contexto()
  if ('erro' in c) return c.erro
  return NextResponse.json({ ligado: await despachoAutomaticoLigado(c.admin, c.sessao.restauranteId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contexto()
  if ('erro' in c) return c.erro
  const { sessao, admin } = c
  const corpo = (await request.json().catch(() => null)) as { ligado?: unknown; acao?: unknown } | null
  if (corpo?.acao === 'rodar') {
    const r = await despacharAutomaticamente(admin, sessao.restauranteId)
    return NextResponse.json({ ok: true, ...r })
  }
  if (typeof corpo?.ligado !== 'boolean') return NextResponse.json({ error: 'Informe ligado: true/false.' }, { status: 400 })
  const antes = await despachoAutomaticoLigado(admin, sessao.restauranteId)
  if (antes !== corpo.ligado) {
    const { error } = await admin.from('restaurantes').update({ despacho_automatico: corpo.ligado }).eq('id', sessao.restauranteId)
    if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
    await registrarAuditoria(admin, {
      restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome, acao: 'loja.despacho_automatico',
      entidade: 'restaurante', entidadeId: sessao.restauranteId, dados: { de: antes, para: corpo.ligado },
    }).catch(() => {})
  }
  const r = corpo.ligado ? await despacharAutomaticamente(admin, sessao.restauranteId) : null
  return NextResponse.json({ ok: true, ligado: corpo.ligado, ...(r ? { despachados: r.despachados, semMotoboy: r.semMotoboy } : {}) })
}
