import { NextResponse } from 'next/server'
import { contextoSalao } from '@/lib/auth/salao'
import { listarTokensDasMesas } from '@/lib/queries/mesas'

/**
 * Tokens do QR das mesas — o único caminho pelo qual eles chegam ao navegador.
 *
 * Desde a 0071 o JWT do usuário não lê `mesas.token`: o garçom e o caixa enxergam as
 * mesas sem a credencial pública delas. Quem imprime e roda QR é a gestão, então esta
 * rota exige `mesas.gerenciar`, responde sem cache e não loga o conteúdo.
 *
 *   GET /api/admin/mesas/qr            → todas as mesas da loja
 *   GET /api/admin/mesas/qr?mesa=<id>  → uma mesa
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const ctx = await contextoSalao('mesas.gerenciar')
  if ('erro' in ctx) return ctx.erro

  const mesa = new URL(request.url).searchParams.get('mesa')
  if (mesa !== null && !UUID.test(mesa)) return NextResponse.json({ error: 'Mesa inválida' }, { status: 400 })

  const mesas = await listarTokensDasMesas(ctx.admin, ctx.sessao.restauranteId, mesa ?? undefined)
  if (mesa && mesas.length === 0) return NextResponse.json({ error: 'Mesa não encontrada nesta loja' }, { status: 404 })

  return NextResponse.json(
    // Mesa com QR revogado não devolve token: não há link válido para mostrar.
    { mesas: mesas.map((m) => ({ ...m, token: m.qrRevogado ? null : m.token })) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
