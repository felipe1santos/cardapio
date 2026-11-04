import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { restauranteDaSessao } from '@/lib/auth/session'

// Números da aba Campanhas (0247): hoje (enviadas, na fila, limite do aquecimento) e últimas 16 h (enviadas, perdidas,
// pedidos e receita). Só os cards recorrentes. RPC da sessão: só gestor da própria loja.

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
    const { data, error } = await supabase.rpc('campanha_recorrentes_resumo')
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: 'Só o dono ou gerente mexe nos disparos.' }, { status: 403 })
      throw error
    }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[campanhas/recorrentes/resumo] erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
