import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigPorToken, buscarCorridaPorExterno } from '@/lib/entregas/queries'
import { assinaturaUberValida, statusDeUber } from '@/lib/custo/uber-direct'
import { aplicarEventoCorrida } from '@/lib/entregas/provedores'

export const dynamic = 'force-dynamic'

/**
 * Webhook da Uber Direct (21/10/2026), configurado pela loja em direct.uber.com › Developer › Webhooks com a URL que o
 * card de Integrações mostra. Dois tipos:
 *  - event.delivery_status { status, delivery_id, data: { ...entrega, courier, tracking_url, fee } }
 *  - event.courier_update  { delivery_id, data: { courier } } → só atualiza o entregador
 * x-uber-signature (ou x-postmates-signature) = HMAC-SHA256 hex do corpo bruto com a signing key — conferida SEMPRE
 * que a loja salvou a key; sem key salva, vale o token aleatório da URL (como Lalamove/Foody). A Uber só retenta em
 * 5xx/timeout: assinatura ruim ou corrida desconhecida → 200 "ignorado"; falha nossa → 500 para ela tentar de novo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()
  const cfg = await buscarConfigPorToken(admin, token, 'uber').catch(() => null)
  if (!cfg) return new NextResponse(null, { status: 404 })
  const bruto = await request.text()
  if (bruto.length > 128 * 1024) return NextResponse.json({ ok: true, ignorado: 'corpo grande demais' })
  if (cfg.webhookSegredo) {
    const assinatura = request.headers.get('x-uber-signature') ?? request.headers.get('x-postmates-signature')
    if (!assinaturaUberValida(bruto, assinatura, cfg.webhookSegredo)) return NextResponse.json({ ok: true, ignorado: 'assinatura inválida' })
  }
  let ev: Record<string, unknown>
  try { ev = JSON.parse(bruto) as Record<string, unknown> } catch { return NextResponse.json({ ok: true, ignorado: 'corpo inválido' }) }
  const deliveryId = String(ev.delivery_id ?? (ev.data as { id?: string } | undefined)?.id ?? '')
  if (!deliveryId) return NextResponse.json({ ok: true, ignorado: 'sem delivery_id' })
  try {
    const corrida = await buscarCorridaPorExterno(admin, deliveryId, 'uber')
    if (!corrida || corrida.restauranteId !== cfg.restauranteId) return NextResponse.json({ ok: true, ignorado: 'corrida desconhecida' })
    const data = (ev.data as Record<string, unknown> | undefined) ?? {}
    const courier = data.courier as { name?: string; phone_number?: string; vehicle_license_plate?: string; public_phone_info?: { formatted_phone_number?: string } } | undefined
    const motorista = courier?.name ? { nome: courier.name, telefone: courier.public_phone_info?.formatted_phone_number ?? courier.phone_number ?? null, placa: courier.vehicle_license_plate ?? null } : null
    const kind = String(ev.kind ?? '')
    const novo = kind === 'event.courier_update' ? corrida.status : statusDeUber(String(ev.status ?? data.status ?? ''))
    if (!novo) return NextResponse.json({ ok: true, ignorado: String(ev.status ?? kind) })
    const r = await aplicarEventoCorrida(admin, corrida, novo, {
      motorista, shareLink: (data.tracking_url as string | undefined) ?? null, preco: typeof data.fee === 'number' ? data.fee / 100 : null,
      evento: { tipo: kind, status: ev.status ?? null, recebidoEm: new Date().toISOString() }, origem: 'webhook',
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('[uber webhook]', (e as Error).message?.slice(0, 160))
    return NextResponse.json({ ok: false, erro: 'falha interna' }, { status: 500 })
  }
}

export async function GET() { return NextResponse.json({ ok: true }) }
