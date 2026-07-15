import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { NEXTA_APP_ID, validarAssinaturaWebhook } from '@/lib/nexta'
import { aplicarEventoNexta, type EventoNexta } from '@/lib/nexta-estados'
import { buscarNextaConfigPorWebhookToken, buscarNextaEntrega } from '@/lib/queries/nexta'

/**
 * Eventos de entrega do Nexta (aceito, coletado, entregue...). ENDPOINT PÚBLICO — é o
 * Nexta quem chama, e a URL é registrada manualmente com o suporte deles.
 *
 * Três camadas antes de tocar no banco:
 *  1. o token da URL identifica a loja (é secreto e só o Nexta conhece);
 *  2. `X-App-Signature` = HMAC-SHA256 do corpo BRUTO com o client_secret DAQUELA loja;
 *  3. `X-App-Id` confere que quem chama é o Nexta.
 *
 * Sempre responde 200 com corpo vazio quando o evento é nosso e foi processado: qualquer
 * não-200 faz o Nexta reenviar. Erro nosso devolve 500 de propósito — aí queremos o
 * reenvio.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Corpo BRUTO: o HMAC é sobre os bytes exatos. Fazer JSON.parse antes e re-serializar
  // mudaria o texto (espaços, ordem) e invalidaria toda assinatura legítima.
  const rawBody = await request.text()

  const admin = getAdminSupabase()
  const cfg = await buscarNextaConfigPorWebhookToken(admin, token)
  // Token desconhecido: 404 sem detalhe — não confirma pra um scanner se o token existe.
  if (!cfg) return new NextResponse(null, { status: 404 })

  const appId = request.headers.get('x-app-id')
  if (appId && appId !== NEXTA_APP_ID) {
    console.warn(`[nexta] webhook com X-App-Id inesperado (${appId}) na loja ${cfg.restauranteId}.`)
    return new NextResponse(null, { status: 401 })
  }

  if (!validarAssinaturaWebhook(rawBody, request.headers.get('x-app-signature'), cfg.clientSecret)) {
    console.warn(`[nexta] webhook com assinatura invalida na loja ${cfg.restauranteId}.`)
    return new NextResponse(null, { status: 401 })
  }

  let evento: EventoNexta
  try {
    evento = JSON.parse(rawBody) as EventoNexta
  } catch {
    // Assinado mas ilegível: reenviar não vai consertar, então 400 (não 500).
    return new NextResponse(null, { status: 400 })
  }

  const orderId = typeof evento.orderId === 'string' ? evento.orderId : ''
  if (!orderId) return new NextResponse(null, { status: 400 })

  try {
    const entrega = await buscarNextaEntrega(admin, orderId)
    // Evento de uma entrega que não é nossa (ou de outra loja) — aceitar calado evita
    // que o Nexta fique reenviando pra sempre algo que nunca vamos processar.
    if (!entrega || entrega.restauranteId !== cfg.restauranteId) {
      console.warn(`[nexta] webhook para orderId desconhecido ${orderId} na loja ${cfg.restauranteId}.`)
      return new NextResponse(null, { status: 200 })
    }

    await aplicarEventoNexta(admin, entrega, evento)
    return new NextResponse(null, { status: 200 })
  } catch (err) {
    // 500 é intencional: falha nossa (banco fora, bug) merece o reenvio do Nexta.
    console.error(`[nexta] erro ao processar webhook do pedido ${orderId}:`, err)
    return new NextResponse(null, { status: 500 })
  }
}
