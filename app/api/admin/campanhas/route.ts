import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import {
  listarCampanhas,
  criarCampanha,
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

export async function GET() {
  try {
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const campanhas = await listarCampanhas(supabase, restauranteId)
    return NextResponse.json(campanhas)
  } catch (err) {
    console.error('[campanhas] GET erro:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body: CampanhaInput & { disparar?: boolean } = await request.json()
    if (!body.nome?.trim()) return NextResponse.json({ error: 'Informe o nome da campanha.' }, { status: 400 })
    if (!body.mensagem?.trim() && body.tipoMensagem !== 'audio') return NextResponse.json({ error: 'Informe a mensagem.' }, { status: 400 })

    const campanha = await criarCampanha(supabase, restauranteId, body)

    // Se já tem agendamento, popula a fila de envios imediatamente.
    if (body.agendadoEm || body.disparar) {
      const admin = getAdminSupabase()
      const destinatarios = await resolverDestinatarios(admin, restauranteId, body.filtro)
      if (destinatarios.length) {
        await popularFilaCampanha(admin, campanha.id, restauranteId, destinatarios)
      }
    }

    return NextResponse.json(campanha, { status: 201 })
  } catch (err) {
    console.error('[campanhas] POST erro:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
