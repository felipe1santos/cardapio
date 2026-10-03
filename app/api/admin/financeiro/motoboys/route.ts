import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { podeFin, veValoresFin } from '@/lib/financeiro/permissoes'
import {
  acertarMotoboy, baixarPendencia, definirModoTroco, entregarTroco, entregasSemRegistro, modoTroco, nextaAReceber,
  registrarEntregaOperador, repasseNexta, situacaoMotoboys,
} from '@/lib/financeiro/motoboy'

/**
 * Financeiro › Acerto de Motoboys (Fase 3). Loja e usuário da sessão; valores do livro-caixa.
 * Quem só faz o acerto NÃO vê o esperado antes de contar (acerto às cegas).
 *   GET                                                → modo do troco, motoboys, entregas sem registro, Nexta a receber
 *   POST { acao: 'modo', modo, fundoPadraoCentavos? }  (gerente/dono)
 *   POST { acao: 'troco', entregadorId, valorCentavos, motivo: 'fundo'|'complemento'|'pedido', pedidoId?, chave }
 *   POST { acao: 'acertar', entregadorId, contadoCentavos, pedidoIds?, chave }
 *   POST { acao: 'baixar', entregadorId, motivo, chave }  (só o dono)
 *   POST { acao: 'registrar', pedidoId, forma, recebidoCentavos?, nsu?, motivo?, chave }
 *   POST { acao: 'repasse_nexta', lancamentoIds, chave }
 */
export async function GET() {
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  const loja = c.sessao.restauranteId
  if (!podeFin(c.sessao.papel, c.acessos, 'acerto_motoboy') && !veValoresFin(c.sessao.papel, c.acessos)) {
    return NextResponse.json({ error: 'Você não tem permissão para o acerto de motoboys.', codigo: 'sem_permissao_acao' }, { status: 403 })
  }
  const ve = veValoresFin(c.sessao.papel, c.acessos)
  const [modo, motoboys, semRegistro, nexta] = await Promise.all([
    modoTroco(c.admin, loja), situacaoMotoboys(c.admin, loja), entregasSemRegistro(c.admin, loja), nextaAReceber(c.admin, loja),
  ])
  return NextResponse.json({
    modo, veValores: ve, papel: c.sessao.papel,
    motoboys: motoboys.filter((m) => !m.desativado || m.saldoCentavos !== 0).map((m) => ve ? m : {
      // Acerto às cegas: quem conta não vê o esperado (nem por pedido).
      entregadorId: m.entregadorId, nome: m.nome, desativado: m.desativado, temDinheiro: m.saldoCentavos !== 0,
      pedidos: m.pedidos.map((p) => ({ pedidoId: p.pedidoId, numero: p.numero })),
    }),
    semRegistro, nexta,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  const s = (v: unknown, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '')
  const n = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : NaN)
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let r
  switch (corpo?.acao) {
    case 'modo':
      if (corpo.modo !== 'pedido' && corpo.modo !== 'fundo') return NextResponse.json({ error: 'Modo inválido.' }, { status: 400 })
      r = await definirModoTroco(c, corpo.modo, n(corpo.fundoPadraoCentavos))
      break
    case 'troco':
      if (!podeFin(c.sessao.papel, c.acessos, 'acerto_motoboy')) return NextResponse.json({ error: 'Sem permissão.', codigo: 'sem_permissao_acao' }, { status: 403 })
      if (!UUID.test(s(corpo.entregadorId, 36))) return NextResponse.json({ error: 'Motoboy inválido.' }, { status: 400 })
      r = await entregarTroco(c, {
        entregadorId: s(corpo.entregadorId, 36), valorCentavos: n(corpo.valorCentavos), pedidoId: UUID.test(s(corpo.pedidoId, 36)) ? s(corpo.pedidoId, 36) : null,
        motivo: corpo.motivo === 'fundo' ? 'fundo' : corpo.motivo === 'complemento' ? 'complemento' : 'pedido', chave: s(corpo.chave, 100),
      })
      break
    case 'acertar':
      if (!UUID.test(s(corpo.entregadorId, 36))) return NextResponse.json({ error: 'Motoboy inválido.' }, { status: 400 })
      r = await acertarMotoboy(c, {
        entregadorId: s(corpo.entregadorId, 36), contadoCentavos: n(corpo.contadoCentavos), chave: s(corpo.chave, 100),
        pedidoIds: Array.isArray(corpo.pedidoIds) ? corpo.pedidoIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : null,
      })
      break
    case 'baixar':
      r = await baixarPendencia(c, { entregadorId: s(corpo.entregadorId, 36), motivo: s(corpo.motivo), chave: s(corpo.chave, 100) })
      break
    case 'registrar':
      if (!UUID.test(s(corpo.pedidoId, 36))) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
      r = await registrarEntregaOperador(c, {
        pedidoId: s(corpo.pedidoId, 36), forma: s(corpo.forma, 20), recebidoCentavos: Number.isSafeInteger(corpo.recebidoCentavos) ? (corpo.recebidoCentavos as number) : null,
        nsu: s(corpo.nsu, 40) || null, motivo: s(corpo.motivo) || null, chave: s(corpo.chave, 100),
      })
      break
    case 'repasse_nexta':
      r = await repasseNexta(c, { lancamentoIds: Array.isArray(corpo.lancamentoIds) ? corpo.lancamentoIds.filter((x): x is number => Number.isSafeInteger(x)) : [], chave: s(corpo.chave, 100) })
      break
    default:
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  }
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo, ...(r.dados ?? {}) }, { status: r.status })
  return NextResponse.json(r)
}
