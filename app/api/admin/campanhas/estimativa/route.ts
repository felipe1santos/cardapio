import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { resolverDestinatarios, type FiltroCampanha } from '@/lib/queries/campanhas'
import { deduplicarDestinatarios } from '@/lib/mensageria/campanhas'
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

export async function POST(request: Request) {
  try {
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const { filtro }: { filtro: FiltroCampanha } = await request.json()
    const admin = getAdminSupabase()
    const destinatarios = await resolverDestinatarios(admin, restauranteId, filtro ?? { tipo: 'todos' })
    // Mesma regra da fila (popularFilaCampanha): a tela mostra quantos vão receber.
    const { unicos, repetidos, invalidos } = deduplicarDestinatarios(destinatarios)
    return NextResponse.json({ total: unicos.length, repetidos, invalidos })
  } catch (err) {
    console.error('[campanhas/estimativa] erro:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
