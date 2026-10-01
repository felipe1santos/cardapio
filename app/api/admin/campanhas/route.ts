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
import { deduplicarDestinatarios, problemasDasVariaveis, validarBotoes } from '@/lib/mensageria/campanhas'
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
    // Variável desconhecida ({Nome}, {cupom}…) sairia literal para o cliente: bloqueia.
    const variaveis = body.tipoMensagem === 'audio' ? null : problemasDasVariaveis(body.mensagem ?? '', { incluirLink: body.incluirLink === true })
    if (variaveis) return NextResponse.json({ error: variaveis }, { status: 400 })
    const botoes = validarBotoes(body.botoes)
    if (!botoes.ok) return NextResponse.json({ error: botoes.erro }, { status: 400 })
    body.botoes = body.tipoMensagem === 'audio' ? [] : botoes.botoes

    // Se já tem agendamento, o público é resolvido ANTES de criar: campanha agendada sem
    // ninguém na fila nunca concluía (ficava "agendada" para sempre).
    const admin = getAdminSupabase()
    const agendar = !!(body.agendadoEm || body.disparar)
    const destinatarios = agendar ? await resolverDestinatarios(admin, restauranteId, body.filtro) : []
    if (agendar && deduplicarDestinatarios(destinatarios).unicos.length === 0) {
      return NextResponse.json({ error: 'Nenhum cliente com WhatsApp válido neste público. Ajuste o filtro.' }, { status: 400 })
    }

    const campanha = await criarCampanha(supabase, restauranteId, body)
    if (agendar) await popularFilaCampanha(admin, campanha.id, restauranteId, destinatarios)

    return NextResponse.json(campanha, { status: 201 })
  } catch (err) {
    console.error('[campanhas] POST erro:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
