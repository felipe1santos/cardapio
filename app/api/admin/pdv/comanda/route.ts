import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { listarMesasComEstado, listarPedidosDaComanda } from '@/lib/queries/comandas'
import { ehUuid } from '@/lib/pdv-v2'

/**
 * Leitura do PDV: mapa de mesas (sem parâmetro) ou pedidos de uma comanda
 * (`?comandaId=`). Também diz à tela se a loja está no PDV v2 (`pdvV2`) — a tela
 * escolhe o fluxo por aqui, nunca por algo que o navegador guarde.
 */
export async function GET(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'pedidos.balcao.criar')) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const admin = getAdminSupabase()
  const restauranteId = sessao.restauranteId
  const comandaId = new URL(request.url).searchParams.get('comandaId')

  try {
    if (comandaId) {
      if (!ehUuid(comandaId)) return NextResponse.json({ error: 'Conta inválida' }, { status: 400 })
      const pedidos = await listarPedidosDaComanda(admin, restauranteId, comandaId)
      return NextResponse.json({ pedidos })
    }
    const [mesas, { data: loja }] = await Promise.all([
      listarMesasComEstado(admin, restauranteId),
      admin.from('restaurantes').select('pdv_v2, modulo_mesas_ativo').eq('id', restauranteId).maybeSingle(),
    ])
    return NextResponse.json(
      { mesas, pdvV2: loja?.pdv_v2 === true, moduloMesas: loja?.modulo_mesas_ativo === true },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao carregar comandas'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
