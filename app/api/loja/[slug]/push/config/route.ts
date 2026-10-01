import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { chavePublicaVapid, pushConfigurado } from '@/lib/push/envio'

export const dynamic = 'force-dynamic'

/**
 * A vitrine pergunta se a loja oferece notificações (flag da loja + chaves no servidor) e pega a
 * chave pública VAPID para assinar. Sem push: `{ ativo: false }` e a vitrine não mostra convite.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data } = await getAdminSupabase().from('restaurantes').select('push_liberado').eq('slug', slug).maybeSingle()
  const ativo = Boolean(data?.push_liberado) && pushConfigurado()
  return NextResponse.json(ativo ? { ativo, chavePublica: chavePublicaVapid() } : { ativo: false }, { headers: { 'Cache-Control': 'no-store' } })
}
