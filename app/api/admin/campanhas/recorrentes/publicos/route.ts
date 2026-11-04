import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { restauranteDaSessao } from '@/lib/auth/session'
import { PUBLICOS } from '@/lib/mensageria/recorrentes'

// Públicos do Disparo personalizado (0248). GET: tamanho de cada um dos 13. POST { publicos }: tamanho da união.
// RPCs da sessão: só gestor da própria loja. Leitura do banco, sem API paga.

async function getAuthSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
}

const CHAVES = new Set<string>(PUBLICOS.map((p) => p.chave))

export async function GET() {
  try {
    const supabase = await getAuthSupabase()
    if (!(await restauranteDaSessao(supabase))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    const { data, error } = await supabase.rpc('campanha_publicos_tamanhos')
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: 'Só o dono ou gerente mexe nos disparos.' }, { status: 403 })
      throw error
    }
    return NextResponse.json(data ?? {})
  } catch (err) {
    console.error('[campanhas/recorrentes/publicos] GET erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await getAuthSupabase()
    if (!(await restauranteDaSessao(supabase))) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    const body = await request.json().catch(() => null)
    const publicos = Array.isArray(body?.publicos) ? body.publicos.filter((p: unknown) => typeof p === 'string' && CHAVES.has(p)) : []
    if (publicos.length === 0) return NextResponse.json({ pessoas: 0 })
    const { data, error } = await supabase.rpc('campanha_publico_estimativa', { p_publicos: publicos })
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: 'Só o dono ou gerente mexe nos disparos.' }, { status: 403 })
      throw error
    }
    return NextResponse.json({ pessoas: Number(data ?? 0) })
  } catch (err) {
    console.error('[campanhas/recorrentes/publicos] POST erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
