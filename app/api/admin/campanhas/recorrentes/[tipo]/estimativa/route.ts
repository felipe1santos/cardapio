import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { restauranteDaSessao } from '@/lib/auth/session'
import { TIPOS_RECORRENTES } from '@/lib/mensageria/recorrentes'

async function getAuthSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
}

type Ctx = { params: Promise<{ tipo: string }> }

/** Quantas pessoas o card pegaria agora (RPC da sessão, só gestor). */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tipo } = await params
    if (!(TIPOS_RECORRENTES as readonly string[]).includes(tipo)) return NextResponse.json({ error: 'Card inválido.' }, { status: 400 })
    const supabase = await getAuthSupabase()
    const restauranteId = await restauranteDaSessao(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    const { data, error } = await supabase.rpc('campanha_recorrente_estimativa', { p_tipo: tipo })
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: 'Só o dono ou gerente mexe nos disparos.' }, { status: 403 })
      throw error
    }
    return NextResponse.json({ pessoas: Number(data ?? 0) })
  } catch (err) {
    console.error('[campanhas/recorrentes/estimativa] erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
