import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEntregadorPorToken } from '@/lib/queries/pedidos'
import { acaoNoPedido } from '@/lib/motoboy/servico'

/** Portal do motoboy (token): "saiu". Regras em lib/motoboy/servico — iguais às do app com login. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const admin = getAdminSupabase()
  const entregador = await buscarEntregadorPorToken(admin, token).catch(() => null)
  if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const r = await acaoNoPedido(admin, entregador, id, 'saiu', corpo)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...(r.dados ?? {}) })
}
