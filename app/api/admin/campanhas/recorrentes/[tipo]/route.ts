import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { restauranteDaSessao } from '@/lib/auth/session'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { TIPOS_RECORRENTES, hojeSaoPaulo, validarPatchRecorrente, type TipoRecorrente } from '@/lib/mensageria/recorrentes'
import { atualizarRecorrente } from '@/lib/queries/recorrentes'
import { cancelarFila } from '@/lib/queries/campanhas'

async function getAuthSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
}

type Ctx = { params: Promise<{ tipo: string }> }

/** PATCH: liga/desliga, mensagem, galeria, programação, "pular hoje". Idempotente. */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tipo } = await params
    if (!(TIPOS_RECORRENTES as readonly string[]).includes(tipo)) return NextResponse.json({ error: 'Card inválido.' }, { status: 400 })
    const supabase = await getAuthSupabase()
    const restauranteId = await restauranteDaSessao(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const v = validarPatchRecorrente(tipo as TipoRecorrente, body)
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })

    const card = await atualizarRecorrente(supabase, restauranteId, tipo as TipoRecorrente, v.row)
    if (!card) return NextResponse.json({ error: 'Só o dono ou gerente mexe nos disparos.' }, { status: 403 })

    // "Pular hoje" com a rodada de hoje já nascida: o que ainda não saiu é cancelado (decisão 4 do plano).
    if (v.pularHoje && card.ultimaCampanhaId && card.ultimaRodadaEm && card.ultimaRodadaEm.length >= 10 && hojeSaoPaulo(new Date(card.ultimaRodadaEm)) === hojeSaoPaulo()) {
      await cancelarFila(getAdminSupabase(), card.ultimaCampanhaId)
    }
    return NextResponse.json(card)
  } catch (err) {
    console.error('[campanhas/recorrentes] PATCH erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
