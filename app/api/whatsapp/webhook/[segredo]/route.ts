import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { processarEntrada } from '@/lib/mensageria/entrada'

/**
 * Webhook de mensagens do WhatsApp (robô de atendimento v1).
 *
 * Público, mas só funciona com o segredo da loja na URL (48 hex, whatsapp_robo_config).
 * A loja vem SÓ do segredo. Segredo errado ou robô de outra loja: 404 sem detalhe.
 * Corpo limitado a 256 KB e nunca registrado em log (tem número, texto e a chave da
 * instância).
 */
const LIMITE = 256 * 1024

export async function POST(request: Request, { params }: { params: Promise<{ segredo: string }> }) {
  const { segredo } = await params
  const bruto = await request.text()
  if (bruto.length > LIMITE) return NextResponse.json({ error: 'Corpo grande demais' }, { status: 413 })
  let corpo: unknown
  try {
    corpo = JSON.parse(bruto)
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  try {
    const r = await processarEntrada(getAdminSupabase(), segredo, corpo)
    if (r.status === 404) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true, processadas: r.processadas, respostas: r.respostas, ignoradas: r.ignoradas })
  } catch (e) {
    console.error('[whatsapp] falha ao processar webhook:', (e as Error).message?.slice(0, 200))
    // 500 faz o provedor reentregar; a mensagem já gravada não é processada de novo (wa_id único).
    return NextResponse.json({ error: 'Falha temporária' }, { status: 500 })
  }
}
