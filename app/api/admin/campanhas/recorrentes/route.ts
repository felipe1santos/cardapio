import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { restauranteDaSessao } from '@/lib/auth/session'
import { garantirRecorrentes } from '@/lib/queries/recorrentes'

// Cards de disparo recorrente (0245). Cliente da sessão: a RLS (gestor da própria loja) decide; garçom recebe 403.

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
    const restauranteId = await restauranteDaSessao(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    const cards = await garantirRecorrentes(supabase, restauranteId)
    // RLS de gestor: quem não é gestor não lê nem cria — a lista volta vazia.
    if (cards.length === 0) return NextResponse.json({ error: 'Só o dono ou gerente mexe nos disparos.' }, { status: 403 })
    return NextResponse.json(cards)
  } catch (err) {
    console.error('[campanhas/recorrentes] GET erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
