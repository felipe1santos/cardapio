import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import {
  atualizarCampanha,
  excluirCampanha,
  resolverDestinatarios,
  popularFilaCampanha,
  type CampanhaInput,
} from '@/lib/queries/campanhas'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getAuthSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
}

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body: Partial<CampanhaInput> & { disparar?: boolean } = await request.json()
    const campanha = await atualizarCampanha(supabase, restauranteId, id, body)

    if (body.disparar || (body.agendadoEm && campanha.status === 'agendada')) {
      const admin = getAdminSupabase()
      // Remove envios pendentes anteriores antes de repopular.
      await admin.from('campanha_envios').delete().eq('campanha_id', id).eq('status', 'pendente')
      const destinatarios = await resolverDestinatarios(admin, restauranteId, campanha.filtro)
      if (destinatarios.length) {
        await popularFilaCampanha(admin, id, restauranteId, destinatarios)
      }
    }

    return NextResponse.json(campanha)
  } catch (err) {
    console.error('[campanhas/id] PATCH erro:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    await excluirCampanha(supabase, restauranteId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[campanhas/id] DELETE erro:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
