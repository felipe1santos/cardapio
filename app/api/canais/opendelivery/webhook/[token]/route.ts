import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigPorWebhookToken } from '@/lib/canais/config'
import { assinaturaOdValida, type EventoOd } from '@/lib/canais/opendelivery/cliente'
import { tratarEventoOd, MODULO_DO_CANAL } from '@/lib/canais/sincronizar'
import { moduloLiberado } from '@/lib/modulos'

export const dynamic = 'force-dynamic'

/**
 * Webhook do Open Delivery (`POST /v1/newEvent` do SOFTWARE SERVICE): o app (Keeta/99Food) avisa um evento de pedido.
 * URL por loja/canal (token aleatório de canais_config) — a loja cola em "URL do webhook" no app. Confere:
 *   X-App-Id = app_id_externo cadastrado (quando preenchido) e X-App-Signature = HMAC-SHA256(corpo, clientSecret).
 * Responde 200 rápido; o detalhe do pedido é buscado no app (GET /v1/orders/{id}) e importado uma vez só.
 * O polling (cron) é a rede de segurança: se o webhook falhar, o pedido entra em até 1 min.
 */
const LIMITE = 64 * 1024

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  const admin = getAdminSupabase()
  const cfg = await buscarConfigPorWebhookToken(admin, token).catch(() => null)
  if (!cfg || cfg.canal === 'ifood') return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  const bruto = await request.text()
  if (bruto.length > LIMITE) return NextResponse.json({ error: 'Corpo grande demais' }, { status: 413 })
  const appId = request.headers.get('x-app-id')
  if (cfg.appIdExterno && appId && appId !== cfg.appIdExterno) return NextResponse.json({ error: 'App desconhecido' }, { status: 401 })
  if (!assinaturaOdValida(bruto, request.headers.get('x-app-signature'), cfg.credenciais?.clientSecret ?? null)) return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 })
  if (!cfg.ativo || !(await moduloLiberado(admin, cfg.restauranteId, MODULO_DO_CANAL[cfg.canal]))) return NextResponse.json({ ok: true, ignorado: 'canal desligado' })
  let evento: EventoOd
  try { evento = JSON.parse(bruto) as EventoOd } catch { return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 }) }
  if (!evento || typeof evento.eventId !== 'string' || typeof evento.orderId !== 'string') return NextResponse.json({ error: 'Evento inválido' }, { status: 400 })
  try {
    const r = await tratarEventoOd(admin, cfg, evento)
    return NextResponse.json({ ok: true, resultado: r })
  } catch (e) {
    console.error('[opendelivery webhook]', cfg.canal, (e as Error).message?.slice(0, 160))
    // 500: o app reentrega (e o polling cobre).
    return NextResponse.json({ error: 'Falha temporária' }, { status: 500 })
  }
}
