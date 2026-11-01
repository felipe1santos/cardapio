import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { despacharAutomaticamente, marcarEntreguesAutomaticos } from '@/lib/motoboy/despacho-automatico'
import { baterCron, umaPorVez } from '@/lib/saude/cron'

// Cron (Coolify), a cada minuto: POST /api/cron/entregas com header "x-cron-secret: <CRON_SECRET>".
// Item 61: (1) pedido em rota há 1h30 sem o motoboy confirmar → "Entregue (automático)";
// (2) lojas com o despacho automático ligado: despacha os prontos que ficaram sem motoboy
// (ninguém disponível na hora em que ficaram prontos).
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  void baterCron('entregas')
  // Rodada anterior ainda despachando (banco lento): não despacha o mesmo pronto duas vezes ao mesmo tempo (28/10).
  return NextResponse.json(await umaPorVez('entregas', async () => {
    const admin = getAdminSupabase()
    let entregues = 0
    try { entregues = await marcarEntreguesAutomaticos(admin) } catch (e) { console.error('[cron entregas] entregue automático', (e as Error).message) }
    const { data: lojas } = await admin.from('restaurantes').select('id').eq('despacho_automatico', true)
    const ids = ((lojas ?? []) as { id: string }[]).map((l) => l.id)
    let despachados = 0
    if (ids.length) {
      // 1 consulta para todas as lojas (01/11): só entra na loja que tem pronto sem motoboy (era 2 consultas por loja por minuto).
      const { data: prontos } = await admin.from('pedidos').select('restaurante_id').in('restaurante_id', ids).eq('status', 'pronto').eq('tipo', 'entrega').is('entregador_id', null).limit(500)
      const comPronto = [...new Set(((prontos ?? []) as { restaurante_id: string }[]).map((p) => p.restaurante_id))]
      for (const id of comPronto) {
        try { despachados += (await despacharAutomaticamente(admin, id, { jaLigado: true })).despachados.length } catch (e) { console.error('[cron entregas] despacho', id, (e as Error).message) }
      }
    }
    return { ok: true, entregues, lojas: lojas?.length ?? 0, despachados }
  }))
}
