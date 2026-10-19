import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigPorToken, buscarCorridaPorExterno } from '@/lib/entregas/queries'
import { assinaturaFoodyValida } from '@/lib/custo/foody-logistica'
import { aplicarEventoCorrida, statusDeEventoOd } from '@/lib/entregas/provedores'

export const dynamic = 'force-dynamic'

/**
 * Webhook de logística do Open Delivery (`POST /deliveryUpdate` / newLogisticEvent) — a Foody avisa cada etapa da
 * entrega. URL por loja (token aleatório de entregas_provedor_config, provedor 'foody'). Confere X-App-Signature
 * (HMAC-SHA256 do corpo com o client secret). Corpo: DeliveryOrderEvent { deliveryId, orderId, event{type}, deliveryPerson,
 * vehicle, deliveryPrice, externalTrackingURL }. Evento desconhecido → 200 (nada a reenviar); falha nossa → 500.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()
  const cfg = await buscarConfigPorToken(admin, token, 'foody').catch(() => null)
  if (!cfg) return new NextResponse(null, { status: 404 })
  const bruto = await request.text()
  if (bruto.length > 64 * 1024) return NextResponse.json({ error: 'Corpo grande demais' }, { status: 413 })
  if (!cfg.chaves || !assinaturaFoodyValida(bruto, request.headers.get('x-app-signature'), cfg.chaves.apiSecret)) return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 })
  let ev: Record<string, unknown>
  try { ev = JSON.parse(bruto) as Record<string, unknown> } catch { return new NextResponse(null, { status: 400 }) }
  const deliveryId = String(ev.deliveryId ?? '')
  const orderId = String(ev.orderId ?? '')
  const evento = (ev.event as { type?: string } | undefined) ?? {}
  const novo = statusDeEventoOd(String(evento.type ?? ''))
  if (!deliveryId && !orderId) return NextResponse.json({ ok: true, ignorado: 'sem id' })
  try {
    const corrida = (deliveryId ? await buscarCorridaPorExterno(admin, deliveryId, 'foody') : null) ?? (orderId ? await buscarCorridaPorExterno(admin, orderId, 'foody') : null)
    if (!corrida || corrida.restauranteId !== cfg.restauranteId) return NextResponse.json({ ok: true, ignorado: 'corrida desconhecida' })
    if (!novo) return NextResponse.json({ ok: true, ignorado: evento.type ?? 'sem tipo' })
    const dp = (ev.deliveryPerson as { id?: string; name?: string; phone?: string } | undefined)
    const veic = (ev.vehicle as { plate?: string; licensePlate?: string } | undefined)
    const preco = ((ev.deliveryPrice as { price?: { value?: number } } | undefined)?.price?.value)
    const r = await aplicarEventoCorrida(admin, corrida, novo, {
      motorista: dp?.name ? { id: dp.id ?? null, nome: dp.name, telefone: dp.phone ?? null, placa: veic?.plate ?? veic?.licensePlate ?? null } : null,
      shareLink: (ev.externalTrackingURL as string | undefined) ?? null, preco: typeof preco === 'number' ? preco : null, evento: { tipo: evento.type, recebidoEm: new Date().toISOString() }, origem: 'webhook',
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('[foody webhook]', (e as Error).message?.slice(0, 160))
    return new NextResponse(null, { status: 500 })
  }
}

export async function GET() { return NextResponse.json({ ok: true }) }
