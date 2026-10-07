import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { assinaturaMpValida } from '@/lib/pagamentos/assinatura-mp'
import { conferirPagamento } from '@/lib/pagamentos/pix-online'

export const dynamic = 'force-dynamic'

/**
 * Webhook do Mercado Pago (Pix online, 0148).
 * 1. Assinatura `x-signature` (HMAC com MP_WEBHOOK_SECRET) e `ts` recente — inválida: 401, nada muda.
 * 2. Válida: o pagamento é CONSULTADO na API com o token da loja dona da cobrança (conferirPagamento);
 *    o corpo do webhook nunca é usado como verdade.
 * 3. Idempotente: o mesmo `x-request-id` só é processado uma vez; a confirmação do pedido é um
 *    UPDATE condicional (webhook repetido não duplica nada).
 * Pagamento que não é nosso (sem cobrança registrada): 200 sem efeito, para o MP não reenviar.
 */
export async function POST(request: Request) {
  const url = new URL(request.url)
  const corpo = (await request.json().catch(() => null)) as { type?: string; action?: string; data?: { id?: unknown } } | null
  const dataId = String(url.searchParams.get('data.id') ?? corpo?.data?.id ?? '').slice(0, 40) || null
  const tipo = String(url.searchParams.get('type') ?? corpo?.type ?? '').slice(0, 40)
  const requestId = request.headers.get('x-request-id')?.slice(0, 120) ?? null
  const admin = getAdminSupabase()

  // Notificação no formato antigo do MP (IPN: ?topic=…&id=…, sem x-signature e sem "type"): não usamos —
  // o webhook assinado e a verificação periódica já cobrem. 200 sem gravar nada, para não poluir o registro
  // nem o MP reenviar. Com "type" e sem assinatura válida continua 401 e registrado (pode ser tentativa de fraude).
  if (!request.headers.get('x-signature') && !tipo) return NextResponse.json({ ok: true, ignorado: 'formato_antigo' })

  const valida = assinaturaMpValida({ xSignature: request.headers.get('x-signature'), requestId, dataId, segredo: process.env.MP_WEBHOOK_SECRET })
  if (!valida) {
    await admin.from('pagamentos_eventos').insert({ tipo, acao: corpo?.action?.slice(0, 60) ?? null, mp_id: dataId, request_id: requestId, assinatura_valida: false, resultado: 'assinatura_invalida' })
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 })
  }
  // Mesmo request-id de novo: já processado.
  const { error: dup } = await admin.from('pagamentos_eventos').insert({ tipo, acao: corpo?.action?.slice(0, 60) ?? null, mp_id: dataId, request_id: requestId, assinatura_valida: true, resultado: 'recebido' })
  if (dup && (dup as { code?: string }).code === '23505') return NextResponse.json({ ok: true, repetido: true })
  if (tipo !== 'payment' || !dataId || !/^\d{1,30}$/.test(dataId)) return NextResponse.json({ ok: true, ignorado: true })

  const resultado = await conferirPagamento(admin, dataId, 'webhook').catch(() => 'erro_api' as const)
  if (requestId) await admin.from('pagamentos_eventos').update({ resultado }).eq('provedor', 'mercadopago').eq('request_id', requestId).eq('assinatura_valida', true)
  // Erro de API: 500 para o MP reenviar mais tarde (a verificação periódica também cobre).
  if (resultado === 'erro_api') return NextResponse.json({ ok: false }, { status: 500 })
  return NextResponse.json({ ok: true, resultado })
}
