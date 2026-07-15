import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import {
  listarCampanhasFidelidade,
  criarCampanhaFidelidade,
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

export async function GET() {
  try {
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const admin = getAdminSupabase()
    const campanhas = await listarCampanhasFidelidade(admin, restauranteId)
    return NextResponse.json(campanhas)
  } catch (err) {
    console.error('[fidelidade/campanhas] GET erro:', err)
    if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body: CampanhaFidelidadeInput = await request.json()

    const admin = getAdminSupabase()
    const campanha = await criarCampanhaFidelidade(admin, restauranteId, body)
    return NextResponse.json(campanha, { status: 201 })
  } catch (err) {
    console.error('[fidelidade/campanhas] POST erro:', err)
    if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
