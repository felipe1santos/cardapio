import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { cancelarCobrancaPendente, criarCobrancaDiferenca, enviarPixDiferencaAoCliente } from '@/lib/pagamentos/pix-online'

/**
 * Diferença de um pedido pago online (Fase 3, 19/10): a loja decide depois da edição.
 *   POST { modo: 'entrega' }  → cancela o Pix da diferença pendente (se houver) e o motoboy/caixa recebe na entrega.
 *   POST { modo: 'pix' }      → gera um Pix novo da diferença atual e manda ao cliente pelo WhatsApp.
 * Mesma permissão de editar pedidos. Nunca muda itens, total ou status do pedido.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Você não tem permissão para alterar pedidos.' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
  const corpo = (await request.json().catch(() => null)) as { modo?: string } | null
  const modo = corpo?.modo === 'entrega' || corpo?.modo === 'pix' ? corpo.modo : null
  if (!modo) return NextResponse.json({ error: 'Modo inválido.' }, { status: 400 })
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const { data: ped } = await admin.from('pedidos').select('id, numero, status, pago, pagamento_online, diferenca_a_receber, diferenca_modo, cliente_telefone')
    .eq('id', id).eq('restaurante_id', sessao.restauranteId).maybeSingle()
  if (!ped) return NextResponse.json({ error: 'Pedido não encontrado nesta loja.' }, { status: 404 })
  const valor = Number(ped.diferenca_a_receber ?? 0)
  if (!(ped.pago && ped.pagamento_online) || !(valor > 0)) return NextResponse.json({ error: 'Este pedido não tem diferença em aberto.' }, { status: 409 })
  if (ped.status === 'cancelado' || ped.status === 'entregue') return NextResponse.json({ error: 'O pedido já foi encerrado.' }, { status: 409 })
  const por = { usuarioId: sessao.userId, usuarioNome: sessao.nome }
  if (modo === 'entrega') {
    if (ped.diferenca_modo === 'pix' || ped.diferenca_modo === 'pix_vencido') {
      const r = await cancelarCobrancaPendente(admin, sessao.restauranteId, id).catch(() => 'erro' as const)
      if (r === 'paga') return NextResponse.json({ ok: true, paga: true, aviso: 'O cliente acabou de pagar o Pix da diferença.' })
      if (r === 'erro') return NextResponse.json({ error: 'Não consegui cancelar o Pix da diferença agora. Tente de novo.' }, { status: 409 })
    }
    await admin.from('pedidos').update({ diferenca_modo: 'entrega' }).eq('id', id).eq('restaurante_id', sessao.restauranteId)
    await registrarAuditoria(admin, { restauranteId: sessao.restauranteId, ...por, acao: 'pedido.diferenca_entrega', entidade: 'pedido', entidadeId: id, dados: { numero: ped.numero, valor, de: ped.diferenca_modo } })
    return NextResponse.json({ ok: true })
  }
  try {
    const cob = await criarCobrancaDiferenca(admin, { restauranteId: sessao.restauranteId, pedidoId: id, valor, motivo: `Nova cobrança da diferença do pedido #${ped.numero}` })
    await admin.from('pedidos').update({ diferenca_modo: 'pix' }).eq('id', id).eq('restaurante_id', sessao.restauranteId)
    const enviado = await enviarPixDiferencaAoCliente(admin, sessao.restauranteId, { numero: ped.numero, cliente_telefone: ped.cliente_telefone }, cob).catch(() => false)
    await registrarAuditoria(admin, { restauranteId: sessao.restauranteId, ...por, acao: 'pedido.diferenca_pix', entidade: 'pedido', entidadeId: id, dados: { numero: ped.numero, valor, de: ped.diferenca_modo, enviado } })
    return NextResponse.json({ ok: true, enviado })
  } catch (e) {
    const m = (e as Error).message
    const texto = m === 'pix_online_desligado' ? 'O Pix online não está ativo nesta loja.'
      : m === 'diferenca_anterior_paga' ? 'O cliente acabou de pagar o Pix da diferença.'
      : 'Não consegui gerar o Pix da diferença agora. Tente de novo.'
    return NextResponse.json({ error: texto }, { status: 409 })
  }
}
