import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import {
  atualizarCampanhaFidelidade,
  excluirCampanhaFidelidade,
  type CampanhaFidelidadeInput,
} from '@/lib/queries/fidelidade'
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

    const body: CampanhaFidelidadeInput = await request.json()

    const admin = getAdminSupabase()
    const campanha = await atualizarCampanhaFidelidade(admin, restauranteId, id, body)
    return NextResponse.json(campanha)
  } catch (err) {
    console.error('[fidelidade/campanhas/id] PATCH erro:', err)
    if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const admin = getAdminSupabase()
    await excluirCampanhaFidelidade(admin, restauranteId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[fidelidade/campanhas/id] DELETE erro:', err)
    if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
