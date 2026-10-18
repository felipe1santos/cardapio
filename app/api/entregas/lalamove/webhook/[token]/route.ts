import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigPorToken } from '@/lib/entregas/queries'
import { orderIdDoWebhook, tipoDoWebhook } from '@/lib/entregas/lalamove-regras'
import { processarWebhook } from '@/lib/entregas/lalamove-servidor'

/**
 * Webhook da Lalamove (0199). Sem polling: a Lalamove avisa aqui a cada mudança (ORDER_STATUS_CHANGED, DRIVER_ASSIGNED…).
 * Duas camadas antes de tocar no pedido (ordem do dono, 18/10):
 *   1. o token secreto da URL identifica a loja (só a Lalamove daquela conta o conhece);
 *   2. o status NUNCA vem do corpo: a corrida é consultada na API (GET /v3/orders/{id}) com as chaves da loja.
 * Token desconhecido → 404 sem detalhe. Evento de corrida desconhecida → 200 (não há o que reenviar). Falha nossa → 500
 * (a Lalamove reenvia).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()
  const cfg = await buscarConfigPorToken(admin, token).catch(() => null)
  if (!cfg) return new NextResponse(null, { status: 404 })
  let corpo: unknown = null
  try { corpo = await request.json() } catch { return new NextResponse(null, { status: 400 }) }
  const orderId = orderIdDoWebhook(corpo)
  const tipo = tipoDoWebhook(corpo)
  // Eventos sem corrida (WALLET_BALANCE_CHANGED…) não têm o que aplicar.
  if (!orderId) return NextResponse.json({ ok: true, ignorado: tipo || 'sem_orderId' })
  try {
    await processarWebhook(admin, cfg, orderId, { tipo, recebidoEm: new Date().toISOString() })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(`[lalamove] webhook ${tipo} ${orderId}:`, (e as Error).message)
    return new NextResponse(null, { status: 500 })
  }
}

/** A Lalamove (e quem testa a URL) pode bater com GET: responde 200 sem revelar nada. */
export async function GET() { return NextResponse.json({ ok: true }) }
