import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import {
  listarCupons,
  criarCupom,
  type CupomInput,
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
    const cupons = await listarCupons(admin, restauranteId)
    return NextResponse.json(cupons)
  } catch (err) {
    console.error('[fidelidade/cupons] GET erro:', err)
    if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body: CupomInput = await request.json()

    const admin = getAdminSupabase()
    const cupom = await criarCupom(admin, restauranteId, body)
    return NextResponse.json(cupom, { status: 201 })
  } catch (err) {
    console.error('[fidelidade/cupons] POST erro:', err)
    if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 400 })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
