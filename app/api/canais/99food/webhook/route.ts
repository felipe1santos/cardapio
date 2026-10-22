import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigCanal } from '@/lib/canais/config'
import { canalPodeRodar, tratarEvento99 } from '@/lib/canais/sincronizar'
import { app99 } from '@/lib/canais/noventaenove/cliente'
import { assinaturaWebhook99Valida, lerJsonComIdsGrandes } from '@/lib/canais/noventaenove/nucleo'

export const dynamic = 'force-dynamic'

/**
 * Webhook da 99Food (protocolo próprio, 22/10/2026) — UMA URL para todas as lojas (cadastrada no app da Menuzia na
 * 99Food). A loja vem em `app_shop_id` (= restaurante_id do Menuzia, definido no vínculo). Confere:
 *   didi-header-sign = MD5(corpo cru + app_secret) e app_id = o app da Menuzia.
 * A 99Food espera {"errno":0,"errmsg":"ok"} em até 6 s; qualquer outra resposta faz ela reenviar (por isso erro nosso
 * devolve errno 1). IDs de 64 bits lidos sem arredondar (lerJsonComIdsGrandes).
 */
const LIMITE = 256 * 1024
const ok = (extra: Record<string, unknown> = {}) => NextResponse.json({ errno: 0, errmsg: 'ok', ...extra })
const erro = (status: number, msg: string) => NextResponse.json({ errno: 1, errmsg: msg }, { status })

export async function POST(request: Request) {
  const app = app99()
  if (!app) return erro(503, 'app not configured')
  const bruto = await request.text()
  if (bruto.length > LIMITE) return erro(413, 'body too large')
  if (!assinaturaWebhook99Valida(bruto, request.headers.get('didi-header-sign'), app.appSecret)) {
    console.warn('[99food webhook] assinatura inválida')
    return erro(401, 'invalid sign')
  }
  let ev: { app_id?: unknown; app_shop_id?: unknown; type?: unknown; data?: unknown }
  try { ev = lerJsonComIdsGrandes(bruto) as typeof ev } catch { return erro(400, 'invalid json') }
  if (String(ev.app_id ?? '') !== app.appId) return erro(401, 'unknown app')
  const tipo = String(ev.type ?? '')
  const loja = String(ev.app_shop_id ?? '')
  const dados = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>
  const orderId = String(dados.order_id ?? '')
  console.log(`[99food webhook] ${tipo} loja ${loja.slice(0, 8)} pedido …${orderId.slice(-6)}`)
  // Avisos sem pedido (cardápio, loja) ou de loja que não é nossa: só confirma o recebimento.
  if (!/^[0-9a-f-]{36}$/i.test(loja) || !/^\d+$/.test(orderId)) return ok({ ignorado: true })
  const admin = getAdminSupabase()
  const cfg = await buscarConfigCanal(admin, loja, '99food').catch(() => null)
  if (!cfg || !cfg.ativo || !canalPodeRodar('99food')) return ok({ ignorado: 'loja sem 99Food ligada' })
  try {
    const resultado = await tratarEvento99(admin, cfg, tipo, orderId, dados)
    return ok({ resultado })
  } catch (e) {
    console.error('[99food webhook]', tipo, (e as Error).message?.slice(0, 160))
    return erro(500, 'temporary failure')
  }
}
