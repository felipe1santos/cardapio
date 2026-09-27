import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { processarFila } from '@/lib/mensageria/fila'

/**
 * Cron da fila do WhatsApp: novas tentativas (espera crescente) e retenção de 90 dias.
 * Protegido por CRON_SECRET, como o de campanhas. Sugestão no Coolify: a cada 1 minuto.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const admin = getAdminSupabase()
  const fila = await processarFila(admin, { limite: 20 })
  const { data: limpeza, error } = await admin.rpc('whatsapp_limpar_antigos')
  if (error) console.error('[whatsapp] limpeza falhou:', error.message)
  return NextResponse.json({ enviados: fila.enviados, falhas: fila.falhas, limpeza: limpeza ?? null })
}
