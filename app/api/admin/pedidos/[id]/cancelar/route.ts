import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { motivoValido, rotuloMotivo, STATUS_NAO_CANCELAVEIS } from '@/lib/cancelamento'
import * as conta from '@/lib/servicos/conta-presencial'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSupabase()
  const sessao = await getCurrentSession(session)
  if (!sessao) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const restauranteId = sessao.restauranteId

  const body = await request.json().catch(() => null)
  const motivo = body?.motivo
  const observacao = typeof body?.observacao === 'string' ? body.observacao.trim() : ''

  if (!motivoValido(motivo)) {
    return NextResponse.json({ error: 'Motivo de cancelamento inválido.' }, { status: 400 })
  }
  if (motivo === 'outro' && !observacao) {
    return NextResponse.json({ error: 'Descreva o motivo do cancelamento.' }, { status: 400 })
  }

  const admin = getAdminSupabase()

  // Pedido presencial com conta (mesa, ou balcão do PDV v2): o Kanban não pode ser um
  // atalho que ignora a conta. Mesma regra do PDV — o atendente cancela direto só o que
  // ainda está "recebido" numa conta sem pagamento; o resto é da gerência; valor já
  // pago acima do novo total exige estorno antes. Antes, o atendente cancelava pedido
  // de mesa por aqui em qualquer estado.
  const { data: ped } = await admin
    .from('pedidos')
    .select('id, canal, comanda_id')
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
    .maybeSingle()
  if (!ped) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 })

  if (ped.comanda_id && (ped.canal === 'mesa' || ped.canal === 'balcao')) {
    const qualquer = pode(sessao.papel, 'pedidos.presencial.cancelar')
    if (!qualquer && !pode(sessao.papel, 'pedidos.presencial.cancelar_recebido')) {
      return NextResponse.json({ error: 'Sem permissão para cancelar pedido de conta.' }, { status: 403 })
    }
    const texto = observacao ? `${rotuloMotivo(motivo)} — ${observacao}` : rotuloMotivo(motivo)
    const r = await conta.cancelarPedido(
      admin,
      { restauranteId, userId: sessao.userId, nome: sessao.nome, papel: sessao.papel },
      id,
      texto,
      qualquer,
      'pdv',
    )
    if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
    reverterBeneficiosPedidoCancelado(admin, restauranteId, id).catch(console.error)
    return NextResponse.json({ ok: true })
  }

  if (!pode(sessao.papel, 'pedidos.delivery.cancelar')) {
    return NextResponse.json({ error: 'Sem permissão para cancelar.' }, { status: 403 })
  }

  const { data: auth } = await session.auth.getUser()

  // A guarda de status vive aqui, não na UI: o botão some para pedido entregue, mas
  // dois operadores em telas diferentes podem colidir. `reimprimir = false` impede que
  // um pedido cancelado com reimpressão pendente ainda saia na impressora (a 0083
  // também zera no banco, para todo caminho).
  const { data, error } = await admin
    .from('pedidos')
    .update({
      status: 'cancelado',
      cancelado_motivo: motivo,
      cancelado_observacao: observacao || null,
      cancelado_por: auth?.user?.email ?? null,
      cancelado_em: new Date().toISOString(),
      reimprimir: false,
    })
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
    .not('status', 'in', `(${STATUS_NAO_CANCELAVEIS.join(',')})`)
    .select('id')

  if (error) {
    return NextResponse.json({ error: 'Erro ao cancelar pedido.' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Pedido já finalizado ou cancelado.' }, { status: 409 })
  }

  reverterBeneficiosPedidoCancelado(admin, restauranteId, id).catch(console.error)
  return NextResponse.json({ ok: true })
}
