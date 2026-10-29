import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { sincronizarCanais } from '@/lib/canais/sincronizar'
import { sincronizarCorridasAtivas } from '@/lib/entregas/provedores'
import { vencerPixParceiros } from '@/lib/entregas/parceiro-pix-servidor'
import { baterCron, umaPorVez } from '@/lib/saude/cron'

export const dynamic = 'force-dynamic'

/**
 * Canais externos (Etapa 2, 19/10): a cada minuto pelo agendamento do Coolify (cabeçalho `x-cron-secret`, igual aos
 * outros crons): polling de pedidos novos/cancelamentos nos apps (Keeta/99Food via Open Delivery; iFood) e envio do
 * status do Kanban de volta ao app. Só lojas com o canal ligado, credenciais salvas e módulo liberado.
 *   curl -s -X POST -H "x-cron-secret: $CRON_SECRET" https://app.menuzia.com.br/api/cron/canais
 */
export async function POST(request: Request) {
  const segredo = process.env.CRON_SECRET
  if (!segredo || request.headers.get('x-cron-secret') !== segredo) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  void baterCron('canais')
  try {
    // Uma rodada por vez (29/10): rodada lenta + a seguinte reenviavam status ou consultavam a corrida em dobro.
    const res = await umaPorVez('canais', () => rodada())
    return NextResponse.json(res)
  } catch (e) {
    console.error('[cron canais]', (e as Error).message?.slice(0, 160))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

async function rodada() {
  const admin = getAdminSupabase()
  const r = await sincronizarCanais(admin)
  if (r.erros.length) console.error('[cron canais]', r.erros.slice(0, 5).join(' | '))
  // 21/10: corridas em andamento dos parceiros de entrega consultadas no parceiro (webhook opcional).
  const uber = await sincronizarCorridasAtivas(admin).catch((e) => ({ consultadas: 0, mudaram: 0, erros: [(e as Error).message] }))
  // 21/10: Pix antes do parceiro sem pagamento há 10 min → alarme no painel.
  const pixVencidos = await vencerPixParceiros(admin).catch(() => 0)
  if (uber.erros.length) console.error('[cron canais] entregas', uber.erros.slice(0, 3).join(' | '))
  return { ok: true, ...r, erros: r.erros.length, entregas: { consultadas: uber.consultadas, mudaram: uber.mudaram }, pixParceiroVencidos: pixVencidos }
}
