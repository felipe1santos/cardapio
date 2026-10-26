import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { restauranteDaSessao } from '@/lib/auth/session'
import {
  atualizarCampanha,
  excluirCampanha,
  resolverDestinatarios,
  popularFilaCampanha,
  filaIntocada,
  cancelarFila,
  type CampanhaInput,
} from '@/lib/queries/campanhas'
import { deduplicarDestinatarios, problemasDasVariaveis, validarBotoes } from '@/lib/mensageria/campanhas'
import { janelaDoDisparo } from '@/lib/mensageria/disparo-regras'
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
    const restauranteId = await restauranteDaSessao(supabase)
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body: Partial<CampanhaInput> & { disparar?: boolean; status?: string } = await request.json()
    const admin = getAdminSupabase()
    const { data: atual } = await supabase.from('campanhas').select('status, mensagem, incluir_link, tipo_mensagem, pausa_motivo').eq('id', id).eq('restaurante_id', restauranteId).maybeSingle()
    if (!atual) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 })

    // Pelo painel (12/10): Pausar, Retomar e Cancelar.
    if (body.status !== undefined && !['cancelada', 'pausada', 'enviando'].includes(body.status)) return NextResponse.json({ error: 'Status inválido.' }, { status: 400 })
    if (body.status === 'pausada') {
      const { data: p } = await admin.from('campanhas').update({ status: 'pausada', pausada_em: new Date().toISOString(), pausa_motivo: 'manual', atualizado_em: new Date().toISOString() })
        .eq('id', id).eq('restaurante_id', restauranteId).in('status', ['agendada', 'enviando']).select('id').maybeSingle()
      if (!p) return NextResponse.json({ error: 'Só dá para pausar campanha agendada ou enviando.' }, { status: 409 })
      return NextResponse.json({ ok: true })
    }
    if (body.status === 'enviando') {
      // Retomar: pausa manual ou do freio. Desconexão volta sozinha quando o WhatsApp reconecta.
      if (atual.status !== 'pausada') return NextResponse.json({ error: 'A campanha não está pausada.' }, { status: 409 })
      if (atual.pausa_motivo === 'whatsapp_desconectado') return NextResponse.json({ error: 'Reconecte o WhatsApp da loja: a campanha volta sozinha.' }, { status: 409 })
      const { data: r } = await admin.from('campanhas').update({ status: 'enviando', pausada_em: null, pausa_motivo: null, atualizado_em: new Date().toISOString() })
        .eq('id', id).eq('restaurante_id', restauranteId).eq('status', 'pausada').select('id').maybeSingle()
      if (!r) return NextResponse.json({ error: 'Não foi possível retomar.' }, { status: 409 })
      return NextResponse.json({ ok: true })
    }
    if (body.status === 'cancelada') {
      if (!['rascunho', 'agendada', 'enviando', 'pausada'].includes(atual.status)) return NextResponse.json({ error: 'Esta campanha já terminou.' }, { status: 409 })
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
    if (body.janelaInicio !== undefined || body.janelaFim !== undefined) {
      const janela = janelaDoDisparo(body.janelaInicio ?? '17:00', body.janelaFim ?? '19:00')
      if (!janela.ok) return NextResponse.json({ error: janela.erro }, { status: 400 })
      patch.janelaInicio = janela.inicio
      patch.janelaFim = janela.fim
    }

    const tipoFinal = body.tipoMensagem ?? atual.tipo_mensagem
    const variaveis = tipoFinal === 'audio' ? null : problemasDasVariaveis(body.mensagem ?? atual.mensagem ?? '', { incluirLink: body.incluirLink ?? atual.incluir_link === true })
    if (variaveis) return NextResponse.json({ error: variaveis }, { status: 400 })
    if ('botoes' in body) {
      const botoes = validarBotoes((body as { botoes?: unknown }).botoes)
      if (!botoes.ok) return NextResponse.json({ error: botoes.erro }, { status: 400 })
      ;(patch as Record<string, unknown>).botoes = tipoFinal === 'audio' ? [] : botoes.botoes
    }

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
    const restauranteId = await restauranteDaSessao(supabase)
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
