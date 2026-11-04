import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { restauranteDaSessao } from '@/lib/auth/session'
import { TIPOS_RECORRENTES, validarAnuncios, type TipoRecorrente } from '@/lib/mensageria/recorrentes'
import { salvarAnuncios } from '@/lib/queries/recorrentes'

// Anúncios de Promoções e do Disparo personalizado (0248): o modal manda a lista inteira; aqui valida e grava.
// Cliente da sessão: a RLS (gestor da própria loja) e as triggers do banco garantem dono, limite e agenda.

async function getAuthSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
}

type Ctx = { params: Promise<{ tipo: string }> }

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { tipo } = await params
    if (!(TIPOS_RECORRENTES as readonly string[]).includes(tipo) || tipo === 'recuperacao') return NextResponse.json({ error: 'Card inválido.' }, { status: 400 })
    const supabase = await getAuthSupabase()
    const restauranteId = await restauranteDaSessao(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const v = validarAnuncios(tipo as TipoRecorrente, body?.anuncios)
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })

    const card = await salvarAnuncios(supabase, restauranteId, tipo as TipoRecorrente, v.rows).catch((e: { code?: string; message?: string }) => {
      if (e?.code === '23514' || e?.code === '23503') throw Object.assign(new Error(e.message ?? 'Dados inválidos.'), { badRequest: true })
      throw e
    })
    if (!card) return NextResponse.json({ error: 'Só o dono ou gerente mexe nos disparos.' }, { status: 403 })
    return NextResponse.json(card)
  } catch (err) {
    if ((err as { badRequest?: boolean })?.badRequest) return NextResponse.json({ error: (err as Error).message }, { status: 400 })
    console.error('[campanhas/recorrentes/anuncios] PUT erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
