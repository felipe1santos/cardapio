import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { externoDoPedido } from '@/lib/canais/importar'
import { buscarConfigCanal } from '@/lib/canais/config'
import { motivosCancelamentoIfood } from '@/lib/canais/ifood/cliente'

/** Motivos de cancelamento que o iFood aceita para este pedido (a tela só chama ao abrir o cancelamento de pedido iFood). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'pedidos.delivery.cancelar')) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const admin = getAdminSupabase()
  const { data: ped } = await admin.from('pedidos').select('id').eq('id', id).eq('restaurante_id', sessao.restauranteId).maybeSingle()
  if (!ped) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 })
  const ext = await externoDoPedido(admin, id)
  if (ext?.canal !== 'ifood') return NextResponse.json({ motivos: [] })
  const cfg = await buscarConfigCanal(admin, sessao.restauranteId, 'ifood').catch(() => null)
  if (!cfg) return NextResponse.json({ motivos: [] })
  try {
    return NextResponse.json({ motivos: await motivosCancelamentoIfood(admin, cfg, ext.externoId) })
  } catch (e) {
    console.error('[motivos-app]', (e as Error).message?.slice(0, 160))
    return NextResponse.json({ motivos: [] })
  }
}
