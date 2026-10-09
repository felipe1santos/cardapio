import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { motivoValido, rotuloMotivo, STATUS_NAO_CANCELAVEIS } from '@/lib/cancelamento'
import * as conta from '@/lib/servicos/conta-presencial'
import { registrarAuditoria } from '@/lib/auditoria'
import { avisarDonoSensivel, exigirSegundaPessoa, foiParaCozinha } from '@/lib/financeiro/aprovacao-sensivel'

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
    .select('id, numero, canal, comanda_id, status, impresso')
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
    .maybeSingle()
  if (!ped) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 })

  // Já foi para a cozinha (lançado na conta, aceito ou impresso): com o financeiro ligado, PIN de
  // outra pessoa e alerta para o dono (lib/financeiro/aprovacao-sensivel.ts).
  const eu = { restauranteId, userId: sessao.userId, nome: sessao.nome, papel: sessao.papel }
  const presencial = !!ped.comanda_id && (ped.canal === 'mesa' || ped.canal === 'balcao')
  const resumo = `o pedido #${ped.numero}`
  const textoMotivo = observacao ? `${rotuloMotivo(motivo)} — ${observacao}` : rotuloMotivo(motivo)
  const qualquer = pode(sessao.papel, 'pedidos.presencial.cancelar')
  if (presencial ? !qualquer && !pode(sessao.papel, 'pedidos.presencial.cancelar_recebido') : !pode(sessao.papel, 'pedidos.delivery.cancelar')) {
    return NextResponse.json({ error: presencial ? 'Sem permissão para cancelar pedido de conta.' : 'Sem permissão para cancelar.' }, { status: 403 })
  }
  let aprovadoPor: string | null = null
  const sensivel = presencial || foiParaCozinha({ status: ped.status as string, impresso: ped.impresso === true })
  if (sensivel) {
    const lib = await exigirSegundaPessoa(admin, { sessao: eu, corpo: body, acao: 'cancelamento', valorCentavos: null, resumo })
    if (!lib.ok) return lib.resposta
    aprovadoPor = lib.aprovadoPor
  }

  if (presencial) {
    const r = await conta.cancelarPedido(
      admin,
      eu,
      id,
      textoMotivo,
      qualquer,
      'pdv',
    )
    if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
    await avisarDonoSensivel(admin, { sessao: eu, acao: 'cancelamento', aprovadoPor, resumo, motivo: textoMotivo })
    reverterBeneficiosPedidoCancelado(admin, restauranteId, id).catch(console.error)
    return NextResponse.json({ ok: true })
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

  // Quem cancelou, quando e por quê — também no registro de auditoria (o presencial já
  // registrava pelo serviço da conta; o delivery só gravava no próprio pedido).
  await registrarAuditoria(admin, {
    restauranteId,
    usuarioId: sessao.userId,
    usuarioNome: sessao.nome,
    acao: 'pedido.cancelou',
    entidade: 'pedido',
    entidadeId: id,
    dados: { motivo, observacao: observacao || null, canal: 'delivery' },
  }).catch(() => {})
  if (sensivel) await avisarDonoSensivel(admin, { sessao: eu, acao: 'cancelamento', aprovadoPor, resumo, motivo: textoMotivo })

  reverterBeneficiosPedidoCancelado(admin, restauranteId, id).catch(console.error)
  return NextResponse.json({ ok: true })
}
