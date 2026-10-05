import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getCurrentSession } from '@/lib/auth/session'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { chavePublicaVapid, pushConfigurado } from '@/lib/push/envio'

export const dynamic = 'force-dynamic'

/**
 * Assinatura de push do PAINEL (aviso de pedido novo com a tela apagada) — 0146.
 *   GET    → { disponivel, chavePublica }  (sem chaves VAPID no servidor: disponivel = false)
 *   POST   → grava/atualiza a assinatura deste aparelho para o usuário logado
 *   DELETE → remove a assinatura deste aparelho
 * A tabela é só do servidor; aqui a loja e o usuário vêm SEMPRE da sessão.
 */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const disponivel = pushConfigurado()
  return NextResponse.json(disponivel ? { disponivel, chavePublica: chavePublicaVapid() } : { disponivel: false }, { headers: { 'Cache-Control': 'no-store' } })
}

function lerAssinatura(corpo: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  const c = corpo as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = typeof c?.endpoint === 'string' ? c.endpoint : ''
  const p256dh = typeof c?.keys?.p256dh === 'string' ? c.keys.p256dh : ''
  const auth = typeof c?.keys?.auth === 'string' ? c.keys.auth : ''
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) return null
  return { endpoint, p256dh, auth }
}

export async function POST(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  if (!pushConfigurado()) return NextResponse.json({ error: 'Push indisponível' }, { status: 409 })
  const a = lerAssinatura(await request.json().catch(() => null))
  if (!a) return NextResponse.json({ error: 'Assinatura inválida' }, { status: 400 })
  const { error } = await getAdminSupabase().from('push_painel_assinaturas').upsert({
    restaurante_id: sessao.restauranteId, usuario_id: sessao.userId, endpoint: a.endpoint, p256dh: a.p256dh, auth: a.auth,
    navegador: (request.headers.get('user-agent') ?? '').slice(0, 160), falhas: 0, atualizado_em: new Date().toISOString(),
  }, { onConflict: 'endpoint' })
  if (error) return NextResponse.json({ error: 'Falha ao salvar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const corpo = (await request.json().catch(() => null)) as { endpoint?: unknown } | null
  if (typeof corpo?.endpoint !== 'string') return NextResponse.json({ error: 'Endpoint ausente' }, { status: 400 })
  await getAdminSupabase().from('push_painel_assinaturas').delete().eq('endpoint', corpo.endpoint).eq('restaurante_id', sessao.restauranteId)
  return NextResponse.json({ ok: true })
}
