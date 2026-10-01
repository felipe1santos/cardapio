import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdPorSlug } from '@/lib/queries/clientes'

/** A vitrine abriu pelo toque na notificação (`?push=<envio>`): registra o clique (uma vez). */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let envio = ''
  try { envio = String((await request.json()).envio ?? '') } catch { /* vazio */ }
  if (!/^[0-9a-f-]{36}$/i.test(envio)) return NextResponse.json({ ok: false }, { status: 400 })
  const admin = getAdminSupabase()
  const restauranteId = await buscarRestauranteIdPorSlug(admin, slug)
  if (!restauranteId) return NextResponse.json({ ok: false }, { status: 404 })
  await admin.from('push_envios').update({ clicado_em: new Date().toISOString() }).eq('id', envio).eq('restaurante_id', restauranteId).is('clicado_em', null)
  return NextResponse.json({ ok: true })
}
