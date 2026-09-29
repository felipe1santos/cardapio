import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import {
  atualizarCampanha,
  excluirCampanha,
  resolverDestinatarios,
  popularFilaCampanha,
  filaIntocada,
  cancelarFila,
  type CampanhaInput,
} from '@/lib/queries/campanhas'
import { deduplicarDestinatarios, problemasDasVariaveis } from '@/lib/mensageria/campanhas'
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

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body: Partial<CampanhaInput> & { disparar?: boolean; status?: string } = await request.json()
    const admin = getAdminSupabase()
    const { data: atual } = await supabase.from('campanhas').select('status, mensagem, incluir_link, tipo_mensagem').eq('id', id).eq('restaurante_id', restauranteId).maybeSingle()
    if (!atual) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 })

    // Pelo painel, o único status que se escolhe é "cancelada".
    if (body.status !== undefined && body.status !== 'cancelada') return NextResponse.json({ error: 'Status inválido.' }, { status: 400 })
    if (body.status === 'cancelada') {
      if (!['rascunho', 'agendada', 'enviando'].includes(atual.status)) return NextResponse.json({ error: 'Esta campanha já terminou.' }, { status: 409 })
      const campanha = await atualizarCampanha(supabase, restauranteId, id, { status: 'cancelada' })
      await cancelarFila(admin, id)
      return NextResponse.json(campanha)
    }

    // Campanha que já começou a sair não é alterada nem disparada de novo: a fila refeita
    // mandaria outra vez para quem já recebeu.
    if (!['rascunho', 'agendada'].includes(atual.status) || !(await filaIntocada(admin, id))) {
      return NextResponse.json({ error: 'Esta campanha já começou a ser enviada e não pode mais ser alterada.' }, { status: 409 })
    }
    const patch: Partial<CampanhaInput> & { disparar?: boolean; status?: string } = { ...body }
    delete patch.status

    const tipoFinal = body.tipoMensagem ?? atual.tipo_mensagem
    const variaveis = tipoFinal === 'audio' ? null : problemasDasVariaveis(body.mensagem ?? atual.mensagem ?? '', { incluirLink: body.incluirLink ?? atual.incluir_link === true })
    if (variaveis) return NextResponse.json({ error: variaveis }, { status: 400 })

    // Público resolvido antes de gravar: sem ninguém, a campanha ficaria agendada sem fila.
    const agendar = !!(body.disparar || body.agendadoEm)
    let destinatarios: { telefone: string; nome: string }[] = []
    if (agendar) {
      const { data: atualFiltro } = await supabase.from('campanhas').select('filtro').eq('id', id).eq('restaurante_id', restauranteId).maybeSingle()
      destinatarios = await resolverDestinatarios(admin, restauranteId, body.filtro ?? atualFiltro?.filtro ?? { tipo: 'todos' })
      if (deduplicarDestinatarios(destinatarios).unicos.length === 0) {
        return NextResponse.json({ error: 'Nenhum cliente com WhatsApp válido neste público. Ajuste o filtro.' }, { status: 400 })
      }
    }

    const campanha = await atualizarCampanha(supabase, restauranteId, id, patch as Partial<CampanhaInput>)

    if (agendar && campanha.status === 'agendada') {
      // Remove envios pendentes anteriores antes de repopular.
      await admin.from('campanha_envios').delete().eq('campanha_id', id).eq('status', 'pendente')
      await popularFilaCampanha(admin, id, restauranteId, destinatarios)
    }

    return NextResponse.json(campanha)
  } catch (err) {
    console.error('[campanhas/id] PATCH erro:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const supabase = await getAuthSupabase()
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    // Excluir apaga a fila junto (cascade): no meio do envio, o que já saiu sumia das
    // métricas e do controle. Enquanto envia, só cancelar.
    const { data: atual } = await supabase.from('campanhas').select('status').eq('id', id).eq('restaurante_id', restauranteId).maybeSingle()
    if (atual?.status === 'enviando') {
      return NextResponse.json({ error: 'Esta campanha está sendo enviada. Cancele antes de excluir.' }, { status: 409 })
    }
    await excluirCampanha(supabase, restauranteId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[campanhas/id] DELETE erro:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
