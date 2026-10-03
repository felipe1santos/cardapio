import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { registrarAuditoria } from '@/lib/auditoria'
import { daPedido, erroPagamentoPdv, lerPagamentoPdv, paraPedido, rotuloForma } from '@/lib/pdv-pagamento'
import { aprovar } from '@/lib/financeiro/aprovacao'

/**
 * Alterar a forma de pagamento / troco de um pedido já lançado (0135).
 *   POST { pagamento: { escolha, trocoPara }, reimprimir?, aprovacao?: { aprovadorId, pin } }
 * Até sair para entrega (e sem pagamento registrado): quem atende altera. Depois de sair ou de pago:
 * só gerente/dono — e, com o financeiro ligado, com o PIN de OUTRA pessoa (o dono não precisa).
 * Pedido de conta (balcão): a escolha vale para os pedidos ainda não pagos da mesma conta.
 * Tudo auditado (quem, quando, de/para). Mesa: não tem forma escolhida antes (paga no fechamento).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const corpo = await request.json().catch(() => null)
  const pagamento = lerPagamentoPdv(corpo?.pagamento)
  if (!pagamento) return NextResponse.json({ error: 'Escolha a forma de pagamento.' }, { status: 400 })
  const loja = sessao.restauranteId
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })

  const { data: p } = await admin.from('pedidos')
    .select('id, numero, status, pago, canal, comanda_id, total, tipo, forma_pagamento, cartao_tipo, troco_para')
    .eq('id', id).eq('restaurante_id', loja).maybeSingle()
  if (!p) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 })
  if (p.canal === 'mesa') return NextResponse.json({ error: 'Pedido de mesa paga no fechamento da conta.' }, { status: 409 })
  if (p.status === 'cancelado') return NextResponse.json({ error: 'Pedido cancelado.' }, { status: 409 })

  // Total de referência do troco: a conta inteira (balcão) ou o pedido (delivery da vitrine).
  let total = Number(p.total)
  if (p.comanda_id) {
    const { data: t } = await admin.rpc('comanda_totais', { p_comanda: p.comanda_id })
    total = Number((((t as unknown[] | null) ?? [])[0] as { total?: number } | undefined)?.total ?? total)
  }
  const erro = erroPagamentoPdv(pagamento, total)
  if (erro) return NextResponse.json({ error: erro, codigo: 'pagamento_invalido' }, { status: 400 })

  // Depois de sair para entrega ou de pago: gerência, com PIN de outra pessoa se o financeiro estiver ligado.
  const tarde = p.pago === true || p.status === 'em_rota' || p.status === 'entregue'
  let aprovadoPor: string | null = null
  if (tarde) {
    if (!['dono', 'gerente'].includes(sessao.papel)) {
      return NextResponse.json({ error: 'O pedido já saiu para entrega ou foi pago: só o gerente ou o dono altera.', codigo: 'precisa_gerencia' }, { status: 403 })
    }
    const { data: r } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', loja).maybeSingle()
    if (r?.financeiro_ativo && sessao.papel !== 'dono') {
      const a = corpo?.aprovacao
      if (!a || typeof a.aprovadorId !== 'string' || typeof a.pin !== 'string') {
        return NextResponse.json({ error: 'Precisa da aprovação de outra pessoa (PIN).', codigo: 'aprovacao_necessaria' }, { status: 409 })
      }
      const ap = await aprovar(admin, {
        restauranteId: loja, solicitante: { id: sessao.userId, nome: sessao.nome }, aprovadorId: a.aprovadorId, pin: a.pin,
        acao: 'alterar_pagamento', motivo: `Pedido #${p.numero}`, contexto: { pedido: p.id },
      })
      if (!ap.ok) return NextResponse.json({ error: ap.erro, codigo: ap.codigo }, { status: ap.status })
      aprovadoPor = ap.aprovadorNome
    }
  }

  const novo = paraPedido(pagamento)
  const antes = daPedido(p.forma_pagamento as string, p.cartao_tipo as string | null, p.troco_para === null ? null : Number(p.troco_para))
  const reimprimir = corpo?.reimprimir === true
  let q = admin.from('pedidos').update({ ...novo, ...(reimprimir ? { reimprimir: true } : {}) }).eq('restaurante_id', loja).neq('status', 'cancelado')
  q = p.comanda_id ? q.eq('comanda_id', p.comanda_id).or(`pago.eq.false,id.eq.${p.id}`) : q.eq('id', p.id)
  const { error } = await q
  if (error) {
    if (/pedidos_cartao_tipo_check/.test(error.message)) return NextResponse.json({ error: 'Forma de pagamento inválida.' }, { status: 400 })
    return NextResponse.json({ error: 'Não foi possível alterar.' }, { status: 500 })
  }
  await registrarAuditoria(admin, {
    restauranteId: loja, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: 'pedido.pagamento_alterado', entidade: 'pedido', entidadeId: p.id,
    dados: {
      numero: p.numero, status: p.status,
      de: antes ? `${rotuloForma(p.forma_pagamento as string, p.cartao_tipo as string | null)}${antes.trocoPara ? ` · troco p/ ${antes.trocoPara.toFixed(2)}` : ''}` : null,
      para: `${rotuloForma(novo.forma_pagamento, novo.cartao_tipo)}${novo.troco_para ? ` · troco p/ ${novo.troco_para.toFixed(2)}` : ''}`,
      reimprimir, aprovado_por: aprovadoPor,
    },
  })
  return NextResponse.json({ ok: true, aprovadoPor })
}
