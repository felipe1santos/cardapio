import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken } from '@/lib/queries/estacoes'
import { atribuirEntregadorEmLoteSeguro } from '@/lib/queries/pedidos'
import { buscarFluxoLoja, usaDespachoDeRotas } from '@/lib/queries/ajustes'
import { aplicarEfeitosStatusPedidoComTrava } from '@/lib/pedido-eventos'

/** Despacha (atribui entregador) pedidos prontos a partir da cozinha completa — token da estação. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()

  const body = await request.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : []
  const entregadorId = typeof body.entregadorId === 'string' ? body.entregadorId : ''
  if (ids.length === 0 || !entregadorId) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })

  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })
    if (estacao.modo !== 'completa') return NextResponse.json({ error: 'Esta estação não despacha rotas' }, { status: 403 })

    if (!usaDespachoDeRotas(await buscarFluxoLoja(admin, estacao.restauranteId))) {
      return NextResponse.json({ error: 'Esta loja não trabalha com motoboy: o despacho de rotas está desligado.' }, { status: 409 })
    }
    const feitos = await atribuirEntregadorEmLoteSeguro(admin, estacao.restauranteId, ids, entregadorId)
    // "Saiu para entrega" no servidor: a estação entra por token, sem sessão, e o aviso
    // pelo navegador (/api/pedidos/[id]/notificar) respondia 401 calado — o cliente
    // nunca sabia que o pedido saiu.
    await Promise.all(feitos.map((id) => aplicarEfeitosStatusPedidoComTrava(admin, id, 'em_rota').catch(() => null)))
    return NextResponse.json({ ok: true, feitos })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível despachar os pedidos'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
