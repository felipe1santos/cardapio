import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getCurrentSession } from '@/lib/auth/session'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { pode } from '@/lib/auth/permissoes'
import { contaPublica, desconectar } from '@/lib/pagamentos/contas'
import { mpConfigurado } from '@/lib/pagamentos/mercadopago'
import { devolverPix, verificarChavePix } from '@/lib/pagamentos/pix-online'
import { podeConectarPagamentos } from '@/lib/pagamentos/permissao'
import { registrarAuditoria } from '@/lib/auditoria'

export const dynamic = 'force-dynamic'

/**
 * Pix online no painel (Integrações › Mercado Pago):
 *   GET    → conta (sem token), flag da loja, validade e os últimos Pix online (com "a devolver")
 *   PATCH  → { validadeMin } ou { cartaoAtivo, parcelasMax } (cartão online, 12/10) — só o dono
 *   DELETE → desconecta a conta (só o dono)
 *   POST   → { acao: 'devolver', pagamentoId, motivo, aprovacao: { aprovadorId, pin } | { remotaId } }
 *            Devolução total pela API, com aprovação de gerente/dono com PIN — nunca de quem pediu.
 */
async function sessaoDoPainel() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) }
  if (!podeConectarPagamentos(sessao.papel) && !pode(sessao.papel, 'pedidos.delivery.ver')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao }
}

export async function GET() {
  const s = await sessaoDoPainel(); if (s.erro) return s.erro
  const admin = getAdminSupabase()
  const id = s.sessao.restauranteId
  const [{ data: loja }, conta, { data: chave }, { data: pagamentos }] = await Promise.all([
    admin.from('restaurantes').select('pix_online_ativo, pix_online_validade_min, cartao_online_ativo, cartao_online_parcelas_max').eq('id', id).maybeSingle(),
    contaPublica(admin, id),
    admin.from('pagamentos_contas').select('public_key').eq('restaurante_id', id).maybeSingle(),
    admin.from('pagamentos_online').select('id, pedido_id, valor, status, taxa, liquido, expira_em, pago_em, devolvido_em, aprovado_por_nome, motivo_devolucao, criado_em, metodo, cartao_bandeira, cartao_final, cartao_tipo, parcelas, pedidos(numero, cliente_nome)')
      .eq('restaurante_id', id).order('criado_em', { ascending: false }).limit(50),
  ])
  return NextResponse.json({
    servidorPronto: mpConfigurado(), lojaLiberada: Boolean(loja?.pix_online_ativo), validadeMin: loja?.pix_online_validade_min ?? 15,
    cartaoAtivo: Boolean(loja?.cartao_online_ativo), parcelasMax: loja?.cartao_online_parcelas_max ?? 1, temChavePublica: Boolean(chave?.public_key),
    podeConectar: podeConectarPagamentos(s.sessao.papel), conta,
    pagamentos: (pagamentos ?? []).map((p) => {
      const ped = (Array.isArray(p.pedidos) ? p.pedidos[0] : p.pedidos) as { numero?: number; cliente_nome?: string } | null
      return { ...p, pedidos: undefined, numero: ped?.numero ?? null, cliente: ped?.cliente_nome ?? null }
    }),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: Request) {
  const s = await sessaoDoPainel(); if (s.erro) return s.erro
  if (!podeConectarPagamentos(s.sessao.papel)) return NextResponse.json({ error: 'Só o dono' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as { validadeMin?: unknown; cartaoAtivo?: unknown; parcelasMax?: unknown } | null
  const admin = getAdminSupabase()
  // Cartão online (12/10): liga/desliga e parcelas (1 = só à vista).
  if (corpo && (typeof corpo.cartaoAtivo === 'boolean' || corpo.parcelasMax !== undefined)) {
    const mudar: Record<string, unknown> = {}
    if (typeof corpo.cartaoAtivo === 'boolean') mudar.cartao_online_ativo = corpo.cartaoAtivo
    if (corpo.parcelasMax !== undefined) {
      const n = Number(corpo.parcelasMax)
      if (!Number.isInteger(n) || n < 1 || n > 12) return NextResponse.json({ error: 'Parcelas entre 1 e 12.' }, { status: 400 })
      mudar.cartao_online_parcelas_max = n
    }
    await admin.from('restaurantes').update(mudar).eq('id', s.sessao.restauranteId)
    await registrarAuditoria(admin, { restauranteId: s.sessao.restauranteId, usuarioId: s.sessao.userId, usuarioNome: s.sessao.nome, acao: 'cartao_online.config', entidade: 'restaurante', entidadeId: s.sessao.restauranteId, dados: mudar })
    return NextResponse.json({ ok: true })
  }
  const v = Number(corpo?.validadeMin)
  if (!Number.isInteger(v) || v < 5 || v > 60) return NextResponse.json({ error: 'Validade entre 5 e 60 minutos.' }, { status: 400 })
  await admin.from('restaurantes').update({ pix_online_validade_min: v }).eq('id', s.sessao.restauranteId)
  await registrarAuditoria(admin, { restauranteId: s.sessao.restauranteId, usuarioId: s.sessao.userId, usuarioNome: s.sessao.nome, acao: 'pix_online.validade', entidade: 'restaurante', entidadeId: s.sessao.restauranteId, dados: { minutos: v } })
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const s = await sessaoDoPainel(); if (s.erro) return s.erro
  if (!podeConectarPagamentos(s.sessao.papel)) return NextResponse.json({ error: 'Só o dono' }, { status: 403 })
  const admin = getAdminSupabase()
  await desconectar(admin, s.sessao.restauranteId)
  await registrarAuditoria(admin, { restauranteId: s.sessao.restauranteId, usuarioId: s.sessao.userId, usuarioNome: s.sessao.nome, acao: 'pix_online.conta_desconectada', entidade: 'pagamentos_contas', entidadeId: s.sessao.restauranteId })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
  const s = await sessaoDoPainel(); if (s.erro) return s.erro
  const corpo = (await request.json().catch(() => null)) as { acao?: unknown; pagamentoId?: unknown; motivo?: unknown; aprovacao?: { aprovadorId?: unknown; pin?: unknown; remotaId?: unknown } } | null
  // "Verificar de novo" a chave Pix (depois de cadastrar no app do MP).
  if (corpo?.acao === 'verificar_chave') {
    if (!podeConectarPagamentos(s.sessao.papel)) return NextResponse.json({ error: 'Só o dono' }, { status: 403 })
    const r = await verificarChavePix(getAdminSupabase(), s.sessao.restauranteId)
    return NextResponse.json({ resultado: r })
  }
  if (corpo?.acao !== 'devolver' || typeof corpo.pagamentoId !== 'string') return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  const a = corpo.aprovacao ?? {}
  const r = await devolverPix(getAdminSupabase(), {
    restauranteId: s.sessao.restauranteId, pagamentoId: corpo.pagamentoId, motivo: typeof corpo.motivo === 'string' ? corpo.motivo : '',
    solicitante: { id: s.sessao.userId, nome: s.sessao.nome },
    aprovacao: { aprovadorId: typeof a.aprovadorId === 'string' ? a.aprovadorId : '', pin: typeof a.pin === 'string' ? a.pin : '', remotaId: typeof a.remotaId === 'string' ? a.remotaId : null },
  })
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: r.status })
}
