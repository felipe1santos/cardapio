import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { abrirTurno, acertarEntregador, fecharTurno, painelCaixa } from '@/lib/queries/caixa'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { entregarTroco, modoTroco, situacaoMotoboys } from '@/lib/financeiro/motoboy'
import { veValoresFin } from '@/lib/financeiro/permissoes'
import { normalizarAcessos } from '@/lib/acessos'
import { trocoLevar } from '@/lib/pdv-pagamento'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Turno de caixa e acerto do entregador (0114).
 *
 *   GET  ?dia=AAAA-MM-DD            → turno aberto, acerto por entregador e resumo do dia
 *   POST { acao: 'abrir' }
 *   POST { acao: 'fechar', forcar? } → 409 com os pendentes se houver dinheiro a acertar
 *   POST { acao: 'acertar', entregadorId, valorDeclarado }
 *   POST { acao: 'troco', entregadorId, valorCentavos, pedidoId?, motivo?, chave }   (financeiro, 0136)
 *
 * Com o financeiro ligado o GET traz também `financeiro`: modo do troco, dinheiro com cada motoboy
 * (só para quem vê valores do financeiro — o acerto é cego) e o troco a entregar no despacho.
 *
 * Loja e operador vêm da sessão; esperado e troco são calculados aqui, nunca aceitos da tela.
 */
async function autorizar() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const
  if (!pode(sessao.papel, 'logistica.operar')) return { erro: NextResponse.json({ error: 'Sem permissão para o caixa.' }, { status: 403 }) } as const
  return { sessao, admin: getAdminSupabase() } as const
}

const DIA = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const ctx = await autorizar()
  if ('erro' in ctx) return ctx.erro
  const dia = new URL(request.url).searchParams.get('dia')
  if (dia !== null && !DIA.test(dia)) return NextResponse.json({ error: 'Dia inválido.' }, { status: 400 })
  try {
    const [painel, financeiro] = await Promise.all([
      painelCaixa(ctx.admin, ctx.sessao.restauranteId, dia ?? undefined),
      blocoFinanceiro(ctx.admin, ctx.sessao.restauranteId, ctx.sessao.userId, ctx.sessao.papel),
    ])
    return NextResponse.json(financeiro ? { ...painel, financeiro } : painel, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[caixa] GET', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro ao carregar o caixa.' }, { status: 500 })
  }
}

/** Dinheiro com os motoboys e troco a entregar no despacho. null quando o financeiro está desligado. */
async function blocoFinanceiro(admin: SupabaseClient, loja: string, userId: string, papel: string) {
  const { data: r } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', loja).maybeSingle()
  if (!r?.financeiro_ativo) return null
  const [{ modo }, situacao, { data: usu }, { data: peds }] = await Promise.all([
    modoTroco(admin, loja),
    situacaoMotoboys(admin, loja),
    admin.from('usuarios').select('acessos').eq('id', userId).maybeSingle(),
    admin.from('pedidos').select('id, numero, total, troco_para, entregador_id, entregadores ( nome )')
      .eq('restaurante_id', loja).in('status', ['pronto', 'em_rota']).eq('forma_pagamento', 'dinheiro').eq('pago', false)
      .not('entregador_id', 'is', null).not('troco_para', 'is', null)
      // Só o despacho de agora: pedido esquecido em rota há dias não vira troco a entregar.
      .gte('criado_em', new Date(Date.now() - 12 * 3600_000).toISOString()).limit(100),
  ])
  const ve = veValoresFin(papel, normalizarAcessos((usu as { acessos?: unknown } | null)?.acessos))
  const candidatos = (peds ?? []).map((p) => ({
    pedidoId: p.id as string, numero: p.numero as number, entregadorId: p.entregador_id as string,
    entregador: ((p.entregadores as unknown as { nome?: string } | null)?.nome) ?? '',
    trocoCentavos: Math.round(trocoLevar(Number(p.total), p.troco_para === null ? null : Number(p.troco_para)) * 100),
  })).filter((t) => t.trocoCentavos > 0)
  // Troco deste pedido já entregue ao motoboy? (linha troco_motoboy com o pedido no livro-caixa)
  const jaTem = new Set<string>()
  if (candidatos.length) {
    const { data: ls } = await admin.from('fin_lancamentos').select('pedido_id').eq('restaurante_id', loja).eq('tipo', 'troco_motoboy')
      .eq('carteira', 'motoboy').in('pedido_id', candidatos.map((t) => t.pedidoId))
    for (const l of ls ?? []) jaTem.add(l.pedido_id as string)
  }
  const saldoDe = (id: string) => situacao.find((m) => m.entregadorId === id)?.saldoCentavos ?? 0
  return {
    modo,
    veValores: ve,
    // Quem não vê valores do financeiro não vê o saldo do motoboy (o acerto é cego).
    motoboys: ve ? situacao.filter((m) => m.saldoCentavos !== 0).map((m) => ({ entregadorId: m.entregadorId, nome: m.nome, saldoCentavos: m.saldoCentavos })) : [],
    trocos: candidatos.filter((t) => !jaTem.has(t.pedidoId)).map((t) => ({
      ...t, cobre: saldoDe(t.entregadorId) >= t.trocoCentavos, temCentavos: ve ? Math.max(0, saldoDe(t.entregadorId)) : null,
    })),
  }
}

export async function POST(request: Request) {
  const ctx = await autorizar()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const acao = corpo?.acao
  const eu = { userId: sessao.userId, nome: sessao.nome ?? null }
  const auditar = (nome: string, dados: Record<string, unknown>, entidadeId?: string) =>
    registrarAuditoria(admin, { restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome, acao: nome, entidade: 'caixa', entidadeId, dados }).catch(() => {})
  // Financeiro ligado (0133): abrir e fechar o caixa passam pelo Financeiro › Caixa (fundo de troco,
  // contagem cega); aqui fica só o acerto do motoboy, que também entra no livro-caixa.
  const { data: loja } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', sessao.restauranteId).maybeSingle()
  const financeiro = !!loja?.financeiro_ativo
  if (acao === 'troco') {
    // Troco que sai da gaveta para o motoboy (0136), pelo contexto do financeiro (flag, trava de tela).
    const c = await contextoFinanceiro()
    if ('erro' in c) return c.erro
    const entregadorId = typeof corpo?.entregadorId === 'string' ? corpo.entregadorId : ''
    const pedidoId = typeof corpo?.pedidoId === 'string' ? corpo.pedidoId : null
    const chave = typeof corpo?.chave === 'string' ? corpo.chave.slice(0, 80) : ''
    const motivo = corpo?.motivo === 'fundo' || corpo?.motivo === 'complemento' ? corpo.motivo : 'pedido'
    if (!UUID.test(entregadorId) || (pedidoId !== null && !UUID.test(pedidoId))) return NextResponse.json({ error: 'Pedido ou motoboy inválido.' }, { status: 400 })
    if (!chave) return NextResponse.json({ error: 'Requisição sem chave.' }, { status: 400 })
    const valor = typeof corpo?.valorCentavos === 'number' ? corpo.valorCentavos : NaN
    const r = await entregarTroco(c, { entregadorId, pedidoId, valorCentavos: valor, motivo, chave })
    if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
    return NextResponse.json(r)
  }
  if (financeiro && (acao === 'abrir' || acao === 'fechar' || acao === 'acertar')) {
    return NextResponse.json({ error: 'Com o financeiro ligado, caixa e acerto de motoboy ficam em Financeiro › Caixa e Financeiro › Acerto de Motoboys.', codigo: 'usar_financeiro' }, { status: 409 })
  }
  try {
    if (acao === 'abrir') {
      const r = await abrirTurno(admin, sessao.restauranteId, eu)
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
      await auditar('caixa.abriu_turno', {}, r.turno.id)
      return NextResponse.json({ ok: true, turno: r.turno })
    }
    if (acao === 'fechar') {
      const r = await fecharTurno(admin, sessao.restauranteId, eu, corpo?.forcar === true)
      if (!r.ok) return NextResponse.json({ error: r.erro, pendentes: r.pendentes }, { status: r.status })
      await auditar('caixa.fechou_turno', { forcado: corpo?.forcar === true })
      return NextResponse.json({ ok: true })
    }
    if (acao === 'acertar') {
      const entregadorId = typeof corpo?.entregadorId === 'string' ? corpo.entregadorId : ''
      const valor = typeof corpo?.valorDeclarado === 'number' ? corpo.valorDeclarado : NaN
      if (!UUID.test(entregadorId)) return NextResponse.json({ error: 'Entregador inválido.' }, { status: 400 })
      if (!Number.isFinite(valor) || valor < 0 || valor > 1_000_000) return NextResponse.json({ error: 'Informe o valor declarado.' }, { status: 400 })
      const r = await acertarEntregador(admin, sessao.restauranteId, eu, entregadorId, valor)
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
      await auditar('caixa.acertou_entregador', { entregadorId, esperado: r.linha.valorEsperado, declarado: valor, pedidos: r.linha.pedidos })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  } catch (err) {
    console.error('[caixa] POST', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro no caixa.' }, { status: 500 })
  }
}
