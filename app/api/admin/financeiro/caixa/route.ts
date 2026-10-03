import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { podeFin, veValoresFin, type AcaoFin } from '@/lib/financeiro/permissoes'
import {
  abrirCaixa, conferirCaixaAbertoDemais, configFin, extratoDoTurno, fecharCaixa, movimentar, pendenciasDoFechamento, reabrirCaixa,
  saldosDoTurno, turnoAberto, type Aprovacao, type TurnoFin,
} from '@/lib/financeiro/caixa'
import { MOVIMENTOS, type Movimento } from '@/lib/financeiro/caixa-regras'
import { painelCaixa } from '@/lib/queries/caixa'
import { criarAlerta } from '@/lib/financeiro/alertas'
import { formatarCentavos } from '@/lib/financeiro/centavos'

/**
 * Financeiro › Caixa (Fase 2). Loja, usuário e aparelho vêm da sessão; valores esperados são
 * calculados aqui a partir do livro-caixa e NUNCA vão para quem só opera o caixa antes de contar
 * (contagem cega). Quem pode "ver valores" (permissão financeiro) vê o esperado ao vivo.
 *
 *   GET  [?leve=1]                                  → estado do caixa (leve: só para o aviso do topo)
 *   POST { acao: 'abrir', fundoCentavos }
 *   POST { acao: 'movimento', movimento, valorCentavos, motivo, chave, aprovacao? }
 *   POST { acao: 'fechar', contadoDinheiroCentavos, contadoCartaoCentavos, justificativa?, aceitarPendencias?, aprovacao? }
 *   POST { acao: 'reabrir', turnoId, motivo }                  (só o dono)
 */
const DO_CAIXA: AcaoFin[] = ['caixa_abrir', 'fechar_caixa', 'sangria', 'despesa', 'financeiro']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function semValores(t: TurnoFin): Partial<TurnoFin> {
  // Turno ABERTO para quem não vê valores: nada de esperado (o fechamento é cego).
  const { esperado_dinheiro_centavos: _e, esperado_cartao_centavos: _c, resumo: _r, ...resto } = t
  void _e; void _c; void _r
  return resto
}

function lerAprovacao(v: unknown): Aprovacao | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  if (typeof a.aprovadorId !== 'string' || typeof a.pin !== 'string') return null
  return { aprovadorId: a.aprovadorId, pin: a.pin }
}

export async function GET(request: Request) {
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  const { sessao, admin, acessos } = c
  const loja = sessao.restauranteId
  if (!DO_CAIXA.some((a) => podeFin(sessao.papel, acessos, a))) return NextResponse.json({ error: 'Você não tem permissão para o caixa.', codigo: 'sem_permissao_acao' }, { status: 403 })
  const turno = await turnoAberto(admin, loja)
  if (new URL(request.url).searchParams.get('leve') === '1') {
    if (turno) await conferirCaixaAbertoDemais(admin, loja, turno).catch(() => {})
    // Caixa fechado com dinheiro de entrega "a acertar" (0135): aviso no topo e alerta depois de X h.
    let aAcertarCentavos = 0
    let aAcertarDesde: string | null = null
    if (!turno) {
      const p = await painelCaixa(admin, loja).catch(() => null)
      for (const l of p?.acerto ?? []) {
        aAcertarCentavos += Math.round(l.valorEsperado * 100)
        if (l.maisAntigaEm && (!aAcertarDesde || l.maisAntigaEm < aAcertarDesde)) aAcertarDesde = l.maisAntigaEm
      }
      if (aAcertarCentavos > 0 && aAcertarDesde) {
        const { data: cfg } = await admin.from('fin_config').select('horas_motoboy_pendente').eq('restaurante_id', loja).maybeSingle()
        const horas = Number(cfg?.horas_motoboy_pendente ?? 2)
        if (Date.now() - Date.parse(aAcertarDesde) >= horas * 3_600_000) {
          await criarAlerta(admin, {
            restauranteId: loja, tipo: 'dinheiro_a_acertar', gravidade: 'atencao',
            mensagem: `Há ${formatarCentavos(aAcertarCentavos)} de entregas em dinheiro a acertar com o caixa fechado há mais de ${horas} h. Abra o caixa e faça o acerto dos motoboys.`,
            dedupeMin: horas * 60, dedupeChave: 'a-acertar',
          }).catch(() => {})
        }
      }
    }
    return NextResponse.json({ aberto: !!turno, abertoPorNome: turno?.aberto_por_nome ?? null, abertoEm: turno?.aberto_em ?? null, souEu: turno?.aberto_por === sessao.userId, aAcertarCentavos, aAcertarDesde }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const veValores = veValoresFin(sessao.papel, acessos)
  const cfg = await configFin(admin, loja)
  const { data: ultimoFechado } = await admin.from('caixa_turnos')
    .select('id, aberto_em, aberto_por_nome, fechado_em, fechado_por_nome, valor_inicial_centavos, contado_dinheiro_centavos, contado_cartao_centavos, esperado_dinheiro_centavos, esperado_cartao_centavos, diferenca_centavos, diferenca_cartao_centavos, justificativa, fechamento_aprovado_por_nome, pendencias, reaberto_por_nome, reaberto_motivo')
    .eq('restaurante_id', loja).not('fechado_em', 'is', null).order('fechado_em', { ascending: false }).limit(1).maybeSingle()
  const base = {
    acoes: (['caixa_abrir', 'fechar_caixa', 'caixa_reabrir', 'sangria', 'despesa', 'financeiro'] as AcaoFin[]).filter((a) => podeFin(sessao.papel, acessos, a)),
    veValores, papel: sessao.papel, limiteSaidaCentavos: cfg.limiteSaida, limiteDivergenciaCentavos: cfg.limiteDivergencia,
    ultimoFechado: ultimoFechado ?? null,
  }
  if (!turno) return NextResponse.json({ ...base, turno: null }, { headers: { 'Cache-Control': 'no-store' } })
  const [pendencias, extrato, saldos] = await Promise.all([
    pendenciasDoFechamento(admin, loja, turno.id),
    extratoDoTurno(admin, loja, turno.id),
    veValores ? saldosDoTurno(admin, loja, turno.id) : Promise.resolve(null),
  ])
  // Quem não vê valores vê só os movimentos manuais (sangria, reforço…), não os recebimentos.
  const MANUAIS = ['abertura', 'sangria', 'reforco', 'despesa', 'retirada', 'perda', 'ajuste']
  return NextResponse.json({
    ...base,
    turno: veValores ? turno : semValores(turno),
    saldos,
    pendencias: veValores ? pendencias : { ...pendencias, motoboys: pendencias.motoboys.map((m) => ({ ...m, esperadoCentavos: null })), pixAConferirCentavos: null },
    extrato: veValores ? extrato : extrato.filter((l) => MANUAIS.includes(l.tipo)),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const acao = corpo?.acao
  const exige: Record<string, AcaoFin | undefined> = { abrir: 'caixa_abrir', fechar: 'fechar_caixa', reabrir: 'caixa_reabrir', movimento: undefined }
  if (typeof acao !== 'string' || !(acao in exige)) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  const c = await contextoFinanceiro(exige[acao])
  if ('erro' in c) return c.erro
  const num = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : NaN)
  try {
    let r
    if (acao === 'abrir') r = await abrirCaixa(c, num(corpo?.fundoCentavos))
    else if (acao === 'movimento') {
      const m = corpo?.movimento
      if (typeof m !== 'string' || !(MOVIMENTOS as readonly string[]).includes(m)) return NextResponse.json({ error: 'Movimento inválido.' }, { status: 400 })
      r = await movimentar(c, {
        movimento: m as Movimento, valorCentavos: num(corpo?.valorCentavos), motivo: typeof corpo?.motivo === 'string' ? corpo.motivo.slice(0, 500) : '',
        chave: typeof corpo?.chave === 'string' ? corpo.chave : '', aprovacao: lerAprovacao(corpo?.aprovacao),
      })
    } else if (acao === 'fechar') {
      r = await fecharCaixa(c, {
        contadoDinheiroCentavos: num(corpo?.contadoDinheiroCentavos), contadoCartaoCentavos: num(corpo?.contadoCartaoCentavos ?? 0),
        justificativa: typeof corpo?.justificativa === 'string' ? corpo.justificativa.slice(0, 500) : null,
        aceitarPendencias: corpo?.aceitarPendencias === true, aprovacao: lerAprovacao(corpo?.aprovacao),
      })
    } else {
      const turnoId = typeof corpo?.turnoId === 'string' && UUID.test(corpo.turnoId) ? corpo.turnoId : ''
      if (!turnoId) return NextResponse.json({ error: 'Caixa inválido.' }, { status: 400 })
      r = await reabrirCaixa(c, turnoId, typeof corpo?.motivo === 'string' ? corpo.motivo.slice(0, 500) : '')
    }
    if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo, ...(r.dados ?? {}) }, { status: r.status })
    return NextResponse.json(r)
  } catch (e) {
    const msg = (e as Error).message ?? ''
    if (/turno_imutavel/.test(msg)) return NextResponse.json({ error: 'Caixa fechado não pode ser alterado.', codigo: 'turno_imutavel' }, { status: 409 })
    if (/caixa_fechado/.test(msg)) return NextResponse.json({ error: 'O caixa está fechado.', codigo: 'caixa_fechado' }, { status: 409 })
    console.error('[financeiro/caixa]', msg.slice(0, 200))
    return NextResponse.json({ error: 'Erro no caixa.' }, { status: 500 })
  }
}
