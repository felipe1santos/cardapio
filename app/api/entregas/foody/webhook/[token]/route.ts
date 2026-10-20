import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigPorToken, buscarCorridaPorExterno } from '@/lib/entregas/queries'
import { assinaturaFoodyValida } from '@/lib/custo/foody-logistica'
import { aplicarEventoCorrida, statusDeEventoOd } from '@/lib/entregas/provedores'

export const dynamic = 'force-dynamic'

/**
 * Webhook da Foody (Open Delivery › gatilho da credencial; 20/10 conferido na central de ajuda da Foody):
 *  - a Foody manda um `hook_test` ao salvar o gatilho e DESATIVA o webhook depois de 10 erros seguidos → aqui a resposta
 *    é 200 sempre que o token da URL existir (a segurança é o token aleatório da URL, como na Lalamove); se vier
 *    X-App-Signature (padrão Open Delivery), ela é conferida; sem o cabeçalho, aceita.
 *  - payload Open Delivery (DeliveryOrderEvent: deliveryId, orderId, event{type}, deliveryPerson, externalTrackingURL) OU
 *    payload nativo da Foody ({ uid, event: 'order_status_updated', status: 'dispatched', token }).
 * Corrida desconhecida → 200 "ignorado". Falha nossa → 200 com "erro" no corpo (a Foody só retenta uma vez e conta erro).
 */
function statusNativoFoody(status: string): string | null {
  const s = (status || '').toLowerCase()
  if (/deliver|finish|conclu|entreg/.test(s)) return 'COMPLETED'
  if (/cancel|rejeit|reject/.test(s)) return 'CANCELED'
  if (/dispatch|transit|rota|picked|coletad/.test(s)) return 'PICKED_UP'
  if (/assign|driver|motoboy|caminho/.test(s)) return 'ON_GOING'
  if (/accept|aceit|pending|created|novo/.test(s)) return 'ASSIGNING_DRIVER'
  return null
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()
  const cfg = await buscarConfigPorToken(admin, token, 'foody').catch(() => null)
  if (!cfg) return new NextResponse(null, { status: 404 })
  const bruto = await request.text()
  if (bruto.length > 64 * 1024) return NextResponse.json({ ok: true, ignorado: 'corpo grande demais' })
  const assinatura = request.headers.get('x-app-signature')
  if (assinatura && cfg.chaves && !assinaturaFoodyValida(bruto, assinatura, cfg.chaves.apiSecret)) return NextResponse.json({ ok: true, ignorado: 'assinatura inválida' })
  let ev: Record<string, unknown>
  try { ev = JSON.parse(bruto) as Record<string, unknown> } catch { return NextResponse.json({ ok: true, ignorado: 'corpo inválido' }) }
  if (ev.event === 'hook_test') return NextResponse.json({ ok: true, teste: true })
  const deliveryId = String(ev.deliveryId ?? ev.uid ?? '')
  const orderId = String(ev.orderId ?? '')
  const tipoOd = String((ev.event as { type?: string } | undefined)?.type ?? '')
  const novo = tipoOd ? statusDeEventoOd(tipoOd) : statusNativoFoody(String(ev.status ?? ''))
  if (!deliveryId && !orderId) return NextResponse.json({ ok: true, ignorado: 'sem id' })
  try {
    const corrida = (deliveryId ? await buscarCorridaPorExterno(admin, deliveryId, 'foody') : null) ?? (orderId ? await buscarCorridaPorExterno(admin, orderId, 'foody') : null)
    if (!corrida || corrida.restauranteId !== cfg.restauranteId) return NextResponse.json({ ok: true, ignorado: 'corrida desconhecida' })
    if (!novo) return NextResponse.json({ ok: true, ignorado: tipoOd || String(ev.status ?? 'sem tipo') })
    const dp = (ev.deliveryPerson as { id?: string; name?: string; phone?: string } | undefined) ?? (ev.driver as { id?: string; name?: string; phone?: string } | undefined)
    const veic = (ev.vehicle as { plate?: string; licensePlate?: string } | undefined)
    const preco = ((ev.deliveryPrice as { price?: { value?: number } } | undefined)?.price?.value)
    const r = await aplicarEventoCorrida(admin, corrida, novo, {
      motorista: dp?.name ? { id: dp.id ?? null, nome: dp.name, telefone: dp.phone ?? null, placa: veic?.plate ?? veic?.licensePlate ?? null } : null,
      shareLink: (ev.externalTrackingURL as string | undefined) ?? (ev.trackingUrl as string | undefined) ?? null, preco: typeof preco === 'number' ? preco : null,
      evento: { tipo: tipoOd || ev.status, recebidoEm: new Date().toISOString() }, origem: 'webhook',
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('[foody webhook]', (e as Error).message?.slice(0, 160))
    return NextResponse.json({ ok: true, erro: 'falha interna registrada' })
  }
}

export async function GET() { return NextResponse.json({ ok: true }) }
